import { withStore, readStore, nextId, logEvent } from '../store.js';

// approval — simple approval gate. Store in store.approvals[].

async function decide(id, status, by, note) {
  if (!id) throw new Error('need <id>');
  if (!by) throw new Error('need --by <role>');
  return withStore((store) => {
    const a = store.approvals.find(x => x.id === id);
    if (!a) throw new Error(`no approval #${id}`);
    a.status = status;
    a.decidedBy = by;
    if (note !== undefined) a.note = note;
    logEvent(store, `approval.${status}`, by, { id });
    return a;
  });
}

export default {
  name: 'approval',
  help: 'approval gate: request / approve / reject / check / list',
  commands: {
    request: {
      desc: "'approval request \"what\" --by X'",
      run: async (args, ctx) => {
        const what = args._.join(' ').trim();
        if (!what) throw new Error('need "what" to approve');
        if (!args.by) throw new Error('need --by <role>');
        const a = await withStore((store) => {
          const rec = {
            id: nextId(store, 'approval'),
            what,
            requestedBy: args.by,
            status: 'pending',
            decidedBy: null,
            note: null,
            ts: Date.now(),
          };
          store.approvals.push(rec);
          logEvent(store, 'approval.request', args.by, { id: rec.id, what });
          return rec;
        });
        ctx.print(`approval #${a.id} requested by ${a.requestedBy}: ${a.what}`);
      },
    },
    approve: {
      desc: "'approval approve <id> --by X [--note \"...\"]'",
      run: async (args, ctx) => {
        const a = await decide(parseInt(args._[0], 10), 'approved', args.by, args.note);
        ctx.print(`approval #${a.id} approved by ${a.decidedBy}`);
      },
    },
    reject: {
      desc: "'approval reject <id> --by X [--note \"...\"]'",
      run: async (args, ctx) => {
        const a = await decide(parseInt(args._[0], 10), 'rejected', args.by, args.note);
        ctx.print(`approval #${a.id} rejected by ${a.decidedBy}`);
      },
    },
    check: {
      desc: "'approval check <id>'",
      run: async (args, ctx) => {
        const id = parseInt(args._[0], 10);
        if (!id) throw new Error('need <id>');
        const a = readStore().approvals.find(x => x.id === id);
        if (!a) throw new Error(`no approval #${id}`);
        ctx.print(`#${a.id} ${a.status}${a.decidedBy ? ` by ${a.decidedBy}` : ''}${a.note ? ` — ${a.note}` : ''}`);
      },
    },
    list: {
      desc: "'approval list [--pending]'",
      run: async (args, ctx) => {
        let rows = readStore().approvals;
        if (args.pending) rows = rows.filter(a => a.status === 'pending');
        if (!rows.length) { ctx.print('(no approvals)'); return; }
        for (const a of rows) {
          ctx.print(`#${a.id} [${a.status}] ${a.what} (by ${a.requestedBy}${a.decidedBy ? `, decided ${a.decidedBy}` : ''})`);
        }
      },
    },
  },
};
