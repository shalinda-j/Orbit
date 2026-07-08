// orbit plugin — GitHub & GitLab raw REST API (token-based, no gh/glab CLI needed).
//
//   orbit plugin add ./plugins/git-api.js      (then restart orbit)
//   export GITHUB_TOKEN=ghp_...                 (or GH_TOKEN)
//   export GITLAB_TOKEN=glpat-...               (GITLAB_URL for self-hosted)
//
// Adds domains `ghapi` and `glapi`. `fetch` is global in modern Node — no deps.

async function callJson(url, { method = 'GET', headers, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${(data && data.message) || String(text).slice(0, 200)}`);
  return data;
}

// ── GitHub ──
function ghHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('set GITHUB_TOKEN (or GH_TOKEN) in your env');
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'orbit-cli' };
}
const gh = (p, opts = {}) =>
  callJson(p.startsWith('http') ? p : `https://api.github.com/${p.replace(/^\//, '')}`, { ...opts, headers: ghHeaders() });

// ── GitLab ──
function glHeaders() {
  const token = process.env.GITLAB_TOKEN;
  if (!token) throw new Error('set GITLAB_TOKEN in your env');
  return { 'PRIVATE-TOKEN': token };
}
const glBase = () => (process.env.GITLAB_URL || 'https://gitlab.com') + '/api/v4';
const gl = (p, opts = {}) =>
  callJson(p.startsWith('http') ? p : `${glBase()}/${p.replace(/^\//, '')}`, { ...opts, headers: glHeaders() });
const enc = (projectPath) => encodeURIComponent(projectPath);

export function register(api) {
  api.addDomain({
    name: 'ghapi',
    help: 'GitHub REST API (token) — me, repo, issues, issue-create, prs, get',
    commands: {
      me: { desc: 'ghapi me', run: async (a, ctx) => { const u = await gh('user'); ctx.print(`  ${u.login}${u.name ? ` (${u.name})` : ''} · ${u.public_repos} repos`); } },
      repo: {
        desc: 'ghapi repo <owner/repo>',
        run: async (a, ctx) => { const r = await gh(`repos/${a._[0]}`); ctx.print(`  ${r.full_name}  ★${r.stargazers_count}  ${r.language || ''}\n  ${r.description || ''}\n  ${r.html_url}`); },
      },
      issues: {
        desc: 'ghapi issues <owner/repo> [--state open|closed|all]',
        run: async (a, ctx) => {
          const list = await gh(`repos/${a._[0]}/issues?state=${a.state || 'open'}&per_page=30`);
          if (!list.length) return ctx.print('  (no issues)');
          for (const i of list) if (!i.pull_request) ctx.print(`  #${i.number}  ${i.title}  (${i.user.login})`);
        },
      },
      'issue-create': {
        desc: 'ghapi issue-create <owner/repo> --title "..." [--body "..."]',
        run: async (a, ctx) => {
          if (!a.title) throw new Error('--title required');
          const r = await gh(`repos/${a._[0]}/issues`, { method: 'POST', body: { title: a.title, body: a.body || '' } });
          ctx.print(`  ✓ created #${r.number} → ${r.html_url}`);
        },
      },
      prs: {
        desc: 'ghapi prs <owner/repo> [--state open]',
        run: async (a, ctx) => {
          const list = await gh(`repos/${a._[0]}/pulls?state=${a.state || 'open'}&per_page=30`);
          if (!list.length) return ctx.print('  (no pull requests)');
          for (const p of list) ctx.print(`  #${p.number}  ${p.title}  (${p.user.login})`);
        },
      },
      get: { desc: 'ghapi get <api/path> — raw GET, prints JSON', run: async (a, ctx) => ctx.print(JSON.stringify(await gh(a._[0]), null, 2)) },
    },
  });

  api.addDomain({
    name: 'glapi',
    help: 'GitLab REST API (token) — project, issues, issue-create, mrs, get',
    commands: {
      project: {
        desc: 'glapi project <group/project>',
        run: async (a, ctx) => { const p = await gl(`projects/${enc(a._[0])}`); ctx.print(`  ${p.path_with_namespace}  ★${p.star_count}\n  ${p.description || ''}\n  ${p.web_url}`); },
      },
      issues: {
        desc: 'glapi issues <group/project> [--state opened|closed]',
        run: async (a, ctx) => {
          const list = await gl(`projects/${enc(a._[0])}/issues?state=${a.state || 'opened'}&per_page=30`);
          if (!list.length) return ctx.print('  (no issues)');
          for (const i of list) ctx.print(`  #${i.iid}  ${i.title}  (${i.author.username})`);
        },
      },
      'issue-create': {
        desc: 'glapi issue-create <group/project> --title "..." [--desc "..."]',
        run: async (a, ctx) => {
          if (!a.title) throw new Error('--title required');
          const r = await gl(`projects/${enc(a._[0])}/issues`, { method: 'POST', body: { title: a.title, description: a.desc || '' } });
          ctx.print(`  ✓ created #${r.iid} → ${r.web_url}`);
        },
      },
      mrs: {
        desc: 'glapi mrs <group/project> [--state opened]',
        run: async (a, ctx) => {
          const list = await gl(`projects/${enc(a._[0])}/merge_requests?state=${a.state || 'opened'}&per_page=30`);
          if (!list.length) return ctx.print('  (no merge requests)');
          for (const m of list) ctx.print(`  !${m.iid}  ${m.title}  (${m.author.username})`);
        },
      },
      get: { desc: 'glapi get <api/path> — raw GET, prints JSON', run: async (a, ctx) => ctx.print(JSON.stringify(await gl(a._[0]), null, 2)) },
    },
  });

  api.log('git-api plugin: added domains "ghapi" and "glapi" (set GITHUB_TOKEN / GITLAB_TOKEN)');
}

export default { register };
