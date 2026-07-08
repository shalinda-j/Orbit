#!/usr/bin/env node

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, isProviderConfigured, PROVIDER_NAMES, providerEnv, applyProviderConfig, setGlobalEnv, removeGlobalEnv, clearProviderConfig, EFFORT_TURNS } from '../src/config.js';
import { brainSave, brainSearch } from '../src/brain.js';
import { Agent } from '../src/agent.js';
import { Orchestrator } from '../src/orchestrator.js';
import { generateAgentTeam } from '../src/genesis.js';
import { getProvider } from '../src/providers/index.js';
import { discoverTools } from '../src/mcpclient.js';
import { dispatch, isCommand, helpText, loadDomains } from '../src/cli.js';
import { extInit, extProviderNames, emit } from '../src/extensions.js';
import {
  COLORS, clearScreen, clearLine, getAgentColor, modeColor,
  renderBanner, renderAgentResponse, renderSystemMessage,
  renderPrompt, renderStatusBar, renderHelp, renderAgentList,
  renderTokenSummary, renderFinalResult, renderTaskHeader,
  handleOf, agentResponseLines, renderRoster, Spinner,
} from '../src/tui.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Self-improvement: pull relevant past runs from the brain into a new task's context.
function recallMemory(goal) {
  try {
    const q = goal.split(/\s+/).slice(0, 6).join(' ');
    const hits = brainSearch({ query: q, category: 'runs' }).slice(0, 3);
    if (!hits.length) return '';
    return '\n\n[Relevant past work from memory — reuse what applies]:\n' +
      hits.map(h => `• ${h.title}: ${h.body.slice(0, 400)}`).join('\n');
  } catch { return ''; }
}

// Save a completed run to the brain so future runs can learn from it.
function rememberRun(goal, output) {
  try { brainSave({ title: goal.slice(0, 60), content: `Task: ${goal}\n\n${output || ''}`, category: 'runs', tags: 'run' }); } catch { /* best effort */ }
}

// Preferred provider order — Claude Code subscription first, then keyed APIs, then local.
const preferred = (active) =>
  active.includes('claude-code') ? 'claude-code' :
  active.includes('nvidia') ? 'nvidia' :
  active.includes('gemini') ? 'gemini' : active[0];

// Tool policy for the current mode/permission (see Orchestrator.toolPolicy).
const toolPolicyFor = (mode, permissions) =>
  mode === 'plan' ? 'read' : (permissions === 'auto' ? 'all' : 'read');

