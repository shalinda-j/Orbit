import { getProvider } from './providers/index.js';
import { config } from './config.js';

// ─────────────────────────────────────────────
// Genesis — designs a custom 1–4 agent team for a task using an LLM.
// Headless (no TUI deps) so both the interactive TUI and `orbit run` reuse it.
// ─────────────────────────────────────────────

export function getDefaultFallbackTeam(activeProviders) {
  const defaultProv = activeProviders[0] || 'ollama';
  return [
    {
      name: 'Planner',
      role: 'Architect and Planner',
      instructions: 'Analyze the user request and outline a step-by-step strategy.',
      provider: defaultProv,
    },
    {
      name: 'Developer',
      role: 'Lead Software Engineer',
      instructions: 'Implement the plan and write complete code/solutions.',
      provider: defaultProv,
    },
  ];
}

/**
 * @param {Object} p
 * @param {string} p.task
 * @param {string[]} p.activeProviders
 * @param {(msg:string)=>void} [p.onStatus]
 * @returns {Promise<Array>} team configs: { name, role, instructions, provider, model }
 */
export async function generateAgentTeam({ task, activeProviders, onStatus = () => {} }) {
  onStatus('Designing custom agent team for your task');

  const generatorName = activeProviders.includes('claude-code') ? 'claude-code'
    : activeProviders.includes('nvidia') ? 'nvidia'
    : activeProviders.includes('gemini') ? 'gemini'
    : activeProviders[0];

  let provider;
  try {
    provider = getProvider(generatorName);
  } catch {
    return getDefaultFallbackTeam(activeProviders);
  }

  const systemPrompt = `You are the Genesis Orchestrator.
Your goal is to design a customized team of 1 to 4 specialized agents to solve the user's task.
Active providers available on this machine: ${activeProviders.join(', ')}

Rules for Provider/Model selection:
- If 'claude-code' is available, PREFER it — use model 'sonnet' (or 'opus' for the hardest reasoning). It runs on the user's Claude Code subscription: no API key, no per-token cost.
- If 'nvidia' is available, you can use these models:
  * 'nvidia/nemotron-3-ultra-550b-a55b' (use for general planning, writing, layout, architecture)
  * 'deepseek-ai/deepseek-v4-pro' (use for coding tasks, algorithm design, implementation)
  * 'moonshotai/kimi-k2.6' (use for reviewing, debugging, code quality checks)
  * 'zhipu-ai/glm-5.1' (use for deep reasoning, mathematical logic)
- If 'gemini' is available, use model 'gemini-2.5-flash'.
- If 'openai' is available, use model 'gpt-4o-mini'.
- If 'anthropic' is available, use model 'claude-3-5-haiku-20241022'.
- If 'ollama' is available, use model 'default'.
- If 'custom' is available, use model 'default' (it uses the user's configured CUSTOM_DEFAULT_MODEL).
- Other OpenAI-compatible providers may be available: openrouter, zai, kimi, groq, deepseek, together, mistral, xai, fireworks. For any of these, use model 'default' (uses that provider's configured model) unless you know a specific model id.

For each agent in the team, you must specify:
1. name: A single capitalized alphanumeric word (e.g. Coder, SqlArchitect, Reviewer).
2. role: A concise role description.
3. instructions: Detailed system instructions for this agent's task-solving persona.
4. provider: One of the active providers.
5. model: The specific model string matching the selected provider.

You MUST return ONLY a valid JSON array of agent objects, containing the keys: "name", "role", "instructions", "provider", "model".
Do NOT wrap the JSON in markdown code blocks like \`\`\`json. Output raw JSON.
If the task is simple, 1 or 2 agents are enough. If complex, use 3 or 4.${config.lazy ? '\nLAZY MODE: minimize token cost — use the FEWEST agents that can do the job (prefer 1, at most 2).' : ''}`;

  let response;
  try {
    response = await provider.chat({
      systemPrompt,
      messages: [{ role: 'user', content: `Task: ${task}` }],
      temperature: 0.2,
    });
  } catch (e) {
    onStatus(`⚠ team designer call failed (${e.message}) — using the default team`);
    return getDefaultFallbackTeam(activeProviders);
  }

  const teamConfigs = parseTeamJson(response.content);
  if (!teamConfigs) {
    onStatus('⚠ team designer returned unparseable output — using the default team');
    return getDefaultFallbackTeam(activeProviders);
  }

  return teamConfigs.map(cfg => ({
    name: cfg.name || 'Agent',
    role: cfg.role || 'Assistant',
    instructions: cfg.instructions || 'Collaborate to solve the task.',
    provider: activeProviders.includes(cfg.provider) ? cfg.provider : activeProviders[0],
    model: cfg.model || undefined,
  }));
}

// Extract a JSON agent array from a model reply that may wrap it in prose or ```json fences.
// Returns the parsed non-empty array, or null if nothing valid is found (caller uses the fallback).
function parseTeamJson(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/```(?:json)?/gi, '').trim(); // drop any code fences, anywhere
  const tryParse = (t) => { try { const v = JSON.parse(t); return Array.isArray(v) && v.length ? v : null; } catch { return null; } };
  let out = tryParse(s);
  if (out) return out;
  // Fall back to the first [...] array substring (handles leading/trailing prose the model added).
  const first = s.indexOf('['), last = s.lastIndexOf(']');
  if (first !== -1 && last > first) out = tryParse(s.slice(first, last + 1));
  return out;
}
