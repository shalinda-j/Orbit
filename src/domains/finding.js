import { withStore, readStore, nextId, logEvent } from '../store.js';

// Security findings board. Parity with report_finding/list_findings/get_finding/
// triage_finding/verify_fix/self_review/security_report/start_security_audit.

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const STATUSES = ['open', 'triaged', 'fixed', 'verified', 'wontfix'];

function fmt(f) {
  return `#${f.id} [${f.severity}] ${f.status}  ${f.title}` +
    (f.role ? `  (by ${f.role})` : '') +
    (f.location ? `  @${f.location}` : '') +
    (f.category ? `  {${f.category}}` : '');
}

export default {
  name: 'finding',
  help: 'security findings board',
  commands: {
    report: {
      desc: "'finding report --role X --title \"...\" --severity high --location f.js:42 --desc \"...\" --rec \"...\" --category injection'",
      run: async (args, ctx) => {
        const title = args.title;
        if (!title) throw new Error('finding report needs --title');
        const severity = (args.severity || 'medium').toLowerCase();
        if (!SEVERITIES.includes(severity)) throw new Error(`severity must be one of ${SEVERITIES.join('|')}`);
        const f = await withStore(async (store) => {
          const finding = {
            id: nextId(store, 'finding'),
            role: args.role || 'unknown',
            title,
            severity,
            location: args.location || '',
            description: args.desc || '',
            recommendation: args.rec || '',
            category: args.category || 'general',
            status: 'open',
            ts: Date.now(),
          };
          store.findings.push(finding);
          logEvent(store, 'finding.report', finding.role, { id: finding.id, severity, title });
          return finding;
        });
        ctx.print(`reported ${fmt(f)}`);
      },
    },

    list: {
      desc: "'finding list [--severity high] [--status open] [--category injection]'",
      run: async (args, ctx) => {
        const store = readStore();
        let items = store.findings;
        if (args.severity) items = items.filter(f => f.severity === String(args.severity).toLowerCase());
        if (args.status) items = items.filter(f => f.status === String(args.status).toLowerCase());
        if (args.category) items = items.filter(f => f.category === args.category);
        if (!items.length) { ctx.print('no findings'); return; }
        // ponytail: critical-first ordering by fixed severity rank, no configurable sort.
        items = [...items].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
        for (const f of items) ctx.print(fmt(f));
      },
    },

    show: {
      desc: "'finding show <id>'",
      run: async (args, ctx) => {
        const id = parseInt(args._[0], 10);
        if (!id) throw new Error('finding show needs <id>');
        const f = readStore().findings.find(x => x.id === id);
        if (!f) throw new Error(`no finding #${id}`);
        ctx.print(fmt(f));
        if (f.description) ctx.print(`  desc: ${f.description}`);
        if (f.recommendation) ctx.print(`  rec:  ${f.recommendation}`);
        ctx.print(`  reported: ${new Date(f.ts).toISOString()}`);
      },
    },

    triage: {
      desc: "'finding triage <id> --status triaged'  (or --severity to reclassify)",
      run: async (args, ctx) => {
        const id = parseInt(args._[0], 10);
        if (!id) throw new Error('finding triage needs <id>');
        const status = args.status ? String(args.status).toLowerCase() : 'triaged';
        if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join('|')}`);
        if (args.severity && !SEVERITIES.includes(String(args.severity).toLowerCase()))
          throw new Error(`severity must be one of ${SEVERITIES.join('|')}`);
        const f = await withStore(async (store) => {
          const finding = store.findings.find(x => x.id === id);
          if (!finding) throw new Error(`no finding #${id}`);
          finding.status = status;
          if (args.severity) finding.severity = String(args.severity).toLowerCase();
          logEvent(store, 'finding.triage', args.role || 'triage', { id, status: finding.status, severity: finding.severity });
          return finding;
        });
        ctx.print(`triaged ${fmt(f)}`);
      },
    },

    verify: {
      desc: "'finding verify <id>'  (status -> verified)",
      run: async (args, ctx) => {
        const id = parseInt(args._[0], 10);
        if (!id) throw new Error('finding verify needs <id>');
        const f = await withStore(async (store) => {
          const finding = store.findings.find(x => x.id === id);
          if (!finding) throw new Error(`no finding #${id}`);
          finding.status = 'verified';
          logEvent(store, 'finding.verify', args.role || 'verify', { id });
          return finding;
        });
        ctx.print(`verified ${fmt(f)}`);
      },
    },

    summary: {
      desc: "'finding summary'  (security_report: counts by severity/status + open criticals)",
      run: async (args, ctx) => {
        const items = readStore().findings;
        const bySev = Object.fromEntries(SEVERITIES.map(s => [s, 0]));
        const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
        for (const f of items) {
          if (f.severity in bySev) bySev[f.severity]++;
          if (f.status in byStatus) byStatus[f.status]++;
        }
        ctx.print(`findings: ${items.length}`);
        ctx.print('by severity: ' + SEVERITIES.map(s => `${s}=${bySev[s]}`).join(' '));
        ctx.print('by status:   ' + STATUSES.map(s => `${s}=${byStatus[s]}`).join(' '));
        const openCrit = items.filter(f => f.severity === 'critical' && !['verified', 'wontfix', 'fixed'].includes(f.status));
        ctx.print(`open criticals: ${openCrit.length}`);
        for (const f of openCrit) ctx.print('  ' + fmt(f));
      },
    },

    audit: {
      desc: "'finding audit --by X'  (start_security_audit: seed SAST/secrets/deps tasks + channel post)",
      run: async (args, ctx) => {
        const by = args.by || args.role || 'security';
        // ponytail: fixed 3-task checklist; expand the list here if the audit scope grows.
        const checklist = [
          'SAST review — static analysis of source',
          'Secrets scan — keys/tokens in repo & history',
          'Dependency review — known-vuln deps & licenses',
        ];
        const created = await withStore(async (store) => {
          const ids = [];
          const now = Date.now();
          for (const title of checklist) {
            const id = nextId(store, 'task');
            store.tasks.push({
              id, title, assignee: '', status: 'todo', priority: 'high', // 'todo' is a real board column; 'open' would be invisible
              dependsOn: [], parentId: 0, acceptance: '', createdBy: by,
              createdAt: now, updatedAt: now,
            });
            ids.push(id);
          }
          store.messages.push({
            id: nextId(store, 'message'),
            from: by,
            text: `Security audit started — tasks #${ids.join(', #')}: SAST, secrets, deps.`,
            mention: null,
            ts: now,
            readBy: [],
          });
          logEvent(store, 'finding.audit', by, { tasks: ids });
          return ids;
        });
        ctx.print(`security audit started by ${by} — tasks #${created.join(', #')}`);
      },
    },
  },
};
