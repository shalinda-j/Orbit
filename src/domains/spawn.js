import { spawn } from 'child_process';
import { withStore, readStore, nextId, logEvent } from '../store.js';

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
// ponytail: we don't inject the kickoff through nested shells (quoting is fragile) —
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
      desc: 'spawn new --role Backend --cli claude [--dir path] [--terminal wt|cmd]',
      run: async (a, ctx) => {
        const role = a.role || a._[0];
        if (!role) throw new Error('need --role');
        const cli = (a.cli || 'claude').toLowerCase();
        const dir = a.dir || ctx.cwd;

        let opened = true;
        try {
          spawn(terminalCmd(cli, dir, a.terminal), { shell: true, detached: true, stdio: 'ignore' }).unref();
        } catch (e) {
          opened = false;
          ctx.print(`  ! Could not open a terminal automatically (${e.message}).`);
          ctx.print(`  Open one yourself:  cd ${dir} && ${CLI_COMMANDS[cli] || cli}`);
        }

        await withStore(s => {
          s.agents.push({ role, cli, dir, terminal: a.terminal || 'wt', startedAt: Date.now() });
          // drop the kickoff into the channel so the new agent reads it via `orbit msg read`
          const id = nextId(s, 'message');
          s.messages.push({ id, from: 'PM', text: kickoff(role, dir), mention: role, ts: Date.now(), readBy: [] });
          logEvent(s, 'spawn.new', a.by || 'PM', { role, cli });
        });

        ctx.print(`  ✓ spawned ${role} (${cli})${opened ? ' in a new terminal' : ''}. Kickoff posted to the channel.`);
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
