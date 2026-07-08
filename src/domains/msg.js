import { withStore, readStore, nextId, logEvent } from '../store.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default {
  name: 'msg',
  help: 'Shared team channel',
  commands: {
    post: {
      desc: 'Post: msg post "text" --from Backend --mention QA',
      run: async (a, ctx) => {
        const text = a._[0] || a.text;
        if (!text) throw new Error('need message text');
        const from = a.from || 'anon';
        const id = await withStore(s => {
          const id = nextId(s, 'message');
          s.messages.push({ id, from, text, mention: a.mention || '', ts: Date.now(), readBy: [] });
          logEvent(s, 'msg.post', from, { id, mention: a.mention || '' });
          return id;
        });
        ctx.print(`  ✓ posted #${id}${a.mention ? ` @${a.mention}` : ''}`);
      },
    },
    read: {
      desc: 'Read: msg read [--from X] [--mention Me] [--n 20]',
      run: async (a, ctx) => {
        let m = readStore().messages;
        if (a.from) m = m.filter(x => x.from === a.from);
        if (a.mention) m = m.filter(x => !x.mention || x.mention === a.mention);
        m = m.slice(-(parseInt(a.n, 10) || 20));
        if (!m.length) return ctx.print('  (no messages)');
        ctx.print('\n  Channel');
        for (const x of m) ctx.print(`   [#${x.id}] ${x.from}${x.mention ? ` @${x.mention}` : ''}: ${x.text}`);
        ctx.print('');
      },
    },
    wait: {
      desc: 'Block until a new message (mentioning you) arrives: msg wait --role X [--timeout 60]',
      run: async (a, ctx) => {
        const role = a.role;
        const timeout = (parseInt(a.timeout, 10) || 60) * 1000;
        const start = Date.now();
        const seen = new Set(readStore().messages.map(m => m.id));
        while (Date.now() - start < timeout) {
          const fresh = readStore().messages.filter(m => !seen.has(m.id) && (!role || !m.mention || m.mention === role));
          if (fresh.length) {
            for (const x of fresh) ctx.print(`   [#${x.id}] ${x.from}${x.mention ? ` @${x.mention}` : ''}: ${x.text}`);
            return 0;
          }
          await sleep(1500);
        }
        ctx.print('  (timeout, no new messages)');
        return 0;
      },
    },
    ack: {
      desc: 'Acknowledge: msg ack <id> --role X',
      run: async (a, ctx) => {
        const id = parseInt(a._[0], 10);
        await withStore(s => { const m = s.messages.find(x => x.id === id); if (m && a.role && !m.readBy.includes(a.role)) m.readBy.push(a.role); });
        ctx.print(`  ✓ acked #${id}`);
      },
    },
  },
};
