import { loadConfig, addToProjectConfig } from '../orbitconfig.js';
import { withServer } from '../mcpclient.js';

export default {
  name: 'mcp',
  help: 'connect to MCP (Model Context Protocol) stdio servers',
  commands: {
    add: {
      desc: 'mcp add --name X --command "npx" --args "-y,@modelcontextprotocol/server-filesystem,."',
      run: async (args, ctx) => {
        const { name, command, args: a } = args;
        if (!name) throw new Error('--name required');
        if (!command) throw new Error('--command required');
        const serverArgs = String(a || '').split(',').filter(Boolean);
        const f = addToProjectConfig('mcp.servers', { name, command, args: serverArgs });
        ctx.print(`added mcp server '${name}' -> ${command} ${serverArgs.join(' ')}`);
        ctx.print(`saved to ${f}`);
      },
    },
    list: {
      desc: 'mcp list',
      run: async (_args, ctx) => {
        const servers = loadConfig().mcp?.servers || [];
        if (!servers.length) return ctx.print('no mcp servers configured (add one with: orbit mcp add)');
        for (const s of servers) ctx.print(`${s.name} -> ${s.command} ${(s.args || []).join(' ')}`);
      },
    },
    tools: {
      desc: 'mcp tools <name>',
      run: async (args, ctx) => {
        const res = await withServer(args._[0], (c) => c.request('tools/list', {}));
        const tools = res.tools || [];
        if (!tools.length) return ctx.print('(no tools)');
        for (const t of tools) ctx.print(`${t.name}\t${t.description || ''}`);
      },
    },
    call: {
      desc: `mcp call <name> <tool> --args '{"path":"."}'`,
      run: async (args, ctx) => {
        const [name, tool] = args._;
        if (!tool) throw new Error('usage: mcp call <name> <tool> --args \'{...}\'');
        let toolArgs;
        try { toolArgs = JSON.parse(args.args || '{}'); } catch { throw new Error('--args must be valid JSON'); }
        const res = await withServer(name, (c) => c.request('tools/call', { name: tool, arguments: toolArgs }));
        const parts = (res.content || []).filter((p) => p.type === 'text').map((p) => p.text);
        ctx.print(parts.length ? parts.join('\n') : JSON.stringify(res, null, 2));
      },
    },
  },
};
