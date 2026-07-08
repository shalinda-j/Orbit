import { loadConfig, addToProjectConfig } from '../orbitconfig.js';

export default {
  name: 'plugin',
  help: 'Manage plugins (JS modules that extend orbit)',
  commands: {
    list: {
      desc: 'List configured plugins',
      run: async (_a, ctx) => {
        const p = loadConfig().plugins;
        if (!p.length) return ctx.print('  (no plugins)  — add one with: orbit plugin add ./my-plugin.js');
        ctx.print('\n  Plugins');
        for (const spec of p) ctx.print(`   · ${spec}`);
        ctx.print('');
      },
    },
    add: {
      desc: 'Register a plugin: plugin add <path-or-package>',
      run: async (a, ctx) => {
        const spec = a._[0] || a.path;
        if (!spec) throw new Error('need a plugin path or package name');
        const f = addToProjectConfig('plugins', spec);
        ctx.print(`  ✓ added plugin "${spec}" → ${f}`);
        ctx.print('    restart orbit to load it. A plugin exports register(api) where api can:');
        ctx.print('      addProvider(name, instance) · addDomain({name,help,commands}) · addHook(event, fn) · addSkill({name,description,instructions})');
      },
    },
  },
};
