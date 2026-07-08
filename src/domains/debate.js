import { withStore, readStore, nextId, logEvent } from '../store.js';

function find(s, id) {
  const d = s.debates.find(x => x.id === id);
  if (!d) throw new Error(`no debate #${id}`);
  return d;
}

// text arg comes from a positional (after the id) or --text
const textOf = (a) => a._[1] || a.text || '';

export default {
  name: 'debate',
  help: 'Structured argue-to-consensus',
  commands: {
    start: {
      desc: 'Start: debate start "topic" --options a,b,c --judge PM --rounds 3 --by X',
      run: async (a, ctx) => {
        const topic = a._[0] || a.topic;
        if (!topic) throw new Error('need a topic');
        const options = String(a.options || '').split(',').map(x => x.trim()).filter(Boolean);
        const id = await withStore(s => {
          const id = nextId(s, 'debate');
          s.debates.push({
            id, topic, options,
            status: 'open',
            round: 1,
            maxRounds: parseInt(a.rounds, 10) || 3,
            judge: a.judge || '',
            proposals: [], critiques: [],
            votes: {}, facts: {},
            verdict: '',
            by: a.by || '',
            ts: Date.now(),
          });
          logEvent(s, 'debate.start', a.by || '', { id, topic });
          return id;
        });
        ctx.print(`  ✓ debate #${id} open: ${topic}`);
      },
    },
    propose: {
      desc: 'Propose: debate propose <id> "text" --by X',
      run: async (a, ctx) => {
        const id = parseInt(a._[0], 10);
        const text = textOf(a);
        if (!text) throw new Error('need proposal text');
        await withStore(s => { find(s, id).proposals.push({ by: a.by || '', text, ts: Date.now() }); });
        ctx.print(`  ✓ #${id} proposal by ${a.by || '?'}`);
      },
    },
    critique: {
      desc: 'Critique: debate critique <id> "text" --by X',
      run: async (a, ctx) => {
        const id = parseInt(a._[0], 10);
        const text = textOf(a);
        if (!text) throw new Error('need critique text');
        await withStore(s => { find(s, id).critiques.push({ by: a.by || '', text, ts: Date.now() }); });
        ctx.print(`  ✓ #${id} critique by ${a.by || '?'}`);
      },
    },
    revise: {
      desc: 'Revise: debate revise <id> "text" --by X',
      run: async (a, ctx) => {
        const id = parseInt(a._[0], 10);
        const text = textOf(a);
        if (!text) throw new Error('need revised text');
        // ponytail: a revision is just a proposal flagged as such — no separate history needed
        await withStore(s => { find(s, id).proposals.push({ by: a.by || '', text, ts: Date.now(), revision: true }); });
        ctx.print(`  ✓ #${id} revised by ${a.by || '?'}`);
      },
    },
    vote: {
      desc: 'Vote: debate vote <id> --option a --by X',
      run: async (a, ctx) => {
        const id = parseInt(a._[0], 10);
        const option = a.option || a._[1];
        const by = a.by;
        if (!option) throw new Error('need --option');
        if (!by) throw new Error('need --by');
        await withStore(s => {
          const d = find(s, id);
          if (d.options.length && !d.options.includes(option)) throw new Error(`option must be one of ${d.options.join(', ')}`);
          d.votes[by] = option;
        });
        ctx.print(`  ✓ #${id} ${by} voted ${option}`);
      },
    },
    tally: {
      desc: 'Tally votes: debate tally <id>',
      run: async (a, ctx) => {
        const d = find(readStore(), parseInt(a._[0], 10));
        const counts = {};
        for (const opt of Object.values(d.votes)) counts[opt] = (counts[opt] || 0) + 1;
        ctx.print(`\n  Tally #${d.id}`);
        const rows = Object.entries(counts).sort((x, y) => y[1] - x[1]);
        if (!rows.length) return ctx.print('   (no votes)\n');
        for (const [opt, n] of rows) ctx.print(`   ${opt}: ${n}`);
        ctx.print('');
      },
    },
    judge: {
      desc: 'Judge: debate judge <id> --verdict "..." --by PM',
      run: async (a, ctx) => {
        const id = parseInt(a._[0], 10);
        const verdict = a.verdict || textOf(a);
        if (!verdict) throw new Error('need --verdict');
        await withStore(s => {
          const d = find(s, id);
          d.verdict = verdict;
          d.status = 'closed';
          logEvent(s, 'debate.judge', a.by || '', { id, verdict });
        });
        ctx.print(`  ✓ #${id} closed: ${verdict}`);
      },
    },
    next: {
      desc: 'Advance round: debate next <id>',
      run: async (a, ctx) => {
        const id = parseInt(a._[0], 10);
        const round = await withStore(s => {
          const d = find(s, id);
          if (d.round >= d.maxRounds) throw new Error(`already at final round ${d.maxRounds}`);
          d.round += 1;
          return d.round;
        });
        ctx.print(`  ✓ #${id} → round ${round}`);
      },
    },
    'set-fact': {
      desc: 'Set fact: debate set-fact <id> --key k --value v',
      run: async (a, ctx) => {
        const id = parseInt(a._[0], 10);
        const key = a.key;
        if (!key) throw new Error('need --key');
        await withStore(s => { find(s, id).facts[key] = a.value ?? ''; });
        ctx.print(`  ✓ #${id} fact ${key}`);
      },
    },
    facts: {
      desc: 'Show facts: debate facts <id>',
      run: async (a, ctx) => {
        const d = find(readStore(), parseInt(a._[0], 10));
        const keys = Object.keys(d.facts);
        ctx.print(`\n  Facts #${d.id}`);
        if (!keys.length) return ctx.print('   (none)\n');
        for (const k of keys) ctx.print(`   ${k} = ${d.facts[k]}`);
        ctx.print('');
      },
    },
    show: {
      desc: 'Show one debate: debate show <id>',
      run: async (a, ctx) => {
        const d = find(readStore(), parseInt(a._[0], 10));
        ctx.print(`\n  Debate #${d.id}: ${d.topic}`);
        ctx.print(`   status: ${d.status}   round: ${d.round}/${d.maxRounds}   judge: ${d.judge || '-'}`);
        if (d.options.length) ctx.print(`   options: ${d.options.join(', ')}`);
        if (d.proposals.length) {
          ctx.print('   proposals:');
          for (const p of d.proposals) ctx.print(`     - ${p.by || '?'}${p.revision ? ' (rev)' : ''}: ${p.text}`);
        }
        if (d.critiques.length) {
          ctx.print('   critiques:');
          for (const c of d.critiques) ctx.print(`     - ${c.by || '?'}: ${c.text}`);
        }
        const votes = Object.entries(d.votes);
        if (votes.length) ctx.print(`   votes: ${votes.map(([r, o]) => `${r}=${o}`).join(', ')}`);
        if (d.verdict) ctx.print(`   verdict: ${d.verdict}`);
        ctx.print('');
      },
    },
    list: {
      desc: 'List debates: debate list',
      run: async (a, ctx) => {
        const s = readStore();
        if (!s.debates.length) return ctx.print('  (no debates)');
        ctx.print('\n  Debates');
        for (const d of s.debates) ctx.print(`   #${d.id} [${d.status}] ${d.topic}  (r${d.round}/${d.maxRounds})`);
        ctx.print('');
      },
    },
  },
};
