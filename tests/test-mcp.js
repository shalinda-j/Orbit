import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'echo-mcp.js');

// Isolated temp cwd with an .orbit/config.json pointing at the echo MCP server.
const tmp = path.join(os.tmpdir(), 'orbit-mcp-test-' + process.pid);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, '.orbit'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.orbit', 'config.json'), JSON.stringify({ mcp: { servers: [{ name: 'echo', command: 'node', args: [fixture] }] } }));
process.chdir(tmp);
process.env.ORBIT_TRUST_PROJECT = '1'; // project MCP servers are untrusted by default (RCE guard) — opt in for the test

const { discoverTools, callTool } = await import('../src/mcpclient.js');
const { Orchestrator } = await import('../src/orchestrator.js');

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running MCP bridge tests...\n');

const tools = await discoverTools();
assert(tools.some(t => t.server === 'echo' && t.name === 'echo'), 'discoverTools() finds the echo server tool');

const direct = await callTool('echo', 'echo', { text: 'direct' });
assert(direct === 'echo: direct', 'callTool() returns the MCP text content');

// Route a <tool:mcp> call through the orchestrator tool-loop using a fake agent.
let turn = 0;
const fakeAgent = {
  name: 'A', role: 'tester',
  respond: async (_messages, opts) => {
    turn++;
    // The MCP tool list must be injected into the agent's context.
    if (turn === 1) assert(/echo/.test(opts?.extraSystem || ''), 'MCP tool list injected into the agent turn');
    return turn === 1
      ? { content: '<tool:mcp server="echo" name="echo">{"text":"bridged"}</tool:mcp>', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
      : { content: '[FINISHED] done', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  },
};

const orch = new Orchestrator({ agents: [fakeAgent], mcpTools: [{ server: 'echo', name: 'echo', description: 'echoes text' }] });
const messages = [{ role: 'user', content: 'go' }];
const res = await orch.runAgentWithTools(fakeAgent, messages, null);

assert(messages.some(m => m.content.includes('echo: bridged')), 'orchestrator routes <tool:mcp> to the server and feeds the result back');
assert(res.content.includes('[FINISHED]'), 'agent completes after the tool result');

console.log('\nMCP bridge tests passed.');
