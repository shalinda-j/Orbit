import { loadConfig, addToProjectConfig, addToGlobalConfig } from '../orbitconfig.js';
import { withServer } from '../mcpclient.js';

export default {
  name: 'mcp',
  help: 'connect to MCP (Model Context Protocol) stdio servers',
  commands: {
    add: {
      desc: 'mcp add --name X --command npx --args "-y,@modelcontextprotocol/server-filesystem,." [--project]',
      run: async (args, ctx) => {
        const { name, command, args: a } = args;
        if (!name) throw new Error('--name required');
        if (!command) throw new Error('--command required');
        const serverArgs = String(a || '').split(',').filter(Boolean);
        // Default to GLOBAL config — MCP servers execute code, so they're trusted only when the
        // user adds them, not when a cloned repo ships them. --project stores per-repo (untrusted
        // unless ORBIT_TRUST_PROJECT=1).
        const f = args.project
          ? addToProjectConfig('mcp.servers', { name, command, args: serverArgs })
          : addToGlobalConfig('mcp.servers', { name, command, args: serverArgs });
        ctx.print(`added mcp server '${name}' -> ${command} ${serverArgs.join(' ')}`);
        ctx.print(`saved to ${f}`);
      },
    },
    list: {
      desc: 'mcp list',
      run: async (_args, ctx) => {
        const cfg = loadConfig();
        const servers = cfg.mcp?.servers || [];
        if (!servers.length) ctx.print('no mcp servers configured (add one with: orbit mcp add)');
        for (const s of servers) ctx.print(`${s.name} -> ${s.command} ${(s.args || []).join(' ')}`);
        if (cfg._projectHasCode && !cfg._trustProject) {
          ctx.print('\n  ⚠ this project\'s ./.orbit/config.json defines MCP servers/plugins/hooks that are IGNORED');
          ctx.print('    for safety (a cloned repo could inject code). Set ORBIT_TRUST_PROJECT=1 to enable them.');
        }
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
