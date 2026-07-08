import { withStore, readStore, nextId, logEvent } from '../store.js';

// Parse "Backend:claude, QA:codex" -> [{ role:'Backend', cli:'claude' }, ...]
// note: cli is optional; "Backend" alone -> { role:'Backend', cli:'' }.
function parseTeam(team) {
  return String(team || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const [role, cli] = pair.split(':').map(x => (x || '').trim());
      return { role, cli: cli || '' };
    })
    .filter(m => m.role);
}

function find(s, name) {
  const t = s.templates.find(x => x.name === name);
  if (!t) throw new Error(`no template "${name}"`);
  return t;
}

export default {
  name: 'template',
  help: 'Reusable team/goal templates',
  commands: {
    save: {
      desc: 'Upsert: template save --name X --goal "..." --team "Backend:claude,QA:codex" --acceptance "a;b"',
      run: async (a, ctx) => {
        const name = a.name || a._[0];
        if (!name) throw new Error('need --name');
        if (!a.goal) throw new Error('need --goal');
        await withStore(s => {
          const tpl = { name, goal: a.goal, team: a.team || '', acceptance: a.acceptance || '' };
          const i = s.templates.findIndex(x => x.name === name);
          if (i >= 0) s.templates[i] = tpl; else s.templates.push(tpl);
          logEvent(s, 'template.save', a.by || '', { name });
        });
        ctx.print(`  ✓ template "${name}" saved`);
      },
    },
    list: {
      desc: 'List templates',
      run: async (a, ctx) => {
        const ts = readStore().templates;
        if (!ts.length) return ctx.print('  (no templates)');
        ctx.print('\n  Templates');
        for (const t of ts) ctx.print(`   ${t.name}  — ${t.goal}${t.team ? `  [${t.team}]` : ''}`);
        ctx.print('');
      },
    },
    show: {
      desc: 'Show one: template show <name>',
      run: async (a, ctx) => {
        const t = find(readStore(), a._[0] || a.name);
        ctx.print(`\n  ${t.name}`);
        ctx.print(`   goal: ${t.goal}`);
        ctx.print(`   team: ${t.team || '-'}`);
        if (t.acceptance) ctx.print(`   acceptance: ${t.acceptance}`);
        ctx.print('');
      },
    },
    run: {
      desc: 'Materialize: template run <name> --by X',
      run: async (a, ctx) => {
        const name = a._[0] || a.name;
        if (!name) throw new Error('need a template name');
        const by = a.by || '';
        const res = await withStore(s => {
          const t = find(s, name);
          const members = parseTeam(t.team);
          const now = Date.now();
          const acceptance = t.acceptance || '';

          const parentId = nextId(s, 'task');
          s.tasks.push({
            id: parentId, title: t.goal, assignee: '', status: 'todo',
            priority: 'high', dependsOn: [], parentId: 0,
            acceptance, createdBy: by, createdAt: now, updatedAt: now,
          });

          const childIds = [];
          for (const m of members) {
            const id = nextId(s, 'task');
            s.tasks.push({
              id, title: `${m.role}: ${t.goal}`, assignee: m.role, status: 'todo',
              priority: 'medium', dependsOn: [], parentId,
              acceptance: '', createdBy: by, createdAt: now, updatedAt: now,
            });
            childIds.push(id);
          }

          const msgId = nextId(s, 'message');
          s.messages.push({ id: msgId, from: by || 'template', text: `Goal: ${t.goal}`, mention: '', ts: now, readBy: [] });

          logEvent(s, 'template.run', by, { name, parentId, childIds });
          return { parentId, childIds, members };
        });
        ctx.print(`  ✓ ran "${name}" — goal #${res.parentId}, ${res.childIds.length} role task(s)`);
        res.members.forEach((m, i) => ctx.print(`     #${res.childIds[i]} → ${m.role}${m.cli ? ` (${m.cli})` : ''}`));
      },
    },
    remove: {
      desc: 'Remove: template remove <name>',
      run: async (a, ctx) => {
        const name = a._[0] || a.name;
        if (!name) throw new Error('need a template name');
        await withStore(s => {
          const i = s.templates.findIndex(x => x.name === name);
          if (i < 0) throw new Error(`no template "${name}"`);
          s.templates.splice(i, 1);
          logEvent(s, 'template.remove', a.by || '', { name });
        });
        ctx.print(`  ✓ template "${name}" removed`);
      },
    },
  },
};
