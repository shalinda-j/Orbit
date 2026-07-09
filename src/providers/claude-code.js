import { spawn, spawnSync } from 'child_process';
import { config } from '../config.js';

// Split a command string into argv, honoring quotes — so CLAUDE_CODE_BIN may be a full
// command line ("node \"/path/fake.js\"") without needing a shell to parse it.
function splitCommand(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// Launch the Claude Code CLI WITHOUT a shell, so the (env-controlled) binary string can't be
// re-parsed by cmd.exe. We split the bin string into exe + args ourselves; on Windows we resolve
// claude.cmd via `where` and run .cmd/.bat through cmd.exe /c with shell:false (Node quotes args) —
// the same hardening used for MCP servers.
function launchClaude(binStr, extraArgs) {
  const opts = { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true };
  const parts = splitCommand(binStr);
  const exe = parts[0] || 'claude';
  const args = [...parts.slice(1), ...extraArgs];
  if (process.platform !== 'win32') return spawn(exe, args, { ...opts, shell: false });
  let resolved = exe;
  try {
    const r = spawnSync('where', [exe], { encoding: 'utf8' });
    if (r.status === 0) resolved = r.stdout.split(/\r?\n/).find(Boolean) || exe;
  } catch { /* fall through */ }
  if (/\.(cmd|bat)$/i.test(resolved)) {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', resolved, ...args], { ...opts, shell: false });
  }
  return spawn(resolved, args, { ...opts, shell: false });
}

/**
 * Runs completions through the local Claude Code CLI in headless print mode
 * (`claude -p`). This uses the user's logged-in Claude Code **subscription** —
 * no ANTHROPIC_API_KEY and no per-token API billing.
 *
 * Requires Claude Code installed and logged in (`claude` once, or `claude setup-token`).
 */
export class ClaudeCodeProvider {
  constructor() {
    this.bin = config.providers['claude-code'].bin;
    this.model = config.providers['claude-code'].model;
  }

  async chat({ systemPrompt, messages, model, signal }) {
    const selected = (model && model !== 'default') ? model : (this.model || '');

    // Fold system + conversation into ONE stdin blob. The command line stays
    // short, safe tokens only (no user text as args), so shell quoting can't
    // break across Windows/macOS/Linux.
    // note: persona is folded into the prompt (Claude Code's own system prompt
    // still applies); switch to `--system-prompt` if you need to fully replace it.
    const convo = messages.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n\n');
    const full = (systemPrompt ? `[System instructions]\n${systemPrompt}\n\n[Conversation]\n` : '') + convo + '\n\nAssistant:';

    const args = ['-p', '--output-format', 'json'];
    if (selected) args.push('--model', selected);

    return await new Promise((resolve, reject) => {
      let child;
      try {
        child = launchClaude(this.bin, args);
      } catch (e) {
        return reject(new Error(`Could not launch Claude Code CLI ("${this.bin}"): ${e.message}`));
      }

      let out = '', err = '', settled = false;
      const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(killer); if (signal) signal.removeEventListener('abort', onAbort); fn(v); };
      // Kill a hung CLI (e.g. waiting on an interactive prompt) instead of blocking the run forever.
      const killer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish(reject, new Error('Claude Code CLI timed out after 180s.')); }, 180000);
      // External abort (Ctrl+C): kill the subprocess so it stops consuming the subscription.
      const onAbort = () => { try { child.kill(); } catch { /* gone */ } finish(reject, new Error('Claude Code call aborted.')); };
      if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }

      child.stdout.on('data', d => (out += d));
      child.stderr.on('data', d => (err += d));
      child.on('error', e => finish(reject, new Error(`Could not run Claude Code CLI ("${this.bin}"): ${e.message}. Is Claude Code installed and logged in?`)));
      child.on('close', code => {
        if (settled) return;
        if (code !== 0) {
          const e = err.trim();
          // A logged-out / unauthenticated CLI is the most common failure — give the exact fix.
          if (/log ?in|logged ?in|unauthor|authenticat|not authenticated|api key|setup-token/i.test(e)) {
            return finish(reject, new Error('Claude Code is not logged in. Run `claude` once (or `claude setup-token`) to authenticate your subscription.'));
          }
          return finish(reject, new Error(`Claude Code CLI exited ${code}. ${e.slice(0, 400) || 'Run `claude` once to log in with your subscription.'}`));
        }
        let data;
        try { data = JSON.parse(out); }
        catch { return finish(reject, new Error(`Unexpected Claude Code output (not JSON): ${out.slice(0, 200)}`)); }
        if (data.is_error) return finish(reject, new Error(`Claude Code error: ${data.result || data.subtype || 'unknown'}`));

        const u = data.usage || {};
        // Report the recurring per-turn input (fresh + cache reads). We exclude
        // cache_creation_input_tokens: that's the ONE-TIME cost of caching Claude
        // Code's own system prompt, so counting it makes every run look ~32k heavier
        // than it actually is turn to turn. (Under a subscription there's no $ cost anyway.)
        const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
        finish(resolve, {
          content: data.result ?? '',
          usage: {
            promptTokens: input,
            completionTokens: u.output_tokens || 0,
            totalTokens: input + (u.output_tokens || 0),
          },
        });
      });

      child.stdin.on('error', () => {}); // ignore EPIPE if the CLI closes stdin early
      child.stdin.write(full);
      child.stdin.end();
    });
  }
}
