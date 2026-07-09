import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = path.join(os.tmpdir(), 'orbit-dispatch-test-' + process.pid);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, 'home'), { recursive: true });
process.env.HOME = path.join(tmp, 'home');
process.env.USERPROFILE = process.env.HOME;
process.chdir(tmp);

const { dispatch } = await import('../src/cli.js');

function assert(cond, msg) { if (!cond) { console.error('✗ ' + msg); process.exit(1); } console.log('✓ ' + msg); }

// Capture console output of a dispatch call.
async function run(argv) {
  let out = '';
  const log = console.log, err = console.error;
  console.log = (...a) => { out += a.join(' ') + '\n'; };
  console.error = (...a) => { out += a.join(' ') + '\n'; };
  let code;
  try { code = await dispatch(argv); } finally { console.log = log; console.error = err; }
  return { code, out: out.replace(/\x1b\[[0-9;]*m/g, '') };
}

console.log('Running dispatcher tests (bare commands do something useful)...\n');

// A bare domain with a "list" action runs it — not "Unknown action".
const finding = await run(['finding']);
assert(finding.code === 0 && !/Unknown action/.test(finding.out) && /no findings/.test(finding.out), 'bare `finding` runs its list (no "Unknown action")');

// A bare domain with a "status" action runs it.
const team = await run(['team']);
assert(team.code === 0 && !/Unknown action/.test(team.out), 'bare `team` runs its status');

// A bare domain with no listy action shows help (its actions), still exit 0.
const dash = await run(['dashboard']);
assert(dash.code === 0 && !/Unknown action/.test(dash.out) && /serve/.test(dash.out) && /once/.test(dash.out), 'bare `dashboard` shows its actions as help');

// A WRONG action still errors clearly.
const bad = await run(['finding', 'nope']);
assert(bad.code === 1 && /Unknown action "nope"/.test(bad.out), 'a wrong action still reports "Unknown action"');

console.log('\nDispatcher tests passed.');
