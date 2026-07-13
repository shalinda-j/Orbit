import fs from 'fs';
import path from 'path';
import { getProvider } from './providers/index.js';
import { refineBrief, briefToText, parseBriefJson } from './intake.js';
import { generateAgentTeam } from './genesis.js';
import { Agent } from './agent.js';
import { Orchestrator } from './orchestrator.js';
import { runCheck } from './tools.js';
import { withStore, nextId, logEvent, orbitDir } from './store.js';
import { brainSave, slugify } from './brain.js';
import spawnDomain from './domains/spawn.js';

// ─────────────────────────────────────────────
// The Conductor — one autonomous driver that takes a goal and delivers a project,
// chaining every stage end to end with no human in the loop:
//   1 Discover   → refine the ask into a spec (intake.js)
//   2 Design     → an architect drafts plan · architecture · data model · diagram
//                  + a task breakdown, critiqued and revised (the "loop engineering")
//   3 Decompose  → seed the shared task board (store.js) from the design
//   4 Build      → build each task; substrate is pluggable:
//                    'inprocess' = Orbit's own agents + the build→verify loop
//                    'spawn'/'hybrid' = launch coding CLIs in real terminals (spawn.js)
//   5 Integrate  → verify the whole project against an acceptance command; on failure
//                  feed it back and fix, up to N rounds.
// It composes the existing pieces (intake, genesis, orchestrator, board, brain) — the
// Conductor is the glue, not a rewrite. This is the skeleton: each phase is real but
// deliberately shallow (1 design-critique round, 1 team) so the whole chain runs today;
// deepen any single phase without touching the others.
// ─────────────────────────────────────────────

const now = () => Date.now();

// Assemble the human-readable design doc written to .orbit/factory/<slug>/plan.md.
function planMarkdown(goal, brief, design) {
  return [
    `# ${brief.goal || goal}`, '',
    '## Overview', design.overview || '(none)', '',
    '## Architecture', design.architecture || '(none)', '',
    '## Data model', design.dataModel || '(none)', '',
    '## Diagram', '```mermaid', design.diagram || 'graph TD; A[Start] --> B[Build]', '```', '',
    '## Acceptance criteria', (brief.acceptance || []).map(a => `- ${a}`).join('\n') || '- (inferred at build time)', '',
    '## Task breakdown',
    design.tasks.map((t, i) => `${i + 1}. **${t.title}** — ${t.detail}${t.acceptance ? `  _(accept: ${t.acceptance})_` : ''}`).join('\n'),
    '',
  ].join('\n');
}

// A minimal, always-valid design when the architect call fails or returns garbage —
// keeps the chain moving (autonomous: never blocks waiting for a human).
function fallbackDesign(briefText) {
  return {
    overview: briefText,
    architecture: 'Single component that fulfils the brief.',
    dataModel: '(none)',
    diagram: 'graph TD; A[Spec] --> B[Implementation] --> C[Verify]',
    tasks: [{ title: 'Implement the goal', detail: briefText, acceptance: 'the project builds and runs' }],
  };
}

// Phase 2a — the architect drafts a production-level design + a build task breakdown.
async function designProject({ provider, model, briefText, extra = '', signal }) {
  const systemPrompt = `You are the Lead Architect. Given the brief, produce a production-level design AND an ordered build task breakdown.
Return ONLY a valid JSON object (no markdown fences) with keys:
- "overview": 1-2 paragraphs on what is being built.
- "architecture": the components and how they interact.
- "dataModel": entities / schema (SQL or concise prose); "(none)" if not data-backed.
- "diagram": a single Mermaid diagram of the architecture.
- "tasks": array of 3-8 build tasks, each { "title", "detail" (what to build and how), "acceptance" (one checkable done-criterion) }, ordered so earlier tasks unblock later ones.`;
  let response;
  try {
    response = await provider.chat({
      systemPrompt,
      messages: [{ role: 'user', content: `Brief:\n${briefText}${extra}` }],
      model, temperature: 0.3, signal,
    });
  } catch { return null; }
  const d = parseBriefJson(response.content);
  if (!d || !Array.isArray(d.tasks) || !d.tasks.length) return null;
  // Normalize task fields.
  d.tasks = d.tasks
    .map(t => ({ title: String(t.title || 'Task').trim(), detail: String(t.detail || t.title || '').trim(), acceptance: String(t.acceptance || '').trim() }))
    .filter(t => t.detail);
  return d.tasks.length ? d : null;
}

