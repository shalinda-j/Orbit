import { isProviderConfigured, PROVIDER_NAMES } from '../config.js';
import { Agent } from '../agent.js';
import { Orchestrator } from '../orchestrator.js';
import { generateAgentTeam } from '../genesis.js';
import { discoverTools } from '../mcpclient.js';
import { withStore, nextId, logEvent } from '../store.js';

const PROVIDERS = PROVIDER_NAMES;

async function doRun(a, ctx) {
  const goal = a._[0] || a.goal;
  if (!goal) throw new Error('need a goal string: orbit run "build X"');

  const active = PROVIDERS.filter(isProviderConfigured);
  if (!active.length) throw new Error('No providers configured. Run `orbit init` and add a key.');

  ctx.print(`  Designing team for: ${goal}`);
  const teamConfigs = await generateAgentTeam({ task: goal, activeProviders: active, onStatus: (m) => ctx.print('  · ' + m) });
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
  const task = a.plan ? `Produce a detailed implementation PLAN only (no file writes / commands):\n\n${goal}` : goal;
  const onSpeak = (name, text, thinking) => { if (!thinking) ctx.print(`  [${name}] ${String(text).slice(0, 240)}`); };

  const result = mode === 'sequential'
    ? await orch.runSequential(task, onSpeak)
    : await orch.runCollaborative(task, parseInt(a.turns, 10) || 6, onSpeak);

  await withStore(s => {
    const id = nextId(s, 'task');
    s.tasks.push({ id, title: goal, assignee: 'orbit-team', status: 'done', priority: 'medium', dependsOn: [], parentId: 0, acceptance: '', createdBy: 'run', createdAt: Date.now(), updatedAt: Date.now() });
    logEvent(s, 'run.done', 'orbit-team', { id, tokens: result.tokenStats.totalTokens });
  });

  ctx.print('\n  ── Final ──');
  ctx.print(result.finalOutput);
  ctx.print(`\n  tokens: ${result.tokenStats.totalTokens}`);
}

export default {
  name: 'run',
  help: 'Run an in-process multi-agent build with orbit\'s own provider agents',
  commands: {
    default: { desc: 'run "goal" [--mode sequential] [--turns N]', run: doRun },
    goal: { desc: 'run goal "..." (explicit form)', run: doRun },
  },
};
