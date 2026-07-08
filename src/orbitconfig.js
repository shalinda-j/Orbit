import fs from 'fs';
import path from 'path';
import os from 'os';
import { orbitDir } from './store.js';

// ─────────────────────────────────────────────
// orbit config — declarative extensibility.
// Project config: ./.orbit/config.json   ·   Global config: ~/.orbit/config.json
// The two are merged (global is the base, project extends it).
// ─────────────────────────────────────────────

export const projectConfigFile = () => path.join(orbitDir(), 'config.json');
export const globalConfigFile = () => path.join(os.homedir(), '.orbit', 'config.json');

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function mergeHooks(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = [...(out[k] || []), ...(Array.isArray(v) ? v : [v])];
  return out;
}

let _cache = null;
export function loadConfig() {
  if (_cache) return _cache;
  const g = readJson(globalConfigFile()) || {};
  const p = readJson(projectConfigFile()) || {};
  _cache = {
    providers: [...(g.providers || []), ...(p.providers || [])],       // manual OpenAI-compatible providers
    plugins: [...(g.plugins || []), ...(p.plugins || [])],             // module paths/specs to load
    mcp: { servers: [...(g.mcp?.servers || []), ...(p.mcp?.servers || [])] },
    hooks: mergeHooks(g.hooks, p.hooks),                              // { event: [shell commands] }
    integrations: { ...(g.integrations || {}), ...(p.integrations || {}) },
    skills: [...(g.skills || []), ...(p.skills || [])],
  };
  return _cache;
}

export function invalidateConfig() { _cache = null; }

// Append an item to an array field of the PROJECT config (providers/plugins/skills), or set mcp.servers.
export function addToProjectConfig(field, item) {
  const f = projectConfigFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const cur = readJson(f) || {};
  if (field === 'mcp.servers') {
    cur.mcp = cur.mcp || {};
    cur.mcp.servers = [...(cur.mcp.servers || []), item];
  } else {
    cur[field] = [...(cur[field] || []), item];
  }
  fs.writeFileSync(f, JSON.stringify(cur, null, 2));
  invalidateConfig();
  return f;
}

// Set a hook: append a shell command to an event in the PROJECT config.
export function addHookToProjectConfig(event, command) {
  const f = projectConfigFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const cur = readJson(f) || {};
  cur.hooks = cur.hooks || {};
  cur.hooks[event] = [...(cur.hooks[event] || []), command];
  fs.writeFileSync(f, JSON.stringify(cur, null, 2));
  invalidateConfig();
  return f;
}
