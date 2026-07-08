import http from 'http';
import fs from 'fs';
import path from 'path';
import { readStore, orbitDir } from '../store.js';

// ─────────────────────────────────────────────
// Tiny live web view of team state. Parity with start_dashboard/stop_dashboard.
// No external assets — inline CSS, meta-refresh for auto-update.
// ─────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

const STATUSES = ['todo', 'in-progress', 'blocked', 'review', 'done'];

function render(store) {
  const team = Object.values(store.team || {});
  const tasks = store.tasks || [];
  const msgs = (store.messages || []).slice(-15).reverse();
  const findings = (store.findings || []).filter(f => f.status !== 'closed' && f.status !== 'resolved');

  // task board grouped by status (known statuses first, then any stragglers)
  const seen = new Set(STATUSES);
  const cols = [...STATUSES, ...[...new Set(tasks.map(t => t.status).filter(s => s && !seen.has(s)))]];
  const byStatus = (st) => tasks.filter(t => (t.status || 'todo') === st);

  const roster = team.length ? team.map(m => `
    <tr><td><b>${esc(m.role)}</b></td><td>${esc(m.cli || '')}</td>
        <td><span class="pill ${esc(m.status)}">${esc(m.status || '?')}</span></td>
        <td>${esc((m.skills || []).join(', '))}</td></tr>`).join('') : `<tr><td colspan="4" class="muted">no team members</td></tr>`;

  const board = cols.map(st => {
    const items = byStatus(st);
    return `<div class="col"><h3>${esc(st)} <span class="muted">(${items.length})</span></h3>
      ${items.map(t => `<div class="card p${esc(t.priority || '')}">
        <b>#${esc(t.id)}</b> ${esc(t.title)}
        <div class="muted">${t.assignee ? '@' + esc(t.assignee) : 'unassigned'}${t.priority ? ' · ' + esc(t.priority) : ''}</div>
      </div>`).join('') || '<div class="muted">—</div>'}
    </div>`;
  }).join('');

  const channel = msgs.length ? msgs.map(m => `<div class="msg">
    <b>${esc(m.from)}</b>${m.mention ? ' <span class="muted">→ @' + esc(m.mention) + '</span>' : ''}
    <span class="muted">${esc(new Date(m.ts || 0).toLocaleTimeString())}</span>
    <div>${esc(m.text)}</div></div>`).join('') : '<div class="muted">no messages</div>';

  const finds = findings.length ? findings.map(f => `<div class="finding sev-${esc(f.severity)}">
    <b>${esc(f.severity || '?')}</b> ${esc(f.title)}
    <div class="muted">${esc(f.location || '')} · ${esc(f.role || '')} · ${esc(f.status || 'open')}</div>
  </div>`).join('') : '<div class="muted">no open findings</div>';

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="3">
<title>orbit dashboard</title>
<style>
  body{font:14px/1.4 system-ui,Segoe UI,Arial,sans-serif;margin:0;background:#0e1116;color:#d7dde5}
  h1{font-size:18px;margin:0} h2{font-size:15px;border-bottom:1px solid #2a3140;padding-bottom:4px}
  h3{font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px;color:#9aa7b8}
  header{padding:12px 16px;background:#161b22;border-bottom:1px solid #2a3140;display:flex;gap:12px;align-items:baseline}
  .wrap{padding:16px;display:grid;gap:20px;grid-template-columns:1fr 1fr}
  section.full{grid-column:1/-1}
  table{border-collapse:collapse;width:100%} td{padding:4px 8px;border-bottom:1px solid #222833}
  .muted{color:#6b7686;font-size:12px}
  .pill{padding:1px 7px;border-radius:10px;font-size:11px;background:#2a3140}
  .pill.online,.pill.active,.pill.free{background:#1e4620;color:#7fe08a}
  .pill.busy,.pill.working{background:#4a3a12;color:#f0c66b}
  .board{display:flex;gap:10px;overflow-x:auto} .col{min-width:150px;flex:1}
  .card{background:#161b22;border:1px solid #2a3140;border-left:3px solid #3a4453;border-radius:4px;padding:6px 8px;margin-bottom:6px;font-size:12px}
  .card.phigh,.card.pP0,.card.pP1{border-left-color:#e0574f} .card.pmed,.card.pP2{border-left-color:#f0c66b}
  .msg{border-bottom:1px solid #222833;padding:6px 0;font-size:13px}
  .finding{border-left:3px solid #6b7686;padding:4px 8px;margin-bottom:6px;font-size:12px;background:#161b22}
  .finding.sev-high,.finding.sev-critical{border-left-color:#e0574f}
  .finding.sev-medium{border-left-color:#f0c66b} .finding.sev-low{border-left-color:#7fe08a}
</style></head><body>
<header><h1>🛰 orbit dashboard</h1><span class="muted">${esc(process.cwd())} · updated ${esc(new Date().toLocaleTimeString())} · auto-refresh 3s</span></header>
<div class="wrap">
  <section><h2>Team (${team.length})</h2><table>${roster}</table></section>
  <section><h2>Findings (${findings.length} open)</h2>${finds}</section>
  <section class="full"><h2>Task board (${tasks.length})</h2><div class="board">${board}</div></section>
  <section class="full"><h2>Channel</h2>${channel}</section>
</div></body></html>`;
}

export default {
  name: 'dashboard',
  help: 'live web view of team state (roster, tasks, messages, findings)',
  commands: {
    serve: {
      desc: "'dashboard serve [--port 7777]'  (blocks until Ctrl+C)",
      run: async (args, ctx) => {
        const port = parseInt(args.port, 10) || 7777;
        const server = http.createServer((req, res) => {
          if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(render(readStore())); // re-read fresh every request
        });
        await new Promise((resolve, reject) => {
          server.on('error', (e) => reject(
            e.code === 'EADDRINUSE'
              ? new Error(`port ${port} already in use — try: dashboard serve --port <other>`)
              : e
          ));
          server.listen(port, '127.0.0.1', () => { // bind loopback only — the board isn't for the whole LAN
            ctx.print(`dashboard live at http://localhost:${port}  (Ctrl+C to stop)`);
            // note: never resolve — the http server keeps the process alive until the user kills it.
          });
        });
      },
    },
    once: {
      desc: "'dashboard once [--file path]'  (write HTML snapshot, default .orbit/dashboard.html)",
      run: async (args, ctx) => {
        const file = args.file ? path.resolve(ctx.cwd || process.cwd(), args.file)
                               : path.join(orbitDir(), 'dashboard.html');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, render(readStore()), 'utf8');
        ctx.print(file);
      },
    },
  },
};
