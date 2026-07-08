// Team @handle identities, mention highlighting, roster.
// Force chalk color on so highlight assertions see ANSI (test env is not a TTY).
process.env.FORCE_COLOR = '3';
const { handleOf, highlightHandles, agentResponseLines, renderRoster, renderEdit } = await import('../src/tui.js');

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running team-UI tests...\n');

assert(handleOf('SqlArchitect') === '@sqlarchitect', 'handleOf slugifies to @handle');
assert(handleOf('QA Lead') === '@qa-lead', 'handleOf hyphenates spaces');
assert(handleOf('') === '@agent', 'handleOf falls back to @agent for empty');

const hi = highlightHandles('build on @planner, ping @coder', ['Planner', 'Coder']);
assert(hi.includes('@planner') && hi.includes('@coder') && hi !== 'build on @planner, ping @coder',
  'known @handles are highlighted (colorized)');
assert(highlightHandles('email @nobody now', ['Planner']).includes('@nobody'),
  'unknown @handles are left untouched');

const lines = agentResponseLines('Reviewer', 'sonnet', 'looks good, @coder — ship it [FINISHED]', { promptTokens: 5, completionTokens: 3 }, ['Reviewer', 'Coder']);
assert(lines[0].includes('@reviewer'), 'agent header shows the speaker @handle');
assert(!lines.join('\n').includes('[FINISHED]'), '[FINISHED] control tag is stripped from the reveal');
assert(lines.join('\n').includes('@coder'), 'the reply keeps the teammate @mention');

assert(renderRoster([{ name: 'Planner' }, { name: 'Coder' }]).includes('@planner'), 'roster lists @handles');

// file edits render as a compact stat, and code is never dumped
const edit = renderEdit('✎ Edited src/app.js  +16 -0');
assert(edit.includes('Edited') && edit.includes('src/app.js') && edit.includes('+16') && edit.includes('-0'), 'renderEdit shows file + stat');
const collapsed = agentResponseLines('Coder', 'm', 'done <tool:write_file path="app.js">const x=1;\nconst y=2;</tool:write_file>', null, ['Coder']).join('\n');
assert(collapsed.includes('✎ Edited app.js') && !collapsed.includes('const x=1'), 'write_file code is collapsed to an Edited line (no code shown)');

console.log('\nTeam-UI tests passed.');
