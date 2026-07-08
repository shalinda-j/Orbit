import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadDomains, parseArgs } from '../src/cli.js';
import { readStore } from '../src/store.js';
import { brainSearch } from '../src/brain.js';

// Run in an isolated temp cwd so the real project isn't touched.
const tmp = path.join(os.tmpdir(), 'orbit-team-test-' + process.pid);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
process.chdir(tmp);

const out = [];
const ctx = { print: (...a) => out.push(a.join(' ')), cwd: tmp };
function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running Orbit team + brain tests...\n');

// arg parser sanity
const p = parseArgs(['hello', '--from', 'PM', '--flag', '--k=v']);
assert(p._[0] === 'hello' && p.from === 'PM' && p.flag === true && p.k === 'v', 'parseArgs handles positional/flags/=');

const d = await loadDomains();
assert(['team', 'task', 'msg', 'brain', 'spawn', 'run'].every(n => d[n]), 'all core domains auto-loaded');

// roster
await d.team.commands.join.run({ role: 'PM', cli: 'human' }, ctx);
assert(readStore().team.PM && readStore().team.PM.status === 'online', 'team join records roster');

// board
await d.task.commands.add.run({ _: ['Build login'], assignee: 'Backend', priority: 'high', by: 'PM' }, ctx);
let s = readStore();
assert(s.tasks.length === 1 && s.tasks[0].title === 'Build login' && s.tasks[0].assignee === 'Backend', 'task add works');
await d.task.commands.done.run({ _: ['1'], by: 'Backend' }, ctx);
assert(readStore().tasks[0].status === 'done', 'task done updates status');

// dependencies survive the round-trip
await d.task.commands.add.run({ _: ['Deploy'], depends: '1,2', by: 'PM' }, ctx);
assert(JSON.stringify(readStore().tasks[1].dependsOn) === '[1,2]', 'task dependsOn parsed');

// channel
await d.msg.commands.post.run({ _: ['hello team'], from: 'PM', mention: 'Backend' }, ctx);
assert(readStore().messages.length === 1 && readStore().messages[0].mention === 'Backend', 'msg post works');

// brain
await d.brain.commands.save.run({ _: ['Auth Design', 'Use JWT with refresh tokens'], tags: 'auth,security' }, ctx);
assert(brainSearch({ query: 'jwt' }).length === 1, 'brain save + search works');
assert(brainSearch({ tag: 'security' }).length === 1, 'brain tag filter works');
assert(d.brain.commands.add.run === d.brain.commands.save.run, 'brain add aliases save');

// persistence
assert(fs.existsSync(path.join(tmp, '.orbit', 'store.json')), 'store persisted to disk');
assert(fs.existsSync(path.join(tmp, '.orbit', 'brain', 'auth-design.md')), 'brain note written as markdown');

// activity log captured events
assert(readStore().events.some(e => e.type === 'task.add') && readStore().events.some(e => e.type === 'brain.save'), 'events logged');

console.log('\nAll team/brain tests passed.');
