#!/usr/bin/env bash
# 一键：用 .gh-token.json 里的 token 建私有仓库 → 推送 → 等待 Actions 构建完成 → 下载 APK 产物
set -e
cd "$(dirname "$0")/.."

TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.gh-token.json','utf8')).access_token)")
REPO="bbl-basketball-life"
API="https://api.github.com"

echo "== 1/4 创建私有仓库 $REPO =="
curl -s -X POST "$API/user/repos" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{"name":"'"$REPO"'","private":true,"description":"篮球人生 — LLM 文字篮球生涯模拟（Web + APK）"}' | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d);
  if (j.full_name) { console.log('created:', j.full_name); process.exit(0); }
  if (j.errors && j.errors.some(e => /already exists/i.test(e.message || ''))) { console.log('exists, reuse'); process.exit(0); }
  console.error('create failed:', d.slice(0,300)); process.exit(1);
})"

USER=$(curl -s "$API/user" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).login))")
echo "用户: $USER"

echo "== 2/4 推送代码 =="
git remote remove origin 2>/dev/null || true
git remote add origin "https://$TOKEN@github.com/$USER/$REPO.git"
git push -q -u origin main
echo "pushed"

echo "== 3/4 等待 Actions 构建（最长 15 分钟） =="
sleep 5
for i in $(seq 1 60); do
  RUN=$(curl -s "$API/repos/$USER/$REPO/actions/runs?per_page=1" -H "Authorization: Bearer $TOKEN")
  INFO=$(echo "$RUN" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const r=JSON.parse(d).workflow_runs[0];
  if(!r){console.log('NONE');return;}
  console.log(r.id, r.status, r.conclusion||'');
})")
  set -- $INFO
  RUN_ID=$1; STATUS=$2; CONCL=$3
  echo "  [$i] run=$RUN_ID status=$STATUS conclusion=$CONCL"
  if [ "$STATUS" = "completed" ]; then
    if [ "$CONCL" = "success" ]; then break; else echo "BUILD FAILED"; exit 1; fi
  fi
  sleep 15
done

echo "== 4/4 下载 APK 产物 =="
ART_URL=$(curl -s "$API/repos/$USER/$REPO/actions/runs/$RUN_ID/artifacts" -H "Authorization: Bearer $TOKEN" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const a=JSON.parse(d).artifacts[0];
  if(a)console.log(a.archive_download_url);
})")
if [ -z "$ART_URL" ]; then echo "no artifact"; exit 1; fi
mkdir -p dist
curl -sL -H "Authorization: Bearer $TOKEN" -o dist/apk-artifact.zip "$ART_URL"
cd dist && unzip -o -q apk-artifact.zip && rm apk-artifact.zip
echo "DONE: $(ls *.apk)"
