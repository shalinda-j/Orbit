#!/usr/bin/env node

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, isProviderConfigured, PROVIDER_NAMES } from '../src/config.js';
import { Agent } from '../src/agent.js';
import { Orchestrator } from '../src/orchestrator.js';
import { generateAgentTeam } from '../src/genesis.js';
import { getProvider } from '../src/providers/index.js';
import { discoverTools } from '../src/mcpclient.js';
import { dispatch, isCommand, helpText } from '../src/cli.js';
import { extInit, extProviderNames, emit } from '../src/extensions.js';
import {
  COLORS, clearScreen, clearLine, getAgentColor, modeColor,
  renderBanner, renderAgentResponse, renderSystemMessage,
  renderPrompt, renderStatusBar, renderHelp, renderAgentList,
  renderTokenSummary, renderFinalResult, renderTaskHeader,
  Spinner,
} from '../src/tui.js';

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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: renderPrompt(mode),
    terminal: true,
  });

  const providerStatuses = providerNames.map(name => ({
    name,
    configured: activeProviders.includes(name)
  }));
  const bannerState = () => ({ mode, permissions, style, turns: maxTurns });

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
    const trimmed = input.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Slash commands — serialize so bulk/pasted input runs in order and exit can await it.
    if (trimmed.startsWith('/')) {
      pending = pending.then(() => handleSlashCommand(trimmed, rl, [], providerStatuses));
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

    isProcessing = true;
    taskCount++;
    const spinner = new Spinner();
    const supervisorProvider = preferred(activeProviders);
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
        console.log(renderAgentResponse('Orbit', supervisorProvider, res.content, res.usage));
        const stats = { promptTokens: res.usage.promptTokens, completionTokens: res.usage.completionTokens, totalTokens: res.usage.totalTokens, breakdown: { Orbit: res.usage } };
        console.log(renderTokenSummary(stats, { subscription }));
        accumulateTokens(stats);
        await emit('run.after', { task: trimmed, mode });
        isProcessing = false;
        rl.prompt();
        return;
      }

      // ── Plan / Build: assemble a team ──
      spinner.start('Designing custom agent team for your task');
      const teamConfigs = await generateAgentTeam({ task: trimmed, activeProviders, onStatus: (m) => spinner.update(m) });
      spinner.stop();

      console.log(COLORS.bright.bold('  Assembled Agent Team') + COLORS.dim(`   (${mode} mode)`));
      console.log(COLORS.dim('  │'));
      teamConfigs.forEach((c, i) => {
        const color = getAgentColor(c.name);
        const isLast = i === teamConfigs.length - 1;
        const branch = isLast ? '  └ ' : '  ├ ';
        const cont   = isLast ? '    ' : '  │ ';
        console.log(COLORS.dim(branch) + color.bold(c.name) + COLORS.dim(` · ${c.role}`));
        console.log(COLORS.dim(cont) + COLORS.muted(`  ${c.provider}`) + COLORS.dim(' / ') + COLORS.text(c.model || 'default'));
      });
      console.log('');

      const agents = teamConfigs.map(cfg => new Agent(cfg));
      const toolPolicy = toolPolicyFor(mode, permissions);

      // Bridge any configured MCP servers' tools into the agent tool-loop.
      const mcpTools = await discoverTools();
      if (mcpTools.length) console.log(renderSystemMessage(`${mcpTools.length} MCP tool(s) available to the team`));

      const orchestrator = new Orchestrator({ agents, supervisorProvider, toolPolicy, mcpTools });

      const onAgentSpeak = (agentName, text, isThinking, usage) => {
        if (isThinking) {
          spinner.start(`${agentName} is thinking`);
        } else {
          spinner.stop();
          if (agentName === 'System') {
            console.log(renderSystemMessage(text));
          } else {
            const agent = agents.find(a => a.name === agentName);
            console.log(renderAgentResponse(agentName, agent?.model || '', text, usage));
          }
          console.log('');
        }
      };

      // In plan mode, steer the team to a plan and away from mutations.
      const runTask = mode === 'plan'
        ? `Produce a detailed implementation PLAN for the following. Do NOT write files or run commands — output the plan/design only.\n\n${trimmed}`
        : trimmed;

      const result = style === 'sequential'
        ? await orchestrator.runSequential(runTask, onAgentSpeak)
        : await orchestrator.runCollaborative(runTask, maxTurns, onAgentSpeak);

      spinner.stop();

      console.log(renderFinalResult(result.finalOutput));
      console.log(renderTokenSummary(result.tokenStats, { subscription }));
      accumulateTokens(result.tokenStats);
      await emit('run.after', { task: trimmed, mode });

    } catch (err) {
      spinner.stop();
      console.log('');
      console.log(COLORS.dim('  │ ') + COLORS.error.bold('Error'));
      console.log(COLORS.dim('  └ ') + COLORS.error(err.message));
      console.log('');
    }

    isProcessing = false;
    rl.prompt();
  });

  // Ctrl+C
  rl.on('SIGINT', () => {
    if (isProcessing) {
      console.log('');
      console.log(renderSystemMessage('Task interrupted.'));
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
      console.log(renderBanner(providerStatuses, process.cwd(), { mode, permissions, style, turns: maxTurns }));
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
  console.log(COLORS.icon('     ..▄▄████▄▄..'));
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
