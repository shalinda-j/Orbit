import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseToolCall, BUILTIN_TOOLS } from '../src/tools.js';

const tmp = path.join(os.tmpdir(), 'orbit-bugfix-' + process.pid);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
process.chdir(tmp);

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running v1.0.1 bug-fix regression tests...\n');

// ── parseToolCall ──
assert(parseToolCall('<tool:write_file path="app.js">const x = 1;') === null,
  'truncated block tag parses as null (no parameterless call)');
assert(parseToolCall('<tool:view_file path="a.js">') === null,
  'bare opening tag (no /> and no close) parses as null');

const redir = parseToolCall('<tool:run_command command="npm test > out.txt" />');
assert(redir && redir.params.command === 'npm test > out.txt', "'>' inside an attribute value is preserved");

const sq = parseToolCall(`<tool:run_command command="git commit -m 'fix bug'" />`);
assert(sq && sq.params.command === "git commit -m 'fix bug'", 'single quotes inside a double-quoted value are preserved');

const sc = parseToolCall('<tool:view_file path="a.js" />');
assert(sc && sc.name === 'view_file' && sc.params.path === 'a.js', 'valid self-closing tag parses');

const blk = parseToolCall('<tool:write_file path="a.js">hello world</tool:write_file>');
assert(blk && blk.params.content === 'hello world', 'block tag captures body content');

const mcp = parseToolCall('<tool:mcp server="fs" name="read">{"path":"x","n":">5"}</tool:mcp>');
assert(mcp && mcp.params.server === 'fs' && mcp.params.name === 'read' && mcp.params.content === '{"path":"x","n":">5"}',
  'mcp block tag parses server/name and JSON body (incl. > inside)');

// ── write_file / run_command guards ──
const wf = BUILTIN_TOOLS.find(t => t.name === 'write_file');
fs.writeFileSync(path.join(tmp, 'keep.js'), 'ORIGINAL');
const wfRes = await wf.execute({ path: 'keep.js' }); // no content — must refuse
assert(/needs content/.test(wfRes) && fs.readFileSync(path.join(tmp, 'keep.js'), 'utf8') === 'ORIGINAL',
  'write_file with no content refuses and leaves the file unchanged');

const rc = BUILTIN_TOOLS.find(t => t.name === 'run_command');
const rcRes = await rc.execute({});
assert(/needs a command/.test(rcRes), 'run_command with no command returns a clean error (not a TypeError)');

// ── domain-level fixes (via the registry) ──
const { loadDomains, isCommand } = await import('../src/cli.js');
const d = await loadDomains();
const out = [];
const ctx = { print: (...a) => out.push(a.join(' ')), cwd: tmp };

// team join with a bare --role (parses as boolean true) must be rejected, not stored.
let threw = false;
try { await d.team.commands.join.run({ _: [], role: true }, ctx); } catch { threw = true; }
assert(threw, 'team join rejects a non-string role (bare --role)');

// prototype keys are not domains
assert((await isCommand(['toString'])) === false && (await isCommand(['constructor'])) === false,
  '/toString and /constructor are not treated as domain commands');

// finding audit seeds tasks on a real board column (todo, not the invisible "open")
const { readStore } = await import('../src/store.js');
await d.finding.commands.audit.run({ by: 'sec' }, ctx);
const auditTasks = readStore().tasks;
assert(auditTasks.length >= 3 && auditTasks.every(t => t.status === 'todo'),
  'finding audit seeds tasks with status "todo" (visible on the board)');

// run/orchestrate goal join: a multi-word positional is kept whole, not truncated to the first word.
// (Assert the fix at the source level — invoking doRun would trigger a real provider call.)
const runSrc = fs.readFileSync(new URL('../src/domains/run.js', import.meta.url), 'utf8');
const orchSrc = fs.readFileSync(new URL('../src/domains/orchestrate.js', import.meta.url), 'utf8');
assert(runSrc.includes("a._.join(' ')") && orchSrc.includes("a._.join(' ')"),
  'run and orchestrate join multi-word goals (no first-word truncation)');

// ── brain CRLF frontmatter ──
const brainDir = path.join(tmp, '.orbit', 'brain');
fs.mkdirSync(brainDir, { recursive: true });
fs.writeFileSync(path.join(brainDir, 'crlf.md'), '---\r\ntitle: My Note\r\ncategory: docs\r\ntags: a, b\r\n---\r\n\r\nbody here');
const { brainGet } = await import('../src/brain.js');
const note = brainGet('crlf');
assert(note && note.title === 'My Note' && note.category === 'docs' && note.tags.includes('a') && note.body === 'body here',
  'brain parses CRLF frontmatter (title/category/tags/body)');

console.log('\nv1.0.1 bug-fix regression tests passed.');