const MODES = ['chat', 'plan', 'build'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
// .env template (for `orbit init`)
// ─────────────────────────────────────────────
const ENV_TEMPLATE = `# Orbit — Multi-Agent AI CLI configuration

# NVIDIA Build API (https://build.nvidia.com — free endpoint available)
NVIDIA_API_KEY=
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1

# Google Gemini
GEMINI_API_KEY=
GEMINI_DEFAULT_MODEL=gemini-2.5-flash

# OpenAI
OPENAI_API_KEY=
OPENAI_DEFAULT_MODEL=gpt-4o-mini

# Anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_DEFAULT_MODEL=claude-3-5-haiku-20241022

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=llama3

# Custom — any OpenAI-compatible provider (base URL you specify)
CUSTOM_BASE_URL=
CUSTOM_API_KEY=
CUSTOM_DEFAULT_MODEL=

# Preset providers — base URL is baked in, just add the key (override model with <NAME>_MODEL):
OPENROUTER_API_KEY=
ZAI_API_KEY=
KIMI_API_KEY=
GROQ_API_KEY=
DEEPSEEK_API_KEY=
TOGETHER_API_KEY=
MISTRAL_API_KEY=
XAI_API_KEY=
FIREWORKS_API_KEY=

# Chinese model providers (OpenAI-compatible):
DASHSCOPE_API_KEY=   # Qwen (Alibaba)
ZHIPU_API_KEY=       # Zhipu GLM (CN)
MOONSHOT_API_KEY=    # Moonshot / Kimi (CN)
MINIMAX_API_KEY=
YI_API_KEY=          # 01.AI
BAICHUAN_API_KEY=
HUNYUAN_API_KEY=     # Tencent
ARK_API_KEY=         # Doubao (Volcengine)
STEPFUN_API_KEY=
SENSENOVA_API_KEY=
SPARK_API_KEY=       # iFlytek
SILICONFLOW_API_KEY=

# Claude Code subscription — NO API key needed. Just install Claude Code and log in
# (run \`claude\` once, or \`claude setup-token\`). Orbit auto-detects the \`claude\` CLI.
# Optional overrides:
# CLAUDE_CODE_BIN=claude
# CLAUDE_CODE_MODEL=sonnet
`;

// ─────────────────────────────────────────────
// Session State
// ─────────────────────────────────────────────
let mode = 'build';              // chat | plan | build  (Claude-Code-style, cycled with /mode)
let permissions = 'safe';        // safe | auto  (auto = agents may write files / run commands)
let style = 'collaborative';     // collaborative | sequential  (how the team confers)
let maxTurns = 6;
let sessionTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0, breakdown: {} };
let taskCount = 0;
let isProcessing = false;
let usedSubscription = false;    // did any run use the claude-code subscription? (affects cost display)
let exiting = false;             // guard exitGracefully against re-entry (rl.close re-emits 'close')
let pending = Promise.resolve(); // serializes slash-command work so exit can wait for it to flush
let taskGen = 0;                 // bumped on each task start AND on Ctrl+C, to invalidate an aborted run
let activeSpinner = null;        // current task's spinner, so SIGINT can stop it
let wizardActive = false;        // true for the whole /connect wizard session
let wizardResolve = null;        // set while the wizard awaits the next line
const wizardBuf = [];            // lines that arrived before the next question was posted (paste / fast input)

// Ask one question inside the wizard: consume a buffered line if any, else show the prompt and wait.
function ask(rl, question) {
  return new Promise((resolve) => {
    if (wizardBuf.length) { resolve(wizardBuf.shift()); return; }
    wizardResolve = resolve;
    rl.setPrompt(COLORS.secondary('  ' + question));
    rl.prompt();
  });
}

// Interactive provider onboarding — one provider at a time: pick → key → model → save → repeat.
async function runConnectWizard(rl, providerStatuses) {
  const keyless = {
    'claude-code': 'Install Claude Code and log in (`claude`) — no key needed.',
    ollama: 'Runs locally — no key needed (start Ollama, then pick it in a run).',
  };
  wizardActive = true;
  console.log('');
  console.log(COLORS.bright.bold('  Connect a provider') + COLORS.dim('   (Enter a number, or blank to finish)'));
  try {
    while (true) {
      providerStatuses.forEach((p, i) => {
        const dot = p.configured ? COLORS.success('●') : COLORS.dim('○');
        console.log(`   ${String(i + 1).padStart(2)}. ${dot} ${COLORS.text(p.name)}`);
      });
      const pick = (await ask(rl, 'Provider # or name: ')).trim().toLowerCase();
      if (!pick) break;
      const idx = /^\d+$/.test(pick) ? parseInt(pick, 10) - 1 : providerStatuses.findIndex(p => p.name === pick);
      const chosen = providerStatuses[idx];
      if (!chosen) { console.log(COLORS.error('   ✗ not found')); continue; }
      const name = chosen.name;

      if (keyless[name]) { console.log(COLORS.muted('   ' + keyless[name])); console.log(''); continue; }
      const env = providerEnv(name);
      if (!env) { console.log(COLORS.muted('   no key needed')); console.log(''); continue; }

      let baseUrl;
      if (env.needsBaseUrl) {
        baseUrl = (await ask(rl, 'Base URL (e.g. https://api.example.com/v1): ')).trim();
        if (!baseUrl) { console.log(COLORS.muted('   skipped (base URL required)')); console.log(''); continue; }
      }
      const key = (await ask(rl, `API key (${env.keyEnv}): `)).trim();
      if (!key) { console.log(COLORS.muted('   skipped')); console.log(''); continue; }
      const cur = config.providers[name]?.defaultModel || '';
      const model = (await ask(rl, `Model [${cur || 'default'}] (blank = keep): `)).trim();

      setGlobalEnv(env.keyEnv, key);
      if (model && env.modelEnv) setGlobalEnv(env.modelEnv, model);
      if (baseUrl && env.baseUrlEnv) setGlobalEnv(env.baseUrlEnv, baseUrl);
      applyProviderConfig(name, { key, model, baseUrl });
      chosen.configured = true;
      console.log(COLORS.success(`   ✓ ${name} connected`) + COLORS.dim(`  · saved to ~/.orbit/.env`));

      const more = (await ask(rl, 'Add another? (Y/n): ')).trim().toLowerCase();
      if (more === 'n' || more === 'no') break;
      console.log('');
    }
  } finally {
    wizardActive = false;
    wizardResolve = null;
    wizardBuf.length = 0;
    rl.setPrompt(renderPrompt(mode));
  }
  const on = providerStatuses.filter(p => p.configured).map(p => p.name);
  console.log('');
  console.log(COLORS.muted('  Connected: ') + (on.length ? COLORS.text(on.join(', ')) : COLORS.dim('none')));
  console.log('');
}

