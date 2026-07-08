import { withStore, readStore, nextId, logEvent } from '../store.js';

const STATUSES = ['todo', 'doing', 'review', 'done', 'blocked'];

function find(s, id) {
  const t = s.tasks.find(x => x.id === id);
  if (!t) throw new Error(`no task #${id}`);
  return t;
}

async function setStatus(a, ctx, status) {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  const id = parseInt(a._[0], 10);
  await withStore(s => {
    const t = find(s, id);
    t.status = status;
    t.updatedAt = Date.now();
    logEvent(s, 'task.status', a.by || '', { id, status });
  });
  ctx.print(`  ✓ #${id} → ${status}`);
}

function renderBoard(s, ctx, mine) {
  if (!s.tasks.length) return ctx.print('  (board is empty)');
  ctx.print('\n  Board');
  for (const st of STATUSES) {
    const items = s.tasks.filter(t => t.status === st && (!mine || t.assignee === mine));
    if (!items.length) continue;
    ctx.print(`   ${st.toUpperCase()}`);
    for (const t of items) {
      const blocked = (t.dependsOn || []).filter(d => { const dep = s.tasks.find(x => x.id === d); return dep && dep.status !== 'done'; });
      ctx.print(`     #${t.id} ${t.title}${t.assignee ? `  (${t.assignee})` : ''}${t.priority === 'high' ? '  !' : ''}${blocked.length ? `  ⨯ waits on ${blocked.join(',')}` : ''}`);
    }
  }
  ctx.print('');
}

export default {
  name: 'task',
  help: 'Shared task board',
  commands: {
    add: {
      desc: 'Add: task add "title" --assignee X --priority high --depends 1,2 --parent 0 --by PM',
      run: async (a, ctx) => {
        const title = a._[0] || a.title;
        if (!title) throw new Error('need a title');
        const id = await withStore(s => {
          const id = nextId(s, 'task');
          s.tasks.push({
            id, title,
            assignee: a.assignee || '',
            status: 'todo',
            priority: a.priority || 'medium',
            dependsOn: String(a.depends || '').split(',').map(x => parseInt(x, 10)).filter(Boolean),
            parentId: parseInt(a.parent, 10) || 0,
            acceptance: a.acceptance || '',
            createdBy: a.by || '',
            createdAt: Date.now(), updatedAt: Date.now(),
          });
          logEvent(s, 'task.add', a.by || '', { id, title });
          return id;
        });
        ctx.print(`  ✓ #${id} added${a.assignee ? ` → ${a.assignee}` : ''}`);
      },
    },
    list: { desc: 'Show the board (--mine ROLE to filter)', run: async (a, ctx) => renderBoard(readStore(), ctx, a.mine) },
    board: { desc: 'Alias for list', run: async (a, ctx) => renderBoard(readStore(), ctx, a.mine) },
    assign: {
      desc: 'Assign: task assign <id> --to X',
      run: async (a, ctx) => {
        const id = parseInt(a._[0], 10);
        const to = a.to || a._[1] || '';
        await withStore(s => { const t = find(s, id); t.assignee = to; t.updatedAt = Date.now(); logEvent(s, 'task.assign', a.by || '', { id, to }); });
        ctx.print(`  ✓ #${id} → ${to}`);
      },
    },
    start: { desc: 'Mark a task doing', run: (a, ctx) => setStatus(a, ctx, 'doing') },
    done: { desc: 'Mark a task done', run: (a, ctx) => setStatus(a, ctx, 'done') },
    block: { desc: 'Mark a task blocked', run: (a, ctx) => setStatus(a, ctx, 'blocked') },
    update: { desc: 'Set status: task update <id> --status review', run: (a, ctx) => setStatus(a, ctx, a.status || a._[1]) },
    accept: {
      desc: 'Set acceptance criteria: task accept <id> --text "..."',
      run: async (a, ctx) => {
        const id = parseInt(a._[0], 10);
        await withStore(s => { const t = find(s, id); t.acceptance = a.text || a._[1] || ''; t.updatedAt = Date.now(); });
        ctx.print(`  ✓ #${id} acceptance set`);
      },
    },
    show: {
      desc: 'Show one task: task show <id>',
      run: async (a, ctx) => {
        const t = find(readStore(), parseInt(a._[0], 10));
        ctx.print(`\n  #${t.id} ${t.title}`);
        ctx.print(`   status: ${t.status}   priority: ${t.priority}   assignee: ${t.assignee || '-'}`);
        if (t.dependsOn?.length) ctx.print(`   depends on: ${t.dependsOn.join(', ')}`);
        if (t.acceptance) ctx.print(`   acceptance: ${t.acceptance}`);
        ctx.print('');
      },
    },
  },
};