// Phase 2b — a critic gates the design. Returns APPROVED, or concrete gaps to revise against.
async function critiqueDesign({ provider, model, briefText, design, signal }) {
  const systemPrompt = `You are the design critic. Review the design against the brief. If it is complete and buildable, reply with exactly the word APPROVED. Otherwise list the concrete gaps to fix — no preamble.`;
  let response;
  try {
    response = await provider.chat({
      systemPrompt,
      messages: [{ role: 'user', content: `Brief:\n${briefText}\n\nDesign:\n${JSON.stringify(design).slice(0, 4000)}` }],
      model, temperature: 0.2, signal,
    });
  } catch { return { ok: true, issues: '' }; } // a failed critic must not stall the chain
  const txt = String(response.content || '').trim();
  return { ok: /^\s*APPROVED\b/i.test(txt), issues: txt };
}

/**
 * Run the full autonomous factory pipeline.
 * @returns {Promise<{goal,brief,design,artifactsDir,taskIds,buildResults,verify,substrate}>}
 */
export async function runFactory({
  goal,
  providerName,
  providers = [],
  substrate = 'inprocess',
  verifyCmd = '',
  designRounds = 1,
  buildTurns = 4,
  integrateRounds = 2,
  signal,
  onPhase = () => {},
  onLog = () => {},
  ctx,
}) {
  const raw = String(goal || '').trim();
  if (!raw) throw new Error('factory needs a goal');
  const provider = getProvider(providerName);
  const abort = () => signal?.aborted;

  // ── Phase 1 · Discover ─────────────────────────────────────────────
  onPhase('discover', 'Discovery — inferring the spec');
  const brief = await refineBrief({ rawInput: raw, providerName, signal, onStatus: onLog });
  const briefText = briefToText(brief);
  if (brief.acceptance.length) onLog('acceptance: ' + brief.acceptance.join(' · '));
  if (abort()) throw new Error('aborted');

  // ── Phase 2 · Design (loop-engineered) ─────────────────────────────
  onPhase('design', 'Design — architecture, data model, diagram, task breakdown');
  let design = await designProject({ provider, briefText, signal }) || fallbackDesign(briefText);
  for (let r = 1; r <= Math.max(0, designRounds); r++) {
    if (abort()) throw new Error('aborted');
    const crit = await critiqueDesign({ provider, briefText, design, signal });
    if (crit.ok) { onLog(`design approved (round ${r})`); break; }
    onLog(`design round ${r}: revising against critique`);
    const revised = await designProject({ provider, briefText, extra: `\n\nRevise to fix these gaps from review:\n${crit.issues}`, signal });
    if (revised) design = revised;
  }
  onLog(`design → ${design.tasks.length} task(s)`);

  // Write artifacts to .orbit/factory/<slug>/
  const slug = slugify(brief.goal || raw);
  const artifactsDir = path.join(orbitDir(), 'factory', slug);
  const planText = planMarkdown(raw, brief, design);
  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, 'plan.md'), planText, 'utf8');
    fs.writeFileSync(path.join(artifactsDir, 'design.json'), JSON.stringify({ brief, design }, null, 2), 'utf8');
    onLog(`artifacts → ${path.relative(process.cwd(), artifactsDir)}/plan.md`);
  } catch (e) { onLog(`⚠ could not write artifacts (${e.message})`); }

  // ── Phase 3 · Decompose → shared task board ────────────────────────
  onPhase('decompose', `Seeding the task board with ${design.tasks.length} task(s)`);
  const { parentId, ids } = await withStore(s => {
    const ts = now();
    const parentId = nextId(s, 'task');
    s.tasks.push({
      id: parentId, title: brief.goal || raw, assignee: 'factory', status: 'doing', priority: 'high',
      dependsOn: [], parentId: 0, acceptance: (brief.acceptance || []).join('; '),
      createdBy: 'factory', createdAt: ts, updatedAt: ts,
    });
    const ids = [];
    for (const t of design.tasks) {
      const id = nextId(s, 'task');
      s.tasks.push({
        id, title: t.title, assignee: '', status: 'todo', priority: 'normal',
        dependsOn: [], parentId, acceptance: t.acceptance || '',
        createdBy: 'factory', createdAt: ts, updatedAt: ts,
      });
      ids.push(id);
    }
    logEvent(s, 'factory.decompose', 'factory', { goal: raw, tasks: ids.length, substrate });
    return { parentId, ids };
  });
  const setStatus = (id, status) => withStore(s => {
    const t = s.tasks.find(x => x.id === id);
    if (t) { t.status = status; t.updatedAt = now(); }
  });

  // ── Phase 4 · Build ────────────────────────────────────────────────
  const buildResults = [];
  const spawning = substrate === 'spawn' || substrate === 'hybrid';
  let verify = { ran: false, passed: false, rounds: 0, output: '' };

  if (spawning) {
    // Hybrid heavy build: launch a coding CLI in its own terminal per task. The terminals
    // pick up work from the shared board and run autonomously (requires the CLI installed).
    onPhase('build', `Launching ${design.tasks.length} agent terminal(s) [${substrate}]`);
    for (let i = 0; i < design.tasks.length; i++) {
      const t = design.tasks[i];
      await setStatus(ids[i], 'doing');
      try {
        await spawnDomain.commands.new.run(
          { _: [], role: t.title.replace(/[^A-Za-z0-9]+/g, '').slice(0, 20) || `Task${i + 1}`, cli: ctx?.cli || 'claude', dir: ctx?.cwd || process.cwd(), by: 'factory' },
          ctx || { print: onLog, cwd: process.cwd() }
        );
        buildResults.push({ task: t.title, spawned: true });
      } catch (e) {
        onLog(`⚠ spawn failed for "${t.title}" (${e.message}) — leaving it on the board`);
        buildResults.push({ task: t.title, spawned: false, error: e.message });
      }
    }
    onLog('terminals launched — they build autonomously from the board');
  } else {
    // In-process build: one team designed from the brief+plan, driven through the
    // build→verify loop per task. Fully headless.
    onPhase('build', 'Assembling the build team');
    const teamConfigs = await generateAgentTeam({ task: briefText + '\n\n' + planText, activeProviders: providers, onStatus: onLog });
    const orch = new Orchestrator({
      agents: teamConfigs.map(c => new Agent(c)),
      supervisorProvider: providerName,
      toolPolicy: 'all',
      signal,
    });
    onLog('team: ' + teamConfigs.map(c => c.name).join(', '));
    const onSpeak = (name, text, thinking) => { if (!thinking && name !== 'System') onLog(`[${name}] ${String(text).slice(0, 140)}`); };

    for (let i = 0; i < design.tasks.length; i++) {
      if (abort()) throw new Error('aborted');
      const t = design.tasks[i];
      onPhase('build', `Building ${i + 1}/${design.tasks.length}: ${t.title}`);
      await setStatus(ids[i], 'doing');
      const prompt = `Build this task now (write the files, run what you need):\n${t.detail}\n\nAcceptance: ${t.acceptance || 'the code compiles and runs'}\n\n[Project brief]\n${briefText}`;
      const r = await orch.runBuild(prompt, { maxTurns: buildTurns, mode: 'collaborative', verifyCmd: '', rounds: 1 }, onSpeak);
      await setStatus(ids[i], 'done');
      buildResults.push({ task: t.title, output: r.finalOutput });
    }

    // ── Phase 5 · Integrate + verify the whole project ──────────────
    if (verifyCmd) {
      onPhase('integrate', `Verifying the whole project: \`${verifyCmd}\``);
      for (let round = 1; round <= Math.max(1, integrateRounds); round++) {
        if (abort()) throw new Error('aborted');
        verify.ran = true; verify.rounds = round;
        const chk = await runCheck(verifyCmd);
        verify.output = chk.output; verify.passed = chk.passed;
        if (chk.passed) { onLog(`✓ integration passed — ${verifyCmd}`); break; }
        onLog(`✗ integration failed (round ${round}/${integrateRounds})`);
        if (round < integrateRounds) {
          await orch.runBuild(
            `The integration check \`${verifyCmd}\` FAILED. Fix the project so it passes.\nFailure output:\n${String(chk.output).slice(0, 2000)}`,
            { maxTurns: buildTurns, mode: 'collaborative', verifyCmd: '', rounds: 1 }, onSpeak
          );
        }
      }
    }
  }
  // Parent task closes when the in-process build+verify is done (spawn hands off to terminals).
  await setStatus(parentId, spawning ? 'doing' : (!verify.ran || verify.passed ? 'done' : 'review'));

  try {
    brainSave({
      title: (brief.goal || raw).slice(0, 60),
      content: `Goal: ${raw}\n\n${planText}`,
      category: 'factory', tags: 'factory,plan',
    });
  } catch { /* ignore */ }

  onPhase('done', 'Factory run complete');
  return { goal: raw, brief, design, artifactsDir, taskIds: { parentId, ids }, buildResults, verify, substrate };
}
