import { spawn } from 'child_process';
import path from 'path';
import { withStore, readStore, nextId, logEvent } from '../store.js';
import { config } from '../config.js';

// Build the env for a spawned CLI, optionally routing it through a different provider's
// OpenAI-compatible endpoint (e.g. OpenRouter) instead of its own default. codex/openai-based
// CLIs read OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL — set them via env (NOT the shell
// string, so there's no injection). `--via <provider>` pulls from an already-connected provider;
// explicit --base-url / --api-key / --model override.
function spawnEnv(a) {
  const env = { ...process.env };
  const via = a.via ? String(a.via).toLowerCase() : null;
  if (via) {
    const p = config.providers[via];
    if (!p) throw new Error(`unknown --via provider "${via}" — see \`orbit connect\``);
    const base = p.baseUrl || (via === 'openai' ? 'https://api.openai.com/v1' : '');
    if (base) env.OPENAI_BASE_URL = base;
    if (p.apiKey) env.OPENAI_API_KEY = p.apiKey;
    if (p.defaultModel) env.OPENAI_MODEL = p.defaultModel;
  }
  if (a['base-url'] || a.baseUrl) env.OPENAI_BASE_URL = a['base-url'] || a.baseUrl;
  if (a['api-key'] || a.key) env.OPENAI_API_KEY = a['api-key'] || a.key;
  if (a.model) env.OPENAI_MODEL = a.model;
  return env;
}

// Which shell command launches each coding CLI as a team member.
// Override/add with the CLI_COMMANDS env var: "claude=claude,codex=codex,foo=foo-cli".
const CLI_COMMANDS = { claude: 'claude', codex: 'codex', gemini: 'gemini', qwen: 'qwen', kimi: 'kimi', glm: 'glm', cursor: 'cursor .', vscode: 'code .' };
for (const pair of String(process.env.CLI_COMMANDS || '').split(',')) {
  const [k, v] = pair.split('=');
  if (k && v) CLI_COMMANDS[k.trim()] = v.trim();
}

function kickoff(role, dir) {
  return `You are joining a multi-agent build team as the "${role}" role. Shared team state lives under ${dir} in the .orbit folder (tasks, messages, brain). Coordinate ONLY through the orbit CLI: first \`orbit team join --role ${role} --cli <you>\`, then \`orbit task list\`, \`orbit msg read --mention ${role}\`, \`orbit msg post "..." --from ${role}\`, \`orbit msg wait --role ${role}\`, \`orbit brain search "..."\`. Claim a task, do the work, post progress, mark it done.`;
}

// Build the OS-specific command that opens a new terminal in `dir` running the CLI.
// note: we don't inject the kickoff through nested shells (quoting is fragile) —
// it's posted to the channel instead, so the agent reads it with `orbit msg read`.
function terminalCmd(cli, dir, terminal) {
  const cmd = CLI_COMMANDS[cli] || cli;
  if (process.platform === 'win32') {
    return (terminal || 'wt') === 'wt'
      ? `wt -w 0 nt -d "${dir}" cmd /k ${cmd}`
      : `start "orbit-agent" cmd /k "cd /d ${dir} && ${cmd}"`;
  }
  if (process.platform === 'darwin') {
    return `osascript -e 'tell application "Terminal" to do script "cd \\"${dir}\\" && ${cmd}"'`;
  }
  return `x-terminal-emulator -e bash -lc "cd '${dir}' && ${cmd}; exec bash" || gnome-terminal -- bash -lc "cd '${dir}' && ${cmd}; exec bash"`;
}

export default {
  name: 'spawn',
  help: 'Launch external coding CLIs (claude/codex/gemini/...) as team agents',
  commands: {
    new: {
      desc: 'spawn new --role Backend --cli claude [--dir path] [--terminal wt|cmd] [--via openrouter | --base-url U --api-key K --model M]',
      run: async (a, ctx) => {
        const role = a.role || a._[0];
        if (!role) throw new Error('need --role');
        // SECURITY: the terminal command is built into a shell string, so cli & dir must be safe.
        // cli must be an allowlisted key (its value is trusted); dir must contain no shell metacharacters.
        const cli = String(a.cli || 'claude').toLowerCase();
        if (!(cli in CLI_COMMANDS)) throw new Error(`unknown --cli "${cli}". Allowed: ${Object.keys(CLI_COMMANDS).join(', ')} (add your own via the CLI_COMMANDS env)`);
        const dir = path.resolve(a.dir || ctx.cwd);
        if (/["'`$&|;<>(){}\r\n]/.test(dir)) throw new Error('--dir contains unsafe characters');

        // With shell:true the shell always spawns; a missing terminal (no `wt`) fails ASYNC via
        // the shell's exit code / 'error' event — never a sync throw. Report the real outcome.
        const fallback = () => {
          ctx.print(`  ! Could not open a terminal automatically. Open one yourself:`);
          ctx.print(`      cd ${dir} && ${CLI_COMMANDS[cli] || cli}`);
        };
        const env = spawnEnv(a); // may route the CLI through OpenRouter/another provider (throws on bad --via)
        const child = spawn(terminalCmd(cli, dir, a.terminal), { shell: true, detached: true, stdio: 'ignore', env });
        child.on('error', fallback);
        child.on('exit', (code) => { if (code) fallback(); });
        child.unref();
        if (env.OPENAI_BASE_URL) ctx.print(`  ↳ routing ${cli} via ${env.OPENAI_BASE_URL}${a.via ? ` (${a.via})` : ''}`);

        await withStore(s => {
          s.agents.push({ role, cli, dir, terminal: a.terminal || 'wt', startedAt: Date.now() });
          // drop the kickoff into the channel so the new agent reads it via `orbit msg read`
          const id = nextId(s, 'message');
          s.messages.push({ id, from: 'PM', text: kickoff(role, dir), mention: role, ts: Date.now(), readBy: [] });
          logEvent(s, 'spawn.new', a.by || 'PM', { role, cli });
        });

        ctx.print(`  ✓ launching ${role} (${cli}) in a new terminal. Kickoff posted to the channel.`);
        ctx.print(`    It joins with:  orbit msg read --mention ${role}`);
      },
    },
    list: {
      desc: 'List spawned agents',
      run: async (_a, ctx) => {
        const ag = readStore().agents;
        if (!ag.length) return ctx.print('  (none spawned)');
        ctx.print('\n  Spawned agents');
        for (const x of ag) ctx.print(`   ${x.role.padEnd(14)} ${String(x.cli).padEnd(8)} ${x.dir}`);
        ctx.print('');
      },
    },
    clis: {
      desc: 'Show the known CLI launch commands',
      run: async (_a, ctx) => {
        ctx.print('\n  Known CLIs (override with CLI_COMMANDS env)');
        for (const [k, v] of Object.entries(CLI_COMMANDS)) ctx.print(`   ${k.padEnd(8)} → ${v}`);
        ctx.print('');
      },
    },
  },
};
