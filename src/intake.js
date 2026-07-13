import { getProvider } from './providers/index.js';
import { config } from './config.js';

// ─────────────────────────────────────────────
// Intake — turns a raw user prompt into a precise, buildable brief BEFORE the team
// is designed. One LLM call. It does the "requirements gathering + prompt optimization"
// a human analyst would: pin the goal, surface constraints, and derive concrete
// acceptance criteria. Headless (no TUI deps) so the TUI, `orbit run`, and `-p`
// one-shot all reuse it. Degrades to a passthrough brief on any failure so the
// pipeline is never blocked by a bad/absent intake call.
// ─────────────────────────────────────────────

/** The brief used when intake is skipped or the model call/parse fails — the raw ask, unchanged. */
export function passthroughBrief(rawInput) {
  const raw = String(rawInput || '').trim();
  return { goal: raw, constraints: [], acceptance: [], nonGoals: [], raw };
}

/** Render a brief object into the compact text block fed to Genesis and the build loop. */
export function briefToText(b) {
  const lines = [`Goal: ${b.goal}`];
  if (b.constraints?.length) lines.push('Constraints:\n' + b.constraints.map(c => `- ${c}`).join('\n'));
  if (b.acceptance?.length)  lines.push('Acceptance criteria:\n' + b.acceptance.map(c => `- ${c}`).join('\n'));
  if (b.nonGoals?.length)    lines.push('Non-goals:\n' + b.nonGoals.map(c => `- ${c}`).join('\n'));
  return lines.join('\n\n');
}

/**
 * @param {Object} p
 * @param {string} p.rawInput          - the user's raw request
 * @param {string} p.providerName      - provider to run the intake analyst on
 * @param {string} [p.model]           - optional model override
 * @param {AbortSignal} [p.signal]     - cancels the in-flight call (Ctrl+C)
 * @param {(msg:string)=>void} [p.onStatus]
 * @returns {Promise<{goal:string, constraints:string[], acceptance:string[], nonGoals:string[], raw:string}>}
 */
export async function refineBrief({ rawInput, providerName, model, signal, onStatus = () => {} }) {
  const raw = String(rawInput || '').trim();
  if (!raw) return passthroughBrief(raw);
  onStatus('Refining your request into a build brief');

  let provider;
  try { provider = getProvider(providerName); }
  catch { return passthroughBrief(raw); }

  const systemPrompt = `You are the Intake Analyst. Turn the user's raw request into a precise, buildable brief for an engineering team. Do NOT solve or design it — only clarify and structure it.
Return ONLY a valid JSON object (no markdown fences) with keys:
- "goal": one crisp sentence stating exactly what to build.
- "constraints": array of hard requirements the build must respect — tech, scope, interfaces (may be empty).
- "acceptance": array of concrete, checkable pass/fail criteria that prove the goal is met (e.g. "npm test passes", "GET /health returns 200"). Prefer 2-5.
- "nonGoals": array of things explicitly out of scope (may be empty).
Infer sensible defaults from the request; do not invent unrelated features.${config.lazy ? ' LAZY MODE: keep every field minimal.' : ''}`;

  let response;
  try {
    response = await provider.chat({
      systemPrompt,
      messages: [{ role: 'user', content: `Raw request: ${raw}` }],
      model,
      temperature: 0.2,
      signal,
    });
  } catch (e) {
    onStatus(`⚠ intake call failed (${e.message}) — using your request as-is`);
    return passthroughBrief(raw);
  }

  const parsed = parseBriefJson(response.content);
  if (!parsed) {
    onStatus('⚠ intake returned unparseable output — using your request as-is');
    return passthroughBrief(raw);
  }

  return {
    goal: (parsed.goal && String(parsed.goal).trim()) || raw,
    constraints: toArr(parsed.constraints),
    acceptance: toArr(parsed.acceptance),
    nonGoals: toArr(parsed.nonGoals),
    raw,
  };
}

// Coerce a JSON field into a clean string array (tolerates a bare string or null).
function toArr(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (v == null || v === '') return [];
  return [String(v).trim()].filter(Boolean);
}

// Extract a JSON object from a model reply that may wrap it in prose or ```json fences.
// Returns the parsed object, or null if nothing valid is found (caller uses the passthrough).
export function parseBriefJson(raw) {
  const s = String(raw || '').trim().replace(/```(?:json)?/gi, '').trim();
  const tryParse = (t) => {
    try { const v = JSON.parse(t); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
    catch { return null; }
  };
  let out = tryParse(s);
  if (out) return out;
  // Fall back to the first {...} object substring (handles leading/trailing prose the model added).
  const first = s.indexOf('{'), last = s.lastIndexOf('}');
  if (first !== -1 && last > first) out = tryParse(s.slice(first, last + 1));
  return out;
}
