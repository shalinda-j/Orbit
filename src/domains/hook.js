import { loadConfig, addHookToProjectConfig } from '../orbitconfig.js';

// Events orbit currently emits (more can be added over time).
const EVENTS = ['session.start', 'run.before', 'run.after'];

export default {
  name: 'hook',
  help: 'Run shell commands on orbit events',
  commands: {
    list: {
      desc: 'List configured hooks',
      run: async (_a, ctx) => {
        const hooks = loadConfig().hooks;
        const keys = Object.keys(hooks);
        if (!keys.length) return ctx.print(`  (no hooks)  · events: ${EVENTS.join(', ')}`);
        ctx.print('\n  Hooks');
        for (const ev of keys) for (const cmd of hooks[ev]) ctx.print(`   ${ev.padEnd(14)} → ${cmd}`);
        ctx.print('');
      },
    },
    add: {
      desc: `Add a hook: hook add --on <event> --run "<command>"   (events: ${EVENTS.join(', ')})`,
      run: async (a, ctx) => {
        const event = a.on || a._[0];
        const command = a.run || a._[1];
        if (!event || !command) throw new Error('need --on <event> and --run "<command>"');
        if (!EVENTS.includes(event)) ctx.print(`  ! note: "${event}" is not a known event (${EVENTS.join(', ')}) — saved anyway`);
        const f = addHookToProjectConfig(event, command);
        ctx.print(`  ✓ hook on ${event} → ${command}`);
        ctx.print(`    ${f}  ·  the command gets ORBIT_EVENT and ORBIT_CONTEXT in its env.`);
      },
    },
    events: {
      desc: 'List the events you can hook',
      run: async (_a, ctx) => ctx.print('  events: ' + EVENTS.join(', ')),
    },
  },
};
