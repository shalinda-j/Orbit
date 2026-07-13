import { isProviderConfigured, PROVIDER_NAMES } from '../config.js';
import { runFactory } from '../factory.js';

// Preferred driver provider: subscription/local-friendly first, then keyed APIs.
const pickProvider = (active) =>
  ['claude-code', 'nvidia', 'gemini', 'openai', 'anthropic'].find(p => active.includes(p)) || active[0];

export default {
  name: 'factory',
  help: 'Autonomous build: discover → design → decompose → build → verify (one command)',
  commands: {
    default: {
      desc: 'factory "build X" [--design single|debate] [--substrate inprocess|hybrid|spawn] [--verify "npm test"] [--rounds N] [--cli claude]',
      run: async (a, ctx) => {
        const goal = a._.length ? a._.join(' ') : a.goal;
        if (!goal) throw new Error('need a goal: factory "build X"');

        const active = PROVIDER_NAMES.filter(isProviderConfigured);
        if (!active.length) throw new Error('No providers configured. Run `orbit connect` and add a provider.');

        const providerName = pickProvider(active);
        const substrate = String(a.substrate || 'inprocess').toLowerCase();
        if (!['inprocess', 'hybrid', 'spawn'].includes(substrate)) {
          throw new Error('--substrate must be inprocess, hybrid, or spawn');
        }
        const designMode = String(a.design || 'single').toLowerCase();
        if (!['single', 'debate'].includes(designMode)) {
          throw new Error('--design must be single or debate');
        }

        ctx.print(`\n  ⚙  Orbit Factory — autonomous build`);
        ctx.print(`     goal       ${goal}`);
        ctx.print(`     substrate  ${substrate}${substrate !== 'inprocess' ? '  (launches coding CLIs in terminals — they must be installed)' : ''}`);
        ctx.print(`     driver     ${providerName}\n`);

        const res = await runFactory({
          goal,
          providerName,
          providers: active,
          substrate,
          designMode,
          verifyCmd: a.verify ? String(a.verify) : '',
          integrateRounds: parseInt(a.rounds, 10) || 2,
          onPhase: (_k, msg) => ctx.print(`\n  ▸ ${msg}`),
          onLog: (msg) => ctx.print(`     · ${msg}`),
          ctx: { ...ctx, cli: a.cli },
        });

        ctx.print(`\n  ── Factory summary ──`);
        ctx.print(`     spec       ${res.brief.goal}`);
        ctx.print(`     design     ${res.design.tasks.length} task(s) → ${res.taskIds.ids.map(id => '#' + id).join(' ')}${res.debateId ? `   (debate #${res.debateId} — orbit debate show ${res.debateId})` : ''}`);
        ctx.print(`     artifacts  ${res.artifactsDir}/plan.md`);
        if (res.substrate === 'inprocess') {
          ctx.print(`     built      ${res.buildResults.length} task(s) in-process`);
          if (res.verify.ran) ctx.print(`     verify     ${res.verify.passed ? '✓ passed' : '✗ failed'} after ${res.verify.rounds} round(s)`);
        } else {
          const ok = res.buildResults.filter(b => b.spawned).length;
          ctx.print(`     spawned    ${ok}/${res.buildResults.length} agent terminal(s) — building from the board`);
          ctx.print(`     track      orbit task list`);
        }
        ctx.print('');
      },
    },
  },
};
