import { getProvider } from './providers/index.js';
import { config } from './config.js';

// Lazy mode: a hard frugality directive appended to every agent turn to cut token spend.
const LAZY_RULE = `\n\nLAZY MODE (token-frugal): output the absolute minimum that fully solves the task. Code/answer only — no explanation, no preamble, no restating, no alternatives. Before writing code, prefer: reuse what exists → standard library → a native/built-in feature → one line. Don't build what isn't needed. If one line does it, write one line.`;

// Reasoning-effort directive, appended per the session's effort level.
const EFFORT_RULE = {
  low: `\n\nEFFORT: low — answer quickly with minimal deliberation.`,
  high: `\n\nEFFORT: high — think carefully and be thorough; check your work before finalizing.`,
  max: `\n\nEFFORT: max — deliberate deeply. Reason step by step, weigh alternatives and edge cases, and verify correctness before finalizing.`,
};

export class Agent {
  /**
   * @param {Object} params
   * @param {string} params.name - Agent's name (e.g. 'Coder')
   * @param {string} params.role - Agent's role/title (e.g. 'Lead Software Developer')
   * @param {string} params.instructions - System instructions detailing behavior and goals
   * @param {string} params.provider - Provider name (gemini, openai, anthropic, ollama)
   * @param {string} [params.model] - Optional specific model name
   */
  constructor({ name, role, instructions, provider, model }) {
    this.name = name;
    this.role = role;
    this.instructions = instructions;
    this.providerName = provider;
    this.model = model;
  }

  /**
   * Queries the provider with the message history and returns the response.
   * @param {Array<{role: string, content: string}>} messages - Current conversation history
   * @param {Object} [options]
   * @returns {Promise<{content: string}>}
   */
  async respond(messages, options = {}) {
    const client = getProvider(this.providerName);
    
    // Persona + operating rules. Deliberately terse — this system prompt is re-sent
    // on every turn, so lean wording saves input tokens across the whole run.
    // Style rules follow production-agent patterns (concision, minimal formatting, no filler).
    let systemPrompt = `You are ${this.name}, ${this.role}. You work with other AI agents to complete the user's task.

${this.instructions}

Operating rules:
- Lead with substance. No preamble, no filler ("Sure", "Here's..."), no restating the task or the plan, no postamble.
- Use the minimum formatting that's clear: prose for simple answers; lists/headings only when the content is genuinely multifaceted. Keep complete code blocks intact.
- Minimize output tokens while staying complete and correct. Prefer the simplest approach that fully works.
- Don't repeat what another agent already produced — build on it or correct it. When you respond to or build on a teammate, address them by their @handle (e.g. @reviewer, @planner). Never prefix your reply with your own name.
- Scale tool use to the task: use none for a simple answer, more only as needed.
- When the overall goal is fully met, begin your reply with the exact tag [FINISHED].

Workspace tools (optional — use one ONLY when it changes your answer). Emit a single tag and STOP; write nothing after it:
- <tool:view_file path="rel/path" startLine="1" endLine="40" />
- <tool:write_file path="rel/path">FULL FILE CONTENTS</tool:write_file>
- <tool:list_dir path="rel/path" />
- <tool:run_command command="..." />
- <tool:subagent role="Researcher">a focused subtask</tool:subagent>  — delegate a subtask to a fresh sub-agent and get its result back. Use this to split big work into pieces and move faster.
The system runs it and returns [Tool Output]; then you continue.`;

    if (config.lazy) systemPrompt += LAZY_RULE;
    if (EFFORT_RULE[config.effort]) systemPrompt += EFFORT_RULE[config.effort];

    // Orchestrator may inject extra tool context (e.g. bridged MCP tools) for this turn.
    if (options.extraSystem) systemPrompt += `\n\n${options.extraSystem}`;

    return await client.chat({
      systemPrompt,
      messages,
      model: this.model,
      temperature: options.temperature ?? 0.7
    });
  }
}
