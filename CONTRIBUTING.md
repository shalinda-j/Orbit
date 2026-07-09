# Contributing to Orbit

Thanks for your interest in improving Orbit. Contributions are welcome.

## Getting started

```bash
git clone https://github.com/shalinda-j/Orbit && cd Orbit
npm install
npm test        # all suites run offline (providers are mocked) — no network, no keys
```

## Ground rules

1. **Fork and branch from `main`.** Keep each PR focused on one change.
2. **Dependency-light and cross-platform.** Orbit ships with only `chalk` and `dotenv`. Don't add a
   dependency for something a few lines of standard library can do. Everything must work on Windows,
   macOS, and Linux (the CI matrix runs Ubuntu + Windows on Node 18/20/22).
3. **Match the existing style.** ESM, terse comments that explain *why*, no build step.
4. **Add or update a test in `tests/` and keep `npm test` green.** Tests are plain Node scripts that
   assert and `process.exit(1)` on failure — no framework. New security/reliability behavior belongs
   in `tests/test-hardening.js`; new dispatch behavior in `tests/test-dispatch.js`, etc.
5. **Never commit secrets or generated state.** `.env`, `node_modules/`, and `.orbit/` are ignored —
   keep it that way.

## Security

Code-bearing config (MCP servers, plugins, hooks) is trusted only from the global `~/.orbit/config.json`,
never from a project's `./.orbit/config.json`. Agent file tools are contained to the working directory
and honor `.orbitignore`. If you find a vulnerability, please open a security issue rather than a public PR.

## Architecture (one paragraph)

Every capability is a self-describing domain in `src/domains/` (auto-discovered by `src/cli.js`). The
multi-agent core is `src/genesis.js` (designs the team) → `src/orchestrator.js` (routes turns, runs the
tool loop) → `src/agent.js` + `src/providers/*` (one unified `chat()` per provider). Shared state lives
under `.orbit/` via `src/store.js` (locked JSON) and `src/brain.js` (markdown notes). See the README's
"How it works" for the full picture.
