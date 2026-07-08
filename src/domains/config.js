import fs from 'fs';
import { loadConfig, projectConfigFile, globalConfigFile } from '../orbitconfig.js';

export default {
  name: 'config',
  help: 'Show orbit config (providers, plugins, hooks, mcp, skills)',
  commands: {
    default: {
      desc: 'config — show the merged config',
      run: async (_a, ctx) => {
        const c = loadConfig();
        ctx.print('\n  orbit config (project + global merged)');
        ctx.print(`   providers   ${c.providers.length}`);
        ctx.print(`   plugins     ${c.plugins.length}${c.plugins.length ? '  ' + c.plugins.join(', ') : ''}`);
        ctx.print(`   mcp servers ${c.mcp.servers.length}${c.mcp.servers.length ? '  ' + c.mcp.servers.map(s => s.name).join(', ') : ''}`);
        ctx.print(`   hooks       ${Object.keys(c.hooks).length ? Object.keys(c.hooks).join(', ') : '(none)'}`);
        ctx.print(`   skills      ${c.skills.length}`);
        ctx.print('');
      },
    },
    path: {
      desc: 'Show config file locations',
      run: async (_a, ctx) => {
        const pf = projectConfigFile(), gf = globalConfigFile();
        ctx.print(`  project: ${pf}  ${fs.existsSync(pf) ? '(exists)' : '(none)'}`);
        ctx.print(`  global : ${gf}  ${fs.existsSync(gf) ? '(exists)' : '(none)'}`);
      },
    },
    show: {
      desc: 'Print the raw merged config JSON',
      run: async (_a, ctx) => ctx.print(JSON.stringify(loadConfig(), null, 2)),
    },
  },
};
