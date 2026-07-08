// Minimal stdio MCP server for tests: one "echo" tool. No deps, no network.
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.method === 'initialize') send(m.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' } });
    else if (m.method === 'tools/list') send(m.id, { tools: [{ name: 'echo', description: 'echoes text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] });
    else if (m.method === 'tools/call') send(m.id, { content: [{ type: 'text', text: 'echo: ' + (m.params?.arguments?.text || '') }] });
  }
});
function send(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
