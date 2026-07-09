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
  // SECURITY: MCP servers, plugins, and hooks execute code. A cloned repo's ./.orbit/config.json
  // is UNTRUSTED — auto-loading its servers/plugins/hooks would be remote code execution. So we
  // trust only the GLOBAL (~/.orbit) config by default; project entries require an explicit opt-in.
  const trustProject = process.env.ORBIT_TRUST_PROJECT === '1' || process.env.ORBIT_TRUST_PROJECT_MCP === '1';
  const proj = trustProject ? p : {};
  _cache = {
    providers: [...(g.providers || []), ...(p.providers || [])],       // providers are data (base URL + key), not code — safe to merge
    plugins: [...(g.plugins || []), ...(proj.plugins || [])],           // code — global only unless opted in
    mcp: { servers: [...(g.mcp?.servers || []), ...(proj.mcp?.servers || [])] }, // spawns processes — global only unless opted in
    hooks: mergeHooks(g.hooks, trustProject ? p.hooks : {}),            // shell commands — global only unless opted in
    integrations: { ...(g.integrations || {}), ...(p.integrations || {}) },
    skills: [...(g.skills || []), ...(p.skills || [])],                 // instruction text — data, safe
    _projectHasCode: !!(p.mcp?.servers?.length || p.plugins?.length || Object.keys(p.hooks || {}).length),
    _trustProject: trustProject,
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

// Append an item to an array field of the GLOBAL config (~/.orbit/config.json).
// Code-bearing config (mcp servers, plugins, hooks) should live here — it's trusted everywhere.
export function addToGlobalConfig(field, item) {
  const f = globalConfigFile();
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
