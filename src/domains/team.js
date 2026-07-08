import { withStore, readStore, logEvent } from '../store.js';

const now = () => Date.now();

export default {
  name: 'team',
  help: 'Roster of who is on the team',
  commands: {
    join: {
      desc: 'Join as a role: team join --role Backend --cli claude [--skills a,b]',
      run: async (a, ctx) => {
        const role = a.role || a._[0];
        if (!role) throw new Error('need --role');
        await withStore(s => {
          s.team[role] = {
            role, cli: a.cli || 'human', status: 'online',
            skills: String(a.skills || '').split(',').filter(Boolean),
            lastSeen: now(), pid: process.pid,
          };
          logEvent(s, 'team.join', role, { cli: a.cli || 'human' });
        });
        ctx.print(`  ✓ ${role} joined the team.`);
      },
    },
    status: {
      desc: 'Show the roster and who is online',
      run: async (_a, ctx) => {
        const roles = Object.values(readStore().team);
        if (!roles.length) return ctx.print('  (no one has joined yet)');
        ctx.print('\n  Team');
        for (const r of roles) {
          const fresh = now() - r.lastSeen < 120000;
          const dot = (r.status === 'offline' || !fresh) ? '○' : '●';
          ctx.print(`   ${dot} ${r.role.padEnd(14)} ${String(r.cli || '').padEnd(8)} ${r.status}${r.skills?.length ? '  [' + r.skills.join(', ') + ']' : ''}`);
        }
        ctx.print('');
      },
    },
    'set-status': {
      desc: 'Update a role status: team set-status --role X --status busy',
      run: async (a, ctx) => {
        const role = a.role || a._[0];
        const status = a.status || a._[1] || 'online';
        await withStore(s => {
          if (!s.team[role]) throw new Error(`${role} is not on the team`);
          s.team[role].status = status;
          s.team[role].lastSeen = now();
          logEvent(s, 'team.status', role, { status });
        });
        ctx.print(`  ✓ ${role} → ${status}`);
      },
    },
    'who-free': {
      desc: 'List members that are online/idle',
      run: async (_a, ctx) => {
        const free = Object.values(readStore().team).filter(r => ['online', 'idle'].includes(r.status));
        ctx.print(free.length ? '  Free: ' + free.map(r => r.role).join(', ') : '  Nobody is free.');
      },
    },
    leave: {
      desc: 'Mark a role offline: team leave --role X',
      run: async (a, ctx) => {
        const role = a.role || a._[0];
        await withStore(s => { if (s.team[role]) { s.team[role].status = 'offline'; logEvent(s, 'team.leave', role); } });
        ctx.print(`  ✓ ${role} left.`);
      },
    },
  },
};
