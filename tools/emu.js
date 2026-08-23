// ============================================================
// android-emulator 插件的 MCP stdio 驱动
// 用法: node tools/emu.js <tool> [jsonArgs]
//   node tools/emu.js list           # 列出工具
//   node tools/emu.js android_preflight
//   node tools/emu.js android_start_emulator '{"avd":"..."}'
// ============================================================
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const PLUGIN = 'C:/Users/Lenovo/.zcode/cli/plugins/cache/zcode-plugins-official/android-emulator/0.1.0';
const DATA = 'C:/Users/Lenovo/.zcode/cli/plugins/data/android-emulator@zcode-plugins-official';

const [, , cmd, argsJson] = process.argv;

const child = spawn('node', [path.join(PLUGIN, 'dist/mcp/server.js')], {
  env: {
    ...process.env,
    ANDROID_PLUGIN_DATA: DATA,
    ANDROID_PLUGIN_API_LEVEL: process.env.ANDROID_PLUGIN_API_LEVEL || '35',
  },
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stderr.on('data', d => process.stderr.write('[emu-stderr] ' + d));

const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  child.stdout.write(''); // noop
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('timeout: ' + method));
      }
    }, 25 * 60 * 1000); // SDK 下载可能很久，25 分钟
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

rl.on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  }
});

(async () => {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'bbl-driver', version: '1.0' }
  });
  notify('notifications/initialized', {});

  if (!cmd || cmd === 'list') {
    const tools = await send('tools/list', {});
    for (const t of tools.tools) console.log(t.name, '-', (t.description || '').slice(0, 70));
    process.exit(0);
  }

  const args = argsJson ? JSON.parse(argsJson) : {};
  try {
    const r = await send('tools/call', { name: cmd, arguments: args });
    const out = (r.content || []).map(c => c.text || '').join('\n');
    console.log(out || JSON.stringify(r));
    process.exit(r.isError ? 2 : 0);
  } catch (e) {
    console.error('TOOL_ERROR:', e.message);
    process.exit(1);
  }
})();
