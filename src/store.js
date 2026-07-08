import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────
// Shared on-disk store for the whole team.
// One JSON file under ./.orbit so multiple orbit processes (and spawned CLI
// agents shelling out to `orbit ...`) all coordinate through the same state.
// ─────────────────────────────────────────────

export const orbitDir = () => path.join(process.cwd(), '.orbit');
const storeFile = () => path.join(orbitDir(), 'store.json');
const lockDir = () => path.join(orbitDir(), 'store.lock');

const EMPTY = () => ({
  version: 1,
  team: {},        // role -> { role, cli, status, skills, lastSeen, pid }
  tasks: [],       // { id, title, assignee, status, priority, dependsOn, parentId, acceptance, createdBy, createdAt, updatedAt }
  messages: [],    // { id, from, text, mention, ts, readBy }
  findings: [],    // { id, role, title, severity, location, description, recommendation, category, status, ts }
  debates: [],     // { id, topic, options, status, proposals, critiques, votes, verdict, ... }
  approvals: [],   // { id, what, by, status, decidedBy, ts }
  templates: [],   // { name, goal, team, acceptance }
  triggers: [],    // { id, on, action, ... }
  agents: [],      // spawned external CLI agents: { role, cli, dir, terminal, startedAt }
  events: [],      // activity log: { ts, type, actor, data }
  counters: {},
});

function ensureDir() {
  fs.mkdirSync(orbitDir(), { recursive: true });
}

export function readStore() {
  ensureDir();
  const f = storeFile();
  if (!fs.existsSync(f)) return EMPTY();
  try {
    return { ...EMPTY(), ...JSON.parse(fs.readFileSync(f, 'utf8')) };
  } catch {
    const bak = f + '.bak';
    if (fs.existsSync(bak)) {
      try { return { ...EMPTY(), ...JSON.parse(fs.readFileSync(bak, 'utf8')) }; } catch { /* fall through */ }
    }
    return EMPTY();
  }
}

function writeStoreRaw(store) {
  ensureDir();
  const f = storeFile();
  if (fs.existsSync(f)) {
    try { fs.copyFileSync(f, f + '.bak'); } catch { /* best effort backup */ }
  }
  fs.writeFileSync(f, JSON.stringify(store, null, 2), 'utf8');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function acquireLock(timeoutMs = 5000) {
  ensureDir();
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir()); // mkdir is atomic — acts as the lock
      return;
    } catch {
      try {
        const age = Date.now() - fs.statSync(lockDir()).mtimeMs;
        if (age > 15000) { fs.rmdirSync(lockDir()); continue; } // steal stale lock
      } catch { /* lock vanished — retry */ }
      if (Date.now() - start > timeoutMs) throw new Error('store lock timeout');
      await sleep(40);
    }
  }
}

function releaseLock() {
  try { fs.rmdirSync(lockDir()); } catch { /* already released */ }
}

/**
 * Read-modify-write the store under a global lock. The mutator receives the
 * fresh store, mutates it in place (and/or returns a value), then it's saved.
 * note: global store lock — fine for a handful of agents; shard per-collection if throughput ever matters.
 */
export async function withStore(mutator) {
  await acquireLock();
  try {
    const store = readStore();
    const result = await mutator(store);
    writeStoreRaw(store);
    return result;
  } finally {
    releaseLock();
  }
}

export function nextId(store, kind) {
  store.counters[kind] = (store.counters[kind] || 0) + 1;
  return store.counters[kind];
}

export function logEvent(store, type, actor, data = {}) {
  store.events.push({ ts: Date.now(), type, actor, data });
  if (store.events.length > 5000) store.events = store.events.slice(-5000); // note: cap the activity log
}
