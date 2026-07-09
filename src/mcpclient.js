import { spawn, spawnSync } from 'child_process';
import { loadConfig } from './orbitconfig.js';

// ─────────────────────────────────────────────
// Minimal JSON-RPC 2.0 stdio client for MCP servers.
// Shared by the `mcp` domain (manual use) and the agent tool-loop bridge.
// ─────────────────────────────────────────────

// Launch an MCP server WITHOUT a shell — `command` is treated as an executable, never a shell
// string, so metacharacters can't inject. On Windows we resolve .cmd/.bat shims (npx) explicitly.
function launch(command, args) {
  const opts = { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true };
  if (process.platform !== 'win32') return spawn(command, args, { ...opts, shell: false });
  // Resolve via `where` — this also validates the command is a real executable, not a shell string.
  let resolved = command;
  try {
    const r = spawnSync('where', [command], { encoding: 'utf8' });
    if (r.status === 0) resolved = r.stdout.split(/\r?\n/).find(Boolean) || command;
  } catch { /* fall through */ }
  if (/\.(cmd|bat)$/i.test(resolved)) {
    // Batch shims must run via cmd.exe; Node quotes each arg (windowsVerbatimArguments:false) — no shell:true.
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', resolved, ...args], { ...opts, shell: false });
  }
  return spawn(resolved, args, { ...opts, shell: false });
}

export function connect(server) {
  const child = launch(server.command, server.args || []);
  const pending = new Map();
  let n = 0, buf = '';

  const MAX_BUF = 16 * 1024 * 1024; // cap buffered stdout so a malformed/hostile server can't OOM us
  const failAll = (e) => { for (const { reject } of pending.values()) reject(e); pending.clear(); };
  child.on('error', failAll);
  child.on('exit', () => failAll(new Error('mcp server exited')));
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > MAX_BUF) { // no newline in 16 MB — treat as a runaway server, don't grow unbounded
      buf = '';
      failAll(new Error('mcp server output exceeded 16 MB without a complete message'));
      try { child.kill(); } catch { /* gone */ }
      return;
    }
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
