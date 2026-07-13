// Stage 0 — Intake. Proves the raw prompt is refined into a structured build brief,
// tolerates prose-wrapped JSON, and always degrades to a safe passthrough on failure. No network.
import { refineBrief, briefToText, passthroughBrief, parseBriefJson } from '../src/intake.js';
import { registerProvider } from '../src/providers/index.js';

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running intake (Stage 0) tests...\n');

// 1. A clean JSON object is parsed into the brief shape.
registerProvider('intake-ok', {
  name: 'intake-ok',
  async chat() {
    return {
      content: JSON.stringify({
        goal: 'Build a REST todo API',
        constraints: ['Node.js', 'in-memory store'],
        acceptance: ['npm test passes', 'GET /todos returns 200'],
        nonGoals: ['auth'],
      }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
  },
});
const brief = await refineBrief({ rawInput: 'make me a todo api', providerName: 'intake-ok' });
assert(brief.goal === 'Build a REST todo API', 'goal is taken from the analyst output');
assert(brief.constraints.length === 2 && brief.constraints.includes('Node.js'), 'constraints parsed into an array');
assert(brief.acceptance.length === 2 && brief.acceptance[0] === 'npm test passes', 'acceptance criteria parsed');
assert(brief.nonGoals.includes('auth'), 'non-goals parsed');
assert(brief.raw === 'make me a todo api', 'the original raw ask is preserved on the brief');

// 2. briefToText renders every populated section (feeds Genesis + the build loop).
const text = briefToText(brief);
assert(text.includes('Goal: Build a REST todo API'), 'briefToText includes the goal');
assert(text.includes('Acceptance criteria:') && text.includes('- npm test passes'), 'briefToText includes acceptance');
assert(text.includes('Non-goals:'), 'briefToText includes non-goals');

// 3. Prose/fence-wrapped JSON is still recovered.
registerProvider('intake-prose', {
  name: 'intake-prose',
  async chat() {
    return {
      content: 'Sure! Here is the brief:\n```json\n{ "goal": "Wrapped goal", "acceptance": ["it works"] }\n```\nHope that helps.',
      usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
    };
  },
});
const wrapped = await refineBrief({ rawInput: 'do the thing', providerName: 'intake-prose' });
assert(wrapped.goal === 'Wrapped goal', 'JSON is recovered from prose + code fences');
assert(wrapped.acceptance[0] === 'it works', 'acceptance recovered from wrapped JSON');

// 4. A thrown provider call degrades to a passthrough brief (never blocks the pipeline).
registerProvider('intake-throws', {
  name: 'intake-throws',
  async chat() { throw new Error('network down'); },
});
const fell = await refineBrief({ rawInput: 'build X', providerName: 'intake-throws' });
assert(fell.goal === 'build X' && fell.acceptance.length === 0, 'a failed intake call falls back to the raw ask');

// 5. Unparseable output also degrades to passthrough.
registerProvider('intake-garbage', {
  name: 'intake-garbage',
  async chat() { return { content: 'no json here at all', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }; },
});
const garbage = await refineBrief({ rawInput: 'build Y', providerName: 'intake-garbage' });
assert(garbage.goal === 'build Y', 'unparseable intake output falls back to the raw ask');

// 6. An unknown provider (misconfig) degrades instead of throwing.
const noProv = await refineBrief({ rawInput: 'build Z', providerName: 'does-not-exist' });
assert(noProv.goal === 'build Z', 'a missing provider degrades to passthrough');

// 7. Empty input is handled.
const empty = await refineBrief({ rawInput: '   ', providerName: 'intake-ok' });
assert(empty.goal === '' && empty.acceptance.length === 0, 'blank input yields an empty passthrough brief');

// 8. Helper units.
assert(passthroughBrief('hi').goal === 'hi', 'passthroughBrief keeps the raw text as the goal');
assert(parseBriefJson('garbage') === null, 'parseBriefJson returns null for non-JSON');
assert(parseBriefJson('[1,2,3]') === null, 'parseBriefJson rejects a JSON array (wants an object)');

console.log('\nIntake (Stage 0) tests passed.');
