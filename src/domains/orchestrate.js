import { withStore, readStore, nextId, logEvent } from '../store.js';
import { brainSave } from '../brain.js';
import spawnDomain from './spawn.js';

// "--team" -> "Backend:claude, QA:codex" -> [{role:'Backend',cli:'claude'},{role:'QA',cli:'codex'}]
// cli defaults to claude when omitted ("Backend" -> {role:'Backend',cli:'claude'}).
function parseTeam(spec) {
  return String(spec || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const [role, cli] = pair.split(':').map(x => (x || '').trim());
      return { role, cli: (cli || 'claude').toLowerCase() };
    })
    .filter(m => m.role);
}

export default {
  name: 'orchestrate',
  help: 'Build me X with a team: spawn members, seed tasks, kick off',
  commands: {
    default: {
      desc: 'orchestrate "goal" --team "Backend:claude, QA:codex" [--dir path] [--acceptance "a;b"] [--by PM]',
      run: async (a, ctx) => {
        const goal = a._[0] || a.goal;
        if (!goal) throw new Error('need a goal: orchestrate "build X" --team "Role:cli, ..."');
        const team = parseTeam(a.team);
        if (!team.length) throw new Error('need --team "Role:cli, Role:cli"');
        const dir = a.dir || ctx.cwd;
        const by = a.by || 'PM';
        const acceptance = a.acceptance
          ? String(a.acceptance).split(';').map(s => s.trim()).filter(Boolean)
          : [];

        // One locked read-modify-write: parent task + per-role tasks + event + kickoff message.
        const created = await withStore(s => {
          const now = Date.now();
          const parentId = nextId(s, 'task');
          s.tasks.push({
            id: parentId, title: goal, assignee: 'PM', status: 'todo',
            priority: 'high', dependsOn: [], parentId: null, acceptance,
            createdBy: by, createdAt: now, updatedAt: now,
          });
          const taskIds = [parentId];
          for (const m of team) {
            const id = nextId(s, 'task');
            s.tasks.push({
              id, title: `${m.role}: contribute to "${goal}"`, assignee: m.role,
              status: 'todo', priority: 'normal', dependsOn: [], parentId,
              acceptance: [], createdBy: by, createdAt: now, updatedAt: now,
            });
            taskIds.push(id);
          }
          logEvent(s, 'orchestrate.start', by, { goal, acceptance, team });
          const mid = nextId(s, 'message');
          s.messages.push({
            id: mid, from: by,
            text: `Kickoff: "${goal}". Team: ${team.map(m => `${m.role}(${m.cli})`).join(', ')}.` +
              (acceptance.length ? ` Acceptance: ${acceptance.join('; ')}.` : '') +
              ' Claim your task with `orbit task list`.',
            mention: null, ts: now, readBy: [],
          });
          return taskIds.length;
        });

        // Persist the goal to the brain for later recall.
        try { brainSave({ title: goal, content: acceptance.join('\n'), category: 'goals' }); }
        catch (e) { ctx.print(`  ! brain save skipped (${e.message})`); }

        // Spawn one terminal per member — spawn.new posts each member's kickoff + records the agent.
        for (const m of team) {
          await spawnDomain.commands.new.run({ _: [], role: m.role, cli: m.cli, dir, by }, ctx);
        }

        ctx.print(`\n  Orchestrated: "${goal}"`);
        ctx.print(`   team   ${team.map(m => `${m.role}:${m.cli}`).join(', ')}`);
        ctx.print(`   tasks  ${created} created (1 goal + ${team.length} assignments)`);
        ctx.print(`   dir    ${dir}\n`);
      },
    },
    status: {
      desc: 'orchestrate status — one-screen overview (roster, board, recent messages)',
      run: async (_a, ctx) => {
        const s = readStore();
        const roles = Object.keys(s.team);
        const board = {};
        for (const t of s.tasks) board[t.status] = (board[t.status] || 0) + 1;
        const boardStr = Object.entries(board).map(([k, v]) => `${k}:${v}`).join('  ') || '(empty)';

        ctx.print('\n  Orchestrate status');
        ctx.print(`   roster   ${roles.length} member(s)${roles.length ? ' — ' + roles.join(', ') : ''}`);
        ctx.print(`   board    ${s.tasks.length} task(s)   ${boardStr}`);
        ctx.print('   recent messages');
        const recent = s.messages.slice(-3);
        if (!recent.length) ctx.print('     (none)');
        for (const m of recent) {
          const line = m.text.length > 70 ? m.text.slice(0, 67) + '...' : m.text;
          ctx.print(`     ${String(m.from).padEnd(10)} ${line}`);
        }
        ctx.print('');
      },
    },
  },
};
