import { spawn } from 'child_process';
import { config } from '../config.js';

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

  async chat({ systemPrompt, messages, model }) {
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
        child = spawn(this.bin, args, { shell: true }); // shell:true so Windows can resolve claude.cmd
      } catch (e) {
        return reject(new Error(`Could not launch Claude Code CLI ("${this.bin}"): ${e.message}`));
      }

      let out = '', err = '';
      child.stdout.on('data', d => (out += d));
      child.stderr.on('data', d => (err += d));
      child.on('error', e => reject(new Error(`Could not run Claude Code CLI ("${this.bin}"): ${e.message}. Is Claude Code installed and logged in?`)));
      child.on('close', code => {
        if (code !== 0) {
          return reject(new Error(`Claude Code CLI exited ${code}. ${err.trim().slice(0, 400) || 'Run `claude` once to log in with your subscription.'}`));
        }
        let data;
        try { data = JSON.parse(out); }
        catch { return reject(new Error(`Unexpected Claude Code output (not JSON): ${out.slice(0, 200)}`)); }
        if (data.is_error) return reject(new Error(`Claude Code error: ${data.result || data.subtype || 'unknown'}`));

        const u = data.usage || {};
        // Report the recurring per-turn input (fresh + cache reads). We exclude
        // cache_creation_input_tokens: that's the ONE-TIME cost of caching Claude
        // Code's own system prompt, so counting it makes every run look ~32k heavier
        // than it actually is turn to turn. (Under a subscription there's no $ cost anyway.)
        const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
        resolve({
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