// Team generation now lives in ../src/genesis.js (shared with `orbit run`).

// ─────────────────────────────────────────────
// Token Accumulator
// ─────────────────────────────────────────────
function accumulateTokens(taskTokenStats) {
  sessionTokens.promptTokens += taskTokenStats.promptTokens;
  sessionTokens.completionTokens += taskTokenStats.completionTokens;
  sessionTokens.totalTokens += taskTokenStats.totalTokens;
  for (const [name, stats] of Object.entries(taskTokenStats.breakdown)) {
    if (!sessionTokens.breakdown[name]) {
      sessionTokens.breakdown[name] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
    sessionTokens.breakdown[name].promptTokens += stats.promptTokens;
    sessionTokens.breakdown[name].completionTokens += stats.completionTokens;
    sessionTokens.breakdown[name].totalTokens += stats.totalTokens;
  }
}

// ─────────────────────────────────────────────
// Main TUI Loop
// ─────────────────────────────────────────────
async function main() {
  // `orbit init` — write a .env template and exit (non-interactive).
  if (process.argv[2] === 'init') {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      console.log(COLORS.warning(`.env already exists at ${envPath}`));
    } else {
      fs.writeFileSync(envPath, ENV_TEMPLATE);
      console.log(COLORS.success(`Created .env template at ${envPath}. Add your keys, then run 'orbit'.`));
    }
    process.exit(0);
  }

  await extInit(); // load config, manual providers, plugins, hooks
  const extNames = extProviderNames();
  const providerNames = [...PROVIDER_NAMES, ...extNames];
  const activeProviders = PROVIDER_NAMES.filter(isProviderConfigured).concat(extNames); // ext providers are configured by definition
  await emit('session.start', { cwd: process.cwd() });

  // Every slash command (session commands + every domain + aliases) for autocomplete.
  const SESSION_CMDS = ['/help', '/connect', '/disconnect', '/use', '/effort', '/model', '/mode', '/chat', '/plan', '/build', '/skip', '/style', '/lazy', '/anim', '/tokens', '/turns', '/clear', '/exit'];
  const ALIASES = ['/board', '/team', '/brain', '/channel'];
  const SLASH = [...new Set([...SESSION_CMDS, ...ALIASES, ...Object.keys(await loadDomains()).map(n => '/' + n)])].sort();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: renderPrompt(mode),
    terminal: true,
    // Tab-completion for slash commands (safe: readline owns the line rendering).
    completer: (line) => {
      if (!line.startsWith('/')) return [[], line];
      const hits = SLASH.filter(c => c.startsWith(line.toLowerCase()));
      return [hits.length ? hits : SLASH, line];
    },
  });

  const providerStatuses = providerNames.map(name => ({
    name,
    configured: activeProviders.includes(name)
  }));
  const bannerState = () => ({ mode, permissions, style, turns: maxTurns, lazy: config.lazy, effort: config.effort, use: config.useProviders });

  // ── Welcome Screen ──
  clearScreen();
  console.log('');
  console.log(renderBanner(providerStatuses, process.cwd(), bannerState()));
  console.log('');

  if (activeProviders.length === 0) {
    console.log(COLORS.dim('  │ ') + COLORS.error('No API keys configured'));
    console.log(COLORS.dim('  │ ') + COLORS.text('Add your key to .env: ') + COLORS.secondary('NVIDIA_API_KEY=nvapi-xxx'));
    console.log(COLORS.dim('  └ ') + COLORS.muted('Get a free key → https://build.nvidia.com'));
    console.log('');
  }

  console.log(renderStatusBar());
  console.log('');

  rl.prompt();

  // ── Input Handler ──
  rl.on('line', async (input) => {
    // While the /connect wizard is running, route the line to it (or buffer it if a question isn't posted yet).
    if (wizardActive) {
      if (wizardResolve) { const r = wizardResolve; wizardResolve = null; r(input); }
      else wizardBuf.push(input);
      return;
    }
    const trimmed = input.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Slash commands — serialize so bulk/pasted input runs in order and exit can await it.
    // The .catch keeps `pending` resolved: one failing command can't poison the chain or crash the TUI.
    if (trimmed.startsWith('/')) {
      // /connect runs directly (not via the microtask chain) so its first prompt registers
      // synchronously — otherwise the next typed line would be treated as a task, not an answer.
      if (trimmed.toLowerCase() === '/connect') { await runConnectWizard(rl, providerStatuses); rl.prompt(); return; }
      pending = pending
        .then(() => handleSlashCommand(trimmed, rl, [], providerStatuses))
        .catch((err) => { console.log(COLORS.dim('  └ ') + COLORS.error(err.message)); rl.prompt(); });
      await pending;
      return;
    }

    // Process task
    if (isProcessing) {
      console.log(renderSystemMessage('A task is already running. Please wait.'));
      rl.prompt();
      return;
    }

    if (activeProviders.length === 0) {
      console.log(renderSystemMessage('No API keys configured. Add keys to .env file.'));
      rl.prompt();
      return;
    }

    // Multi-model select: restrict this run to the pinned providers (if any) that are actually configured.
    const runProviders = config.useProviders.length ? activeProviders.filter(p => config.useProviders.includes(p)) : activeProviders;
    if (!runProviders.length) {
      console.log(renderSystemMessage('None of the selected providers (/use) are configured. Run /use to clear the selection.'));
      rl.prompt();
      return;
    }

    isProcessing = true;
    taskCount++;
    const myGen = ++taskGen;               // this task's identity; Ctrl+C bumps taskGen to abort it
    const aborted = () => myGen !== taskGen;
    const t0 = Date.now();
    const spinner = new Spinner();
    activeSpinner = spinner;
    const supervisorProvider = preferred(runProviders);
    const subscription = supervisorProvider === 'claude-code';
    if (subscription) usedSubscription = true;

    console.log(renderTaskHeader(taskCount, trimmed));
    await emit('run.before', { task: trimmed, mode, permissions });

    try {
      // ── Chat mode: one fast, cheap reply — no team, no synthesis ──
      if (mode === 'chat') {
        spinner.start('thinking');
        const provider = getProvider(supervisorProvider);
        const res = await provider.chat({
          systemPrompt: 'You are Orbit, a concise CLI assistant. Answer directly with the minimum formatting needed — prose for simple questions, lists only when genuinely multifaceted. No preamble, no filler, no postamble. Scale depth to the question.',
          messages: [{ role: 'user', content: trimmed }],
        });
        spinner.stop();
        const stats = { promptTokens: res.usage.promptTokens, completionTokens: res.usage.completionTokens, totalTokens: res.usage.totalTokens, breakdown: { Orbit: res.usage } };
        if (!aborted()) {
          console.log(renderAgentResponse('Orbit', supervisorProvider, res.content, res.usage));
          console.log(renderTokenSummary(stats, { subscription }));
        }
        accumulateTokens(stats);
        await emit('run.after', { task: trimmed, mode });
        activeSpinner = null;
        if (!aborted()) { isProcessing = false; rl.prompt(); }
        return;
      }

      // ── Plan / Build: assemble a team ──
      spinner.start('Designing custom agent team for your task');
      const teamConfigs = await generateAgentTeam({ task: trimmed, activeProviders: runProviders, onStatus: (m) => spinner.update(m) });
      spinner.stop();

      console.log(COLORS.bright.bold('  Assembled Agent Team') + COLORS.dim(`   (${mode} mode)`));
      console.log(COLORS.dim('  │'));
      teamConfigs.forEach((c, i) => {
        const color = getAgentColor(c.name);
        const isLast = i === teamConfigs.length - 1;
        const branch = isLast ? '  └ ' : '  ├ ';
        const cont   = isLast ? '    ' : '  │ ';
        console.log(COLORS.dim(branch) + color.bold(handleOf(c.name)) + COLORS.dim(` · ${c.role}`));
        console.log(COLORS.dim(cont) + COLORS.muted(`  ${c.provider}`) + COLORS.dim(' / ') + COLORS.text(c.model || 'default'));
      });
      console.log('');
      console.log(renderRoster(teamConfigs));
      console.log('');

      const agents = teamConfigs.map(cfg => new Agent(cfg));
      const teamNames = agents.map(a => a.name);
      const toolPolicy = toolPolicyFor(mode, permissions);

      // Bridge any configured MCP servers' tools into the agent tool-loop.
      const mcpTools = await discoverTools();
      if (mcpTools.length) console.log(renderSystemMessage(`${mcpTools.length} MCP tool(s) available to the team`));

      const orchestrator = new Orchestrator({ agents, supervisorProvider, toolPolicy, mcpTools });

      const animate = () => config.animate && process.stdout.isTTY && !config.lazy;
      const onAgentSpeak = async (agentName, text, isThinking, usage) => {
        if (aborted()) { spinner.stop(); return; } // Ctrl+C — suppress the orphaned run's output
        if (isThinking) {
          spinner.start(agentName === 'System' ? text : `${handleOf(agentName)} is thinking`);
          return;
        }
        spinner.stop();
        if (agentName === 'System') {
          console.log(renderSystemMessage(text));
          console.log('');
          return;
        }
        // Animate the team member's turn: reveal line by line, @handles highlighted.
        const agent = agents.find(a => a.name === agentName);
        const lines = agentResponseLines(agentName, agent?.model || '', text, usage, teamNames);
        for (let i = 0; i < lines.length; i++) {
          console.log(lines[i]);
          if (animate() && i > 0 && i < 40) await sleep(12); // fast reveal, capped for long messages
        }
        console.log('');
      };

      // Recall relevant past work from the brain (self-improvement — reuse prior solutions).
      const memory = recallMemory(trimmed);
      const base = mode === 'plan'
        ? `Produce a detailed implementation PLAN for the following. Do NOT write files or run commands — output the plan/design only.\n\n${trimmed}`
        : trimmed;
      const runTask = base + memory;

      const result = style === 'sequential'
        ? await orchestrator.runSequential(runTask, onAgentSpeak)
        : await orchestrator.runCollaborative(runTask, maxTurns, onAgentSpeak);

      spinner.stop();

      if (!aborted()) {
        console.log(renderFinalResult(result.finalOutput));
        console.log(renderTokenSummary(result.tokenStats, { subscription }));
        console.log(COLORS.dim(`  ⏱  ${Math.round((Date.now() - t0) / 1000)}s`));
      }
      accumulateTokens(result.tokenStats);
      rememberRun(trimmed, result.finalOutput); // save every run to the brain
      await emit('run.after', { task: trimmed, mode });

    } catch (err) {
      spinner.stop();
      if (!aborted()) {
        console.log('');
        console.log(COLORS.dim('  │ ') + COLORS.error.bold('Error'));
        console.log(COLORS.dim('  └ ') + COLORS.error(err.message));
        console.log('');
      }
    }

    activeSpinner = null;
    // Only the still-current task resets state — an aborted run must not re-enable input.
    if (!aborted()) {
      isProcessing = false;
      rl.prompt();
    }
  });

  // Ctrl+C
  rl.on('SIGINT', () => {
    if (wizardActive) { // Ctrl+C during the connect wizard: nudge it to finish, don't exit
      console.log('');
      if (wizardResolve) { const r = wizardResolve; wizardResolve = null; r(''); }
      else { wizardBuf.length = 0; wizardBuf.push(''); }
      return;
    }
    if (isProcessing) {
      taskGen++;                 // invalidate the running task so it stops printing / can't reset state
      if (activeSpinner) activeSpinner.stop();
      activeSpinner = null;
      console.log('');
      console.log(renderSystemMessage('Task interrupted (its output is suppressed; the model call may still finish in the background).'));
      isProcessing = false;
      rl.prompt();
    } else {
      exitGracefully(rl);
    }
  });

  rl.on('close', () => {
    // Wait for any in-flight slash command to finish writing before we exit.
    pending.finally(() => exitGracefully(rl));
  });
}

