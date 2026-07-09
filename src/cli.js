import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { extInit, extDomains } from './extensions.js';

// ─────────────────────────────────────────────
// Command dispatcher + plugin-style domain registry.
// Every capability lives in src/domains/<name>.js and default-exports:
//   { name, help, commands: { <action>: { desc, run(args, ctx) } } }
// Adding a domain never touches this file — it's auto-discovered. That keeps
// full-parity growth safe (and parallel-build-friendly).
// ─────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const domainsDir = path.join(__dirname, 'domains');

let _domains = null;
export async function loadDomains() {
  if (_domains) return _domains;
  _domains = Object.create(null); // null prototype: `/toString`, `/constructor` etc. aren't treated as domains
  for (const f of fs.readdirSync(domainsDir)) {
    if (!f.endsWith('.js')) continue;
    const mod = await import(pathToFileURL(path.join(domainsDir, f)).href);
    const d = mod.default;
    if (d && d.name && d.commands) _domains[d.name] = d;
  }
  // Merge in domains contributed by plugins/config.
  await extInit();
  Object.assign(_domains, extDomains());
  return _domains;
}

/** Minimal arg parser: positional args in `_`, `--k v` / `--k=v` flags, `--flag` booleans. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

/** True if argv[0] names a registered domain (so bin/orbit knows to dispatch vs. launch the TUI). */
export async function isCommand(argv) {
  if (!argv.length) return false;
  const domains = await loadDomains();
  return argv[0] in domains;
}

export async function helpText() {
  const domains = await loadDomains();
  const lines = ['', '  orbit — multi-agent team CLI', '', '  Usage: orbit <domain> <action> [args]   ·   orbit           (interactive TUI)', ''];
  for (const d of Object.values(domains).sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`  ${d.name.padEnd(10)} ${d.help || ''}`);
    for (const [action, cmd] of Object.entries(d.commands)) {
      lines.push(`     ${(d.name + ' ' + action).padEnd(22)} ${cmd.desc || ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function dispatch(argv) {
  const domains = await loadDomains();
  const [name, action, ...rest] = argv;
  const domain = domains[name];
  if (!domain) { console.log(await helpText()); return 1; }

  let cmd = domain.commands[action];
  let rest2 = rest;
  if (!cmd && domain.commands.default) {
    // e.g. `orbit run "goal"` — no explicit action, feed it to the default command.
    cmd = domain.commands.default;
    rest2 = action !== undefined ? [action, ...rest] : rest;
  }
  if (!cmd && action === undefined) {
    // Bare `orbit <domain>` — run a conventional read-only action so it does something useful.
    const key = ['list', 'status', 'summary', 'board', 'recent'].find(k => domain.commands[k]);
    if (key) { cmd = domain.commands[key]; rest2 = []; }
  }
  if (!cmd) {
    // Wrong action, or a bare domain with no listy action → show the domain's actions as help.
    const lines = [''];
    if (action !== undefined) lines.push('  ' + `Unknown action "${action}" for "${name}".`);
    lines.push('  ' + name + (domain.help ? ' — ' + domain.help : ''));
    for (const [a, c] of Object.entries(domain.commands)) {
      if (a === 'default') continue;
      lines.push('     ' + `${name} ${a}`.padEnd(24) + (c.desc || ''));
    }
    lines.push('');
    console.log(lines.join('\n'));
    return action !== undefined ? 1 : 0;
  }

  const args = parseArgs(rest2);
  const ctx = { print: (...a) => console.log(...a), cwd: process.cwd() };
  try {
    const code = await cmd.run(args, ctx);
    return typeof code === 'number' ? code : 0;
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return 1;
  }
}
