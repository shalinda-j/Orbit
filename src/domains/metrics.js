import fs from 'fs';
import path from 'path';
import { readStore, withStore, logEvent, orbitDir } from '../store.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const TASK_STATUSES = ['todo', 'doing', 'review', 'done', 'blocked'];

const dayKey = (ts) => new Date(ts).toLocaleDateString();
const localTime = (ts) => new Date(ts).toLocaleString();

function countBy(items, key) {
  const out = {};
  for (const it of items) out[it[key] || '-'] = (out[it[key] || '-'] || 0) + 1;
  return out;
}

// note: fixed 20-cell bar; good enough for a terminal, no need for terminal-width probing.
function bar(n, max) {
  if (max <= 0) return '';
  return '█'.repeat(Math.round((n / max) * 20));
}

export default {
  name: 'metrics',
  help: 'Reports derived from the store',
  commands: {
    summary: {
      desc: "'metrics summary'  (counts by status, agents, messages, findings, events)",
      run: async (a, ctx) => {
        const s = readStore();
        const byStatus = countBy(s.tasks, 'status');
        ctx.print('\n  Summary');
        ctx.print(`   tasks: ${s.tasks.length}` + (s.tasks.length ? `  (${TASK_STATUSES.map(st => `${st} ${byStatus[st] || 0}`).join(', ')})` : ''));
        ctx.print(`   agents: ${s.agents.length}   messages: ${s.messages.length}   findings: ${s.findings.length}   events: ${s.events.length}`);
        ctx.print(`   team: ${Object.keys(s.team).length} role(s)`);
        ctx.print('');
      },
    },

    velocity: {
      desc: "'metrics velocity --days 7'  (tasks marked done per day)",
      run: async (a, ctx) => {
        const days = parseInt(a.days, 10) || 7;
        const since = Date.now() - days * 86400000;
        const store = readStore();
        const evts = store.events.filter(e => e.type === 'task.status' && e.data && e.data.status === 'done' && e.ts >= since);
        const perDay = {};
        for (const e of evts) perDay[dayKey(e.ts)] = (perDay[dayKey(e.ts)] || 0) + 1;
        ctx.print(`\n  Velocity (last ${days}d) — ${evts.length} done`);
        const keys = Object.keys(perDay).sort((x, y) => new Date(x) - new Date(y));
        if (!keys.length) ctx.print('   (none)');
        for (const k of keys) ctx.print(`   ${k}  ${'▪'.repeat(perDay[k])} ${perDay[k]}`);
        ctx.print('');
      },
    },

    burndown: {
      desc: "'metrics burndown'  (task counts per status as a bar)",
      run: async (a, ctx) => {
        const s = readStore();
        const by = countBy(s.tasks, 'status');
        const max = Math.max(1, ...TASK_STATUSES.map(st => by[st] || 0));
        ctx.print('\n  Burndown');
        for (const st of TASK_STATUSES) {
          const n = by[st] || 0;
          ctx.print(`   ${st.padEnd(7)} ${bar(n, max).padEnd(20)} ${n}`);
        }
        ctx.print('');
      },
    },

    bottlenecks: {
      desc: "'metrics bottlenecks'  (blocked/waiting tasks, busiest assignees)",
      run: async (a, ctx) => {
        const s = readStore();
        const doneIds = new Set(s.tasks.filter(t => t.status === 'done').map(t => t.id));
        const stuck = s.tasks.filter(t => t.status !== 'done' &&
          (t.status === 'blocked' || (t.dependsOn || []).some(d => !doneIds.has(d))));
        ctx.print('\n  Bottlenecks');
        if (!stuck.length) ctx.print('   no blocked/waiting tasks');
        for (const t of stuck) {
          const waits = (t.dependsOn || []).filter(d => !doneIds.has(d));
          ctx.print(`   #${t.id} ${t.title}  [${t.status}]${waits.length ? `  waits on ${waits.join(',')}` : ''}`);
        }
        const open = countBy(s.tasks.filter(t => t.status !== 'done' && t.assignee), 'assignee');
        const busy = Object.entries(open).sort((a, b) => b[1] - a[1]);
        if (busy.length) {
          ctx.print('   open tasks per assignee:');
          for (const [who, n] of busy) ctx.print(`     ${who}: ${n}`);
        }
        ctx.print('');
      },
    },

    retro: {
      desc: "'metrics retro'  (done tasks, open findings by severity, summary)",
      run: async (a, ctx) => {
        const s = readStore();
        const done = s.tasks.filter(t => t.status === 'done');
        const openFindings = s.findings.filter(f => f.status !== 'resolved' && f.status !== 'closed');
        const bySev = countBy(openFindings, 'severity');
        ctx.print('\n  Retrospective');
        ctx.print(`   completed ${done.length} task(s), ${s.tasks.length - done.length} still open`);
        for (const t of done) ctx.print(`     ✓ #${t.id} ${t.title}`);
        ctx.print(`   open findings: ${openFindings.length}`);
        for (const sev of SEVERITIES) if (bySev[sev]) ctx.print(`     ${sev}: ${bySev[sev]}`);
        const crit = (bySev.critical || 0) + (bySev.high || 0);
        ctx.print(`   → ${done.length ? `Shipped ${done.length} task(s). ` : ''}${crit ? `${crit} high-priority finding(s) need attention.` : 'No high-priority findings outstanding.'}`);
        ctx.print('');
      },
    },

    timeline: {
      desc: "'metrics timeline --n 30'  (recent events, newest last)",
      run: async (a, ctx) => {
        const n = parseInt(a.n, 10) || 30;
        const s = readStore();
        const evts = s.events.slice(-n);
        ctx.print(`\n  Timeline (last ${evts.length})`);
        if (!evts.length) ctx.print('   (no events)');
        for (const e of evts) {
          const d = e.data && Object.keys(e.data).length ? '  ' + JSON.stringify(e.data) : '';
          ctx.print(`   ${localTime(e.ts)}  ${e.type}${e.actor ? ` <${e.actor}>` : ''}${d}`);
        }
        ctx.print('');
      },
    },

    log: {
      desc: "'metrics log \"text\" --by X'  (append a project-log event)",
      run: async (a, ctx) => {
        const text = a._[0] || a.text;
        if (!text) throw new Error('need log text');
        await withStore(s => logEvent(s, 'log', a.by || '', { text }));
        ctx.print('  ✓ logged');
      },
    },

    export: {
      desc: "'metrics export --file path'  (write JSON report, default .orbit/report.json)",
      run: async (a, ctx) => {
        const s = readStore();
        const file = a.file ? path.resolve(a.file) : path.join(orbitDir(), 'report.json');
        const report = { tasks: s.tasks, findings: s.findings, team: s.team, generatedAt: new Date().toISOString() };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
        ctx.print(`  ✓ wrote ${file}`);
      },
    },
  },
};
