import { config, isProviderConfigured, PROVIDER_NAMES, EFFORT_TURNS } from '../config.js';
import { Agent } from '../agent.js';
import { Orchestrator } from '../orchestrator.js';
import { generateAgentTeam } from '../genesis.js';
import { refineBrief, briefToText, passthroughBrief } from '../intake.js';
import { discoverTools } from '../mcpclient.js';
import { withStore, nextId, logEvent } from '../store.js';
import { brainSave, brainSearch } from '../brain.js';

const PROVIDERS = PROVIDER_NAMES;

async function doRun(a, ctx) {
  const goal = a._.length ? a._.join(' ') : a.goal; // join words so unquoted multi-word goals aren't truncated
  if (!goal) throw new Error('need a goal string: orbit run "build X"');

  const active = PROVIDERS.filter(isProviderConfigured);
  if (!active.length) throw new Error('No providers configured. Run `orbit init` and add a key.');

  // Stage 0 · Intake — refine the raw prompt into a build brief before designing the team.
  const pref = (list) => list.find(p => active.includes(p)) || active[0];
  const intakeProvider = pref(['claude-code', 'nvidia', 'gemini', 'openai', 'anthropic']);
  const brief = a['no-intake']
    ? passthroughBrief(goal)
    : await refineBrief({ rawInput: goal, providerName: intakeProvider, onStatus: (m) => ctx.print('  · ' + m) });
  if (brief.acceptance.length) ctx.print('  acceptance: ' + brief.acceptance.join(' · '));
  const briefText = briefToText(brief);

  ctx.print(`  Designing team for: ${goal}`);
  const teamConfigs = await generateAgentTeam({ task: briefText, activeProviders: active, onStatus: (m) => ctx.print('  · ' + m) });
  const agents = teamConfigs.map(c => new Agent(c));
  ctx.print('  Team: ' + agents.map(x => `${x.name}(${x.providerName})`).join(', '));

  // record the team on the shared board so external agents can see the run
  await withStore(s => {
    for (const ag of agents) if (!s.team[ag.name]) s.team[ag.name] = { role: ag.role, cli: ag.providerName, status: 'online', skills: [], lastSeen: Date.now(), pid: process.pid };
    logEvent(s, 'run.start', 'run', { goal, team: agents.map(x => x.name) });
  });

  const supervisor = active.includes('claude-code') ? 'claude-code' : active.includes('nvidia') ? 'nvidia' : active.includes('gemini') ? 'gemini' : active[0];
  // Safe by default (read-only): pass --skip to let agents write files & run commands.
  const toolPolicy = a.skip ? 'all' : 'read';
  const mcpTools = await discoverTools(); // bridge configured MCP servers' tools
  if (mcpTools.length) ctx.print(`  ${mcpTools.length} MCP tool(s) available`);
  const orch = new Orchestrator({ agents, supervisorProvider: supervisor, toolPolicy, mcpTools });
  const mode = a.mode || 'collaborative';
  // Recall relevant past runs from the brain (self-improvement).
  let memory = '';
  try {
    const hits = brainSearch({ query: goal.split(/\s+/).slice(0, 6).join(' '), category: 'runs' }).slice(0, 3);
    if (hits.length) memory = '\n\n[Relevant past work from memory — reuse what applies]:\n' + hits.map(h => `• ${h.title}: ${h.body.slice(0, 400)}`).join('\n');
  } catch { /* ignore */ }
  const base = a.plan ? `Produce a detailed implementation PLAN only (no file writes / commands):\n\n${briefText}` : briefText;
  const task = base + memory;
  const turns = parseInt(a.turns, 10) || EFFORT_TURNS[config.effort] || 6;
  const onSpeak = (name, text, thinking) => { if (!thinking) ctx.print(`  [${name}] ${String(text).slice(0, 240)}`); };

  // Stage 3+4 · Build loop, then verify against acceptance (--verify "npm test") and re-run
  // on failure up to --rounds N. Verify only runs when writes/commands are enabled (--skip).
  const verifyCmd = a.verify ? String(a.verify) : '';
  const rounds = parseInt(a.rounds, 10) || 2;
  const result = await orch.runBuild(task, { maxTurns: turns, mode, verifyCmd, rounds }, onSpeak);

  await withStore(s => {
    const id = nextId(s, 'task');
    s.tasks.push({ id, title: goal, assignee: 'orbit-team', status: 'done', priority: 'medium', dependsOn: [], parentId: 0, acceptance: '', createdBy: 'run', createdAt: Date.now(), updatedAt: Date.now() });
    logEvent(s, 'run.done', 'orbit-team', { id, tokens: result.tokenStats.totalTokens });
  });
  try { brainSave({ title: goal.slice(0, 60), content: `Task: ${goal}\n\n${result.finalOutput || ''}`, category: 'runs', tags: 'run' }); } catch { /* ignore */ }

  ctx.print('\n  ── Final ──');
  ctx.print(result.finalOutput);
  if (result.verify?.ran) {
    ctx.print(`\n  acceptance: ${result.verify.passed ? '✓ passed' : '✗ failed'} after ${result.verify.rounds} round(s) — \`${verifyCmd}\``);
  }
  ctx.print(`\n  tokens: ${result.tokenStats.totalTokens}`);
}

export default {
  name: 'run',
  help: 'Run an in-process multi-agent build with orbit\'s own provider agents',
  commands: {
    default: { desc: 'run "goal" [--skip] [--verify "npm test"] [--rounds N] [--mode sequential] [--turns N] [--no-intake]', run: doRun },
    goal: { desc: 'run goal "..." (explicit form)', run: doRun },
  },
};
