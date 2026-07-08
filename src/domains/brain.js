import { brainSave, brainSearch, brainGet, brainRecent, brainBacklinks } from '../brain.js';
import { withStore, readStore, logEvent } from '../store.js';

async function save(a, ctx) {
  const title = a._[0] || a.title;
  const content = a._[1] ?? a.content ?? '';
  const { slug } = brainSave({ title, content, category: a.category || '', tags: a.tags || '' });
  await withStore(s => logEvent(s, 'brain.save', a.by || '', { slug, title }));
  ctx.print(`  ✓ saved [[${slug}]]`);
}

export default {
  name: 'brain',
  help: 'Persistent knowledge base (company-brain style)',
  commands: {
    save: { desc: 'brain save "title" "content" --tags a,b --category x', run: save },
    add: { desc: 'Alias for save', run: save },
    search: {
      desc: 'brain search "query" [--tag t] [--category c] [--n 15]',
      run: async (a, ctx) => {
        const res = brainSearch({ query: a._[0] || a.query || '', tag: a.tag || '', category: a.category || '' });
        if (!res.length) return ctx.print('  (no matches)');
        ctx.print('\n  Brain');
        for (const n of res.slice(0, parseInt(a.n, 10) || 15)) ctx.print(`   [[${n.slug}]] ${n.title}${n.tags.length ? '  #' + n.tags.join(' #') : ''}`);
        ctx.print('');
      },
    },
    get: {
      desc: 'brain get <slug>',
      run: async (a, ctx) => {
        const n = brainGet(a._[0]);
        if (!n) return ctx.print('  (not found)');
        ctx.print(`\n  ${n.title}${n.category ? `  (${n.category})` : ''}${n.tags.length ? '  #' + n.tags.join(' #') : ''}\n`);
        ctx.print(n.body);
        ctx.print('');
      },
    },
    recent: {
      desc: 'brain recent [--n 10]',
      run: async (a, ctx) => {
        const res = brainRecent(parseInt(a.n, 10) || 10);
        if (!res.length) return ctx.print('  (brain is empty)');
        ctx.print('\n  Recent');
        for (const n of res) ctx.print(`   [[${n.slug}]] ${n.title}`);
        ctx.print('');
      },
    },
    backlinks: {
      desc: 'brain backlinks <slug>',
      run: async (a, ctx) => {
        const res = brainBacklinks(a._[0]);
        ctx.print(res.length ? '  ← ' + res.map(n => `[[${n.slug}]]`).join(', ') : '  (no backlinks)');
      },
    },
    activity: {
      desc: 'brain activity — recent brain events [--n 15]',
      run: async (a, ctx) => {
        const ev = readStore().events.filter(e => e.type.startsWith('brain.')).slice(-(parseInt(a.n, 10) || 15));
        if (!ev.length) return ctx.print('  (no activity)');
        ctx.print('\n  Activity');
        for (const e of ev) ctx.print(`   ${new Date(e.ts).toLocaleString()}  ${e.type}  ${e.data.title || e.data.slug || ''}`);
        ctx.print('');
      },
    },
  },
};