// ─────────────────────────────────────────────
// Slash Commands
// ─────────────────────────────────────────────
// Quote-aware tokenizer so `/brain save "my title" "body text"` splits correctly.
function tokenize(s) {
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const out = [];
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// Short aliases → full domain commands, so the TUI has one-word shortcuts.
const SLASH_ALIASES = {
  board: ['task', 'board'],
  team: ['team', 'status'],
  brain: ['brain', 'recent'],
  channel: ['msg', 'read'],
};

function announceMode(m) {
  const hint = m === 'chat' ? 'one fast reply, no team'
    : m === 'plan' ? 'team plans only · read-only (no file writes / commands)'
    : 'full multi-agent build';
  console.log('');
  console.log(COLORS.dim('  └ ') + COLORS.muted('Mode → ') + modeColor(m).bold(m) + COLORS.dim(`  (${hint})`));
  console.log('');
}

async function handleSlashCommand(input, rl, agents, providerStatuses) {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/help':
    case '/?':
      console.log(renderHelp());
      break;

    case '/agents':
      console.log(renderAgentList([])); // Renders dynamic team status message
      break;

    case '/model':
      const modelArg = parts[1];
      if (modelArg) {
        config.providers.nvidia.defaultModel = modelArg;
        console.log('');
        console.log(COLORS.dim('  └ ') + COLORS.muted('NVIDIA default model updated to: ') + COLORS.bright(modelArg));
        console.log('');
      } else {
        console.log('');
        console.log(COLORS.bright.bold('  Active Provider Defaults:'));
        console.log(`  - nvidia    : ${config.providers.nvidia.defaultModel}`);
        console.log(`  - gemini    : ${config.providers.gemini.defaultModel}`);
        console.log(`  - openai    : ${config.providers.openai.defaultModel}`);
        console.log(`  - anthropic : ${config.providers.anthropic.defaultModel}`);
        console.log(`  - ollama    : ${config.providers.ollama.defaultModel}`);
        console.log(`  - custom    : ${config.providers.custom.defaultModel || '(set CUSTOM_DEFAULT_MODEL)'}`);
        console.log(`  - claude-code: ${config.providers['claude-code'].model || '(subscription default — set CLAUDE_CODE_MODEL e.g. sonnet)'}`);
        console.log('');
        console.log(COLORS.muted('  Use: /model <model_name> to change NVIDIA default model.'));
        console.log('');
      }
      break;

    case '/effort': {
      const lvl = (parts[1] || '').toLowerCase();
      if (EFFORT_TURNS[lvl]) {
        config.effort = lvl;
        maxTurns = EFFORT_TURNS[lvl];
        console.log('');
        console.log(COLORS.dim('  └ ') + COLORS.muted('Effort → ') + COLORS.bright(lvl) + COLORS.dim(`  (${maxTurns} turns)`));
        console.log('');
      } else {
        console.log('');
        console.log(COLORS.dim('  └ ') + COLORS.muted(`Usage: /effort <low|medium|high|max> · Current: ${config.effort}`));
        console.log('');
      }
      break;
    }

    case '/use': {
      const arg = parts.slice(1).join(' ').trim().toLowerCase();
      if (!arg || arg === 'all' || arg === 'clear') {
        config.useProviders = [];
        console.log('');
        console.log(COLORS.dim('  └ ') + COLORS.muted('Provider selection cleared — team uses all configured (auto).'));
        console.log('');
      } else {
        const wanted = arg.split(/[\s,]+/).filter(Boolean);
        const valid = wanted.filter(n => providerStatuses.some(p => p.name === n && p.configured));
        const bad = wanted.filter(n => !valid.includes(n));
        config.useProviders = valid;
        console.log('');
        console.log(COLORS.dim('  └ ') + COLORS.muted('Using: ') + COLORS.bright(valid.join(', ') || '(none configured)') +
          (bad.length ? COLORS.dim(`  · skipped (not connected): ${bad.join(', ')}`) : ''));
        console.log('');
      }
      break;
    }

    case '/disconnect': {
      const arg = (parts[1] || '').toLowerCase();
      const target = arg && providerStatuses.find(p => p.name === arg);
      if (!target) {
        const on = providerStatuses.filter(p => p.configured).map(p => p.name);
        console.log('');
        console.log(COLORS.muted('  Connected: ') + (on.join(', ') || 'none'));
        console.log(COLORS.dim('  Usage: /disconnect <provider>'));
        console.log('');
        break;
      }
      const env = providerEnv(target.name);
      if (env) { removeGlobalEnv(env.keyEnv); if (env.baseUrlEnv) removeGlobalEnv(env.baseUrlEnv); }
      clearProviderConfig(target.name);
      target.configured = isProviderConfigured(target.name); // re-check (claude-code/ollama stay on)
      config.useProviders = config.useProviders.filter(n => n !== target.name);
      console.log('');
      if (target.configured) console.log(COLORS.dim('  └ ') + COLORS.muted(`${target.name} can't be disconnected here (it's not key-based).`));
      else console.log(COLORS.dim('  └ ') + COLORS.success(`✓ ${target.name} disconnected`) + COLORS.dim('  (removed from ~/.orbit/.env)'));
      console.log('');
      break;
    }

    case '/mode':
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      rl.setPrompt(renderPrompt(mode));
      announceMode(mode);
      break;

    case '/chat':
    case '/plan':
    case '/build':
      mode = cmd.slice(1);
      rl.setPrompt(renderPrompt(mode));
      announceMode(mode);
      break;

    case '/skip':
    case '/perms':
      permissions = permissions === 'auto' ? 'safe' : 'auto';
      console.log('');
      console.log(COLORS.dim('  └ ') + COLORS.muted('Permissions → ') +
        (permissions === 'auto'
          ? COLORS.warning('auto') + COLORS.dim(' (agents may write files & run commands)')
          : COLORS.bright('safe') + COLORS.dim(' (read-only — no writes / commands)')));
      console.log('');
      break;

    case '/style':
      style = style === 'collaborative' ? 'sequential' : 'collaborative';
      console.log('');
      console.log(COLORS.dim('  └ ') + COLORS.muted('Style → ') + COLORS.bright(style) +
        COLORS.dim(style === 'sequential' ? '  (Planner → … chain)' : '  (coordinator-routed discussion)'));
      console.log('');
      break;

    case '/anim':
      config.animate = !config.animate;
      console.log('');
      console.log(COLORS.dim('  └ ') + COLORS.muted('Team conversation animation → ') +
        (config.animate ? COLORS.success('on') : COLORS.bright('off')));
      console.log('');
      break;

    case '/lazy':
      config.lazy = !config.lazy;
      console.log('');
      console.log(COLORS.dim('  └ ') + COLORS.muted('Lazy mode → ') +
        (config.lazy
          ? COLORS.success('on') + COLORS.dim('  (fewest agents · terse output · output capped ≤1024 tokens)')
          : COLORS.bright('off')));
      console.log('');
      break;

    case '/tokens':
      const tk = parseInt(parts[1], 10);
      if (tk && tk >= 128 && tk <= 32000) {
        config.limits.maxTokens = tk;
        console.log('');
        console.log(COLORS.dim('  └ ') + COLORS.muted('Max output tokens → ') + COLORS.bright(String(tk)));
        console.log('');
      } else {
        console.log('');
        console.log(COLORS.dim('  └ ') + COLORS.muted(`Usage: /tokens <128-32000> · Current: ${config.limits.maxTokens}`));
        console.log('');
      }
      break;

    case '/turns':
      const n = parseInt(parts[1]);
      if (n && n > 0 && n <= 20) {
        maxTurns = n;
        console.log('');
        console.log(COLORS.dim('  └ ') + COLORS.muted('Max turns → ') + COLORS.bright(String(maxTurns)));
        console.log('');
      } else {
        console.log('');
        console.log(COLORS.dim('  └ ') + COLORS.muted(`Usage: /turns <1-20> · Current: ${maxTurns}`));
        console.log('');
      }
      break;

    case '/clear':
      clearScreen();
      console.log('');
      console.log(renderBanner(providerStatuses, process.cwd(), { mode, permissions, style, turns: maxTurns, lazy: config.lazy, effort: config.effort, use: config.useProviders }));
      console.log('');
      console.log(renderStatusBar());
      console.log('');
      break;

    case '/exit':
    case '/quit':
    case '/q':
      exitGracefully(rl);
      return;

    default: {
      // Bridge to the domain system: `/board`, `/team`, `/task add "x" --by me`,
      // `/brain search jwt`, `/msg post "hi" --from me`, `/finding list`, ...
      const word = cmd.slice(1);
      // Use the short alias only for the bare word; `/brain save ...` must NOT collapse to `brain recent`.
      const tokens = (SLASH_ALIASES[word] && parts.length === 1) ? SLASH_ALIASES[word] : tokenize(input.slice(1));
      if (await isCommand(tokens)) {
        console.log('');
        await dispatch(tokens);
      } else {
        console.log('');
        console.log(COLORS.dim('  └ ') + COLORS.muted(`Unknown command: ${cmd} · Type /help`));
        console.log('');
      }
      break;
    }
  }

  rl.prompt();
}

// ─────────────────────────────────────────────
// Graceful Exit
// ─────────────────────────────────────────────
function exitGracefully(rl) {
  if (exiting) return; // rl.close() re-emits 'close' → don't run this twice
  exiting = true;
  console.log('');
  if (sessionTokens.totalTokens > 0) {
    console.log(renderTokenSummary(sessionTokens, { subscription: usedSubscription }));
  }
  console.log(COLORS.muted(`  Orbit session ended · ${taskCount} task(s)`));
  console.log('');
  rl.close();
  process.exit(0);
}

// ─────────────────────────────────────────────
// Entry: dispatch `orbit <domain> <action>` commands, else launch the interactive TUI.
// ─────────────────────────────────────────────
(async () => {
  const argv = process.argv.slice(2);

  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    console.log(await helpText());
    process.exit(0);
  }

  // `init` and the no-arg TUI are handled by main(); everything else that names
  // a registered domain (team/task/msg/brain/spawn/run/...) is a one-shot command.
  if (argv.length && argv[0] !== 'init' && await isCommand(argv)) {
    process.exit(await dispatch(argv));
  }

  await main();
})().catch(err => {
  console.error(COLORS.error(`Fatal error: ${err.message}`));
  process.exit(1);
});
