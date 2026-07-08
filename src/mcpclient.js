import { spawn } from 'child_process';
import { loadConfig } from './orbitconfig.js';

// ─────────────────────────────────────────────
// Minimal JSON-RPC 2.0 stdio client for MCP servers.
// Shared by the `mcp` domain (manual use) and the agent tool-loop bridge.
// ─────────────────────────────────────────────

export function connect(server) {
  // shell:true lets Windows resolve .cmd shims (npx.cmd), but Node won't quote args for the shell,
  // so quote any arg with whitespace ourselves — otherwise "C:\Program Files\x" splits into two args.
  const rawArgs = server.args || [];
  const args = process.platform === 'win32'
    ? rawArgs.map(a => (/\s/.test(a) && !/^".*"$/.test(a)) ? `"${a}"` : a)
    : rawArgs;
  const child = spawn(server.command, args, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let n = 0, buf = '';

  const failAll = (e) => { for (const { reject } of pending.values()) reject(e); pending.clear(); };
  child.on('error', failAll);
  child.on('exit', () => failAll(new Error('mcp server exited')));
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; } // skip non-JSON banner lines
      const p = msg.id != null && pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  });

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++n;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`mcp request timed out: ${method}`)); }, 15000);
    const done = (fn) => (v) => { clearTimeout(t); fn(v); };
    pending.set(id, { resolve: done(resolve), reject: done(reject) });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  return {
    request,
    notify: (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'),
    close: () => { try { child.kill(); } catch { /* already gone */ } },
  };
}

export function findServer(name) {
  if (!name) throw new Error('server name required');
  const s = (loadConfig().mcp?.servers || []).find((x) => x.name === name);
  if (!s) throw new Error(`no mcp server named '${name}' (add one with: orbit mcp add)`);
  return s;
}

export async function withServer(name, fn) {
  const c = connect(findServer(name));
  try {
    await c.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'orbit', version: '1.0.0' },
    });
    c.notify('notifications/initialized');
    return await fn(c);
  } finally {
    c.close();
  }
}

export const listTools = (name) => withServer(name, (c) => c.request('tools/list', {}).then((r) => r.tools || []));

export const callTool = (name, tool, args) =>
  withServer(name, (c) => c.request('tools/call', { name: tool, arguments: args || {} }).then((res) => {
    const parts = (res.content || []).filter((p) => p.type === 'text').map((p) => p.text);
    return parts.length ? parts.join('\n') : JSON.stringify(res);
  }));

// Connect to every configured server and collect its tools. Best-effort: an
// unreachable server is skipped, not fatal, so a run never breaks over MCP.
export async function discoverTools() {
  const servers = loadConfig().mcp?.servers || [];
  const out = [];
  for (const s of servers) {
    try {
      const tools = await listTools(s.name);
      for (const t of tools) out.push({ server: s.name, name: t.name, description: t.description || '' });
    } catch { /* skip unreachable server */ }
  }
  return out;
}
