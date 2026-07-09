# Changelog

## v1.5.0

A large hardening + reliability + UX release from a full 8-dimension audit (34 agents), plus two
issues reported from the field.

### Field fixes
- **`/disconnect claude-code` now works.** Keyless providers (claude-code, ollama) can be turned off — the choice persists to `~/.orbit/.env` (`ORBIT_DISABLED_PROVIDERS`) and is re-enabled from the `/connect` wizard or `orbit connect enable <provider>`.
- **Route an external CLI through OpenRouter (or any provider).** `orbit spawn new --cli codex --via openrouter` (or explicit `--base-url/--api-key/--model`) injects `OPENAI_BASE_URL/KEY/MODEL` into the spawned CLI's env — so codex-style tools talk to OpenRouter instead of OpenAI, no shell injection.

### Security
- **Agent file tools are contained to the working directory.** `view_file`/`write_file`/`list_dir` reject `../` traversal and absolute paths, and honor **`.orbitignore`** — `.env`, `.git`, `node_modules`, `.orbit` are protected by default, so a steered agent can't read your keys or escape the project.
- **`run_command` gets a real danger gate**, not a 4-string blocklist: whitespace/variant-aware detection of `rm -rf /` (incl. `/*`), `mkfs`, `dd` to a raw disk, fork bombs, `curl … | sh`, encoded PowerShell, etc. Output is capped (1 MB buffer, 20 K returned) and stdin is closed so a command can't hang the run.
- **Secrets are scrubbed** before anything is written to the brain (API-key prefixes + labelled `key=…` pairs), and tool/provider error messages are **redacted** of home/cwd paths.
- **No shell when launching the Claude Code CLI** (parses `CLAUDE_CODE_BIN` itself), and the MCP client caps buffered stdout so a hostile server can't OOM it. The **Gemini key moved out of the URL** into a header.
- File writes now **snapshot the prior version to `.orbit/undo/`** for recovery.

### Reliability
- **Every provider now has a request timeout + automatic retry** (exponential backoff, honors `Retry-After`) on 429/5xx, and **classifies errors** (auth vs rate-limit vs context-length vs transient) with actionable messages.
- **A provider hiccup no longer aborts the whole run** — a failed agent turn fails over once to another configured provider.
- **Null / content-filtered responses no longer crash** the run (all providers coerce empty content; Gemini/Anthropic surface the block reason).
- **The store is written atomically** (temp-file + rename) and the lock's steal race + timeout mismatch are fixed.
- **Genesis** recovers a JSON team from prose/fenced output and **warns** (instead of silently falling back) when it can't.

### Performance / cost
- **Anthropic prompt caching** on the re-sent system prompt (~90% cheaper input on later turns).
- **Real per-provider cost estimate** — each agent's tokens priced by its own provider, not one flat rate; claude-code/local shown as free.
- **Lazy mode** now also skips the per-turn coordinator call (round-robin) and the synthesizer call.

### UX
- **Ctrl+C actually aborts** the in-flight model calls now (stops token spend), threaded end-to-end.
- **`/model` works for any provider** (`/model <provider> <model>` or `/model <model>` for the preferred one) — was NVIDIA-only.
- **Non-interactive one-shot**: `orbit -p "task"` or `echo task | orbit` runs the team once and prints the result (CI/scripting), and **`orbit --version`**.
- **Command history persists** across sessions (up-arrow), secrets excluded; **live spinner shows each agent's model**; first run with no providers points at `/connect`; new **`/last`** recalls the previous run.
- Fixed a display bug where `/effort`, `/mode`, `/skip` rendered as escape codes in `/help`.

### Distribution / DX
- **GitHub Actions CI** (Ubuntu + Windows, Node 18/20/22), **`prepublishOnly: npm test`**, `CHANGELOG.md` + `LICENSE` added to the published files, **CONTRIBUTING.md**, and the **ISC→MIT** license mismatch in the Homebrew/AUR manifests fixed.
- New **`tests/test-hardening.js`** suite (containment, ignore, danger gate, error classification, provider disable, genesis recovery, secret scrubbing). **17 suites, all green.**

Deferred (tracked): token streaming, full session serialize/resume, interactive per-write approval prompts, an apply-patch/diff tool, multiline paste input, MCP connection pooling.

## v1.4.1

### Fixed
- **Every bare `/command` now does something useful** instead of printing "Unknown action". A bare domain runs its conventional read-only action (`list` / `status` / `summary` / `board` / `recent`) when it has one, otherwise it shows that domain's available actions as help. Bare `/github` / `/gitlab` show auth status. A genuinely wrong action still reports the error.

## v1.4.0

### Security (an 11-agent adversarial audit found & fixed 7 verified issues)
- **RCE from a cloned repo — fixed (critical).** A repo's `./.orbit/config.json` could ship a malicious MCP server / plugin / hook that ran on the next task. Code-bearing config is now trusted **only from the global `~/.orbit/config.json`**; project config is ignored unless you set `ORBIT_TRUST_PROJECT=1`. `orbit mcp add` saves globally by default.
- **No shell injection.** MCP servers and spawned terminals are launched **without a shell**; `spawn --cli` is allowlisted and `--dir` rejects shell metacharacters.
- **Credential exfiltration — fixed.** The GitHub/GitLab API plugin refuses to send the token to any host other than the pinned API host.
- **Path traversal — fixed.** `skill new` sanitizes the name so it can't escape `.orbit/skills/`.

### Added / changed (UX)
- **Cleaner live `/` suggestions** — a curated, shorter list (was dumping all commands).
- **Durations as `Xm Ys`** — the thinking timer and task total show `1m 23s` / `1h 02m`, not raw seconds.
- **Pretty tables** — markdown tables in agent output render as aligned box-drawing tables.
- **Paragraph-by-paragraph reveal** — the team's turns reveal a paragraph at a time, downward.

## v1.3.2

### Added
- **Live slash-command suggestions** are back — as you type `/…`, matching commands appear on the line below the prompt (Tab still completes). This time it uses readline's scroll-safe relative cursor ops (not absolute save/restore), so it no longer corrupts input after the screen scrolls. Fully TTY-guarded.

## v1.3.1

### Changed
- File edits now show a compact **`✎ Edited <file>  +N -M`** stat (real added/removed line diff) instead of dumping the file contents. Any `write_file` code block in a shown message is collapsed to the same one-liner.

## v1.3.0

### Added
- **Effort levels** — `/effort low|medium|high|max` (or `ORBIT_EFFORT`): scales turns (2/4/6/10) and injects a deliberation directive so the team works as hard as you want.
- **Multi-provider select** — `/use groq,deepseek,kimi` restricts a run to specific providers/models (blank = all). Shown in the banner.
- **Provider disconnect** — `/disconnect <provider>` (and `orbit connect remove <provider>`) removes a key from `~/.orbit/.env` and live config.
- **Sub-agents** — any agent can delegate a subtask to a fresh sub-agent mid-run via `<tool:subagent role="…">subtask</tool:subagent>`, splitting work to move faster.
- **Live timers** — the spinner shows real-time elapsed seconds per agent, and each task prints its total time (`⏱ Ns`).
- **Memory & self-improvement** — every run is saved to the brain (category `runs`); before a new run, Orbit recalls relevant past work and feeds it to the team, reusing prior solutions and improving over time.

## v1.2.0

### Added
- **Interactive provider setup wizard** — type **`/connect`** in the TUI and connect providers **one at a time**: pick → paste key → optional model → save → "add another?". No more hand-editing `.env`.
- **Global key store** — keys entered via the wizard (or `orbit connect set`) are saved to `~/.orbit/.env` and loaded in every project, so you configure a provider once. Project `./.env` still overrides.
- **`orbit connect set <provider> <key> [--model M] [--base-url U]`** — set a provider non-interactively from the CLI.

### Fixed
- Wizard input handling is race-proof: fast/pasted answers are buffered so nothing is mistaken for a task.

## v1.1.3

### Fixed
- **Input corruption after the first task** — typing the next message garbled characters (jumping down), and backspace/Enter misbehaved. Cause: the live slash-suggestion writer drew escape sequences below the prompt on every keystroke, desyncing the cursor once the screen had scrolled. Removed it; **Tab-completion** for commands remains (type `/` then `Tab`).

## v1.1.2

### Added
- **Animated team conversation** — each agent now speaks with an `@handle` identity (e.g. `@designer`, `@boss`, `@qa`), the team roster shows as `⬡ Team @planner · @coder · @reviewer`, and turns reveal line-by-line as the team works.
- **@mention highlighting** — agents address teammates by `@handle`, and those mentions are colorized so you can see who's arguing with whom.
- **`/anim`** toggles the animation (auto-off in lazy mode or when output isn't a terminal).

## v1.1.1

### Added
- **Slash-command autocomplete** — type `/` in the TUI to see matching commands live below the prompt; press **Tab** to complete. Covers every session command and domain.
- **12 Chinese model providers** (all OpenAI-compatible) — Qwen (Alibaba), Zhipu GLM, Kimi/Moonshot (CN), MiniMax, Yi (01.AI), Baichuan, Tencent Hunyuan, Doubao (Volcengine), StepFun, SenseNova, iFlytek Spark, SiliconFlow. **28 providers total.**
- Reaffirmed **connect any custom model** with `orbit connect add --name … --base-url … --key-env … --model …` (no code changes needed).

### Changed
- Removed the "4 Layers of AI Engineering" section from the README.
- Stronger lazy-mode directive (reuse → stdlib → native → one line).

## v1.1.0

Token-frugality controls, polished docs, and a mapping to the 4 layers of AI engineering.

### Added
- **Lazy "lazy" mode** — `/lazy` (or `ORBIT_LAZY=1`): Genesis uses the fewest agents, every agent turn gets a hard "output the minimum" directive, and output is capped at ≤1024 tokens.
- **Output-token cap** — `/tokens N` (or `ORBIT_MAX_TOKENS`) threaded through **every** provider (OpenAI, Anthropic, Gemini, NVIDIA, Ollama, all OpenAI-compatible presets).
- **Single-agent runs skip the synthesizer** — one fewer model call when there's nothing to combine.
- Banner now shows `⚡ lazy` when active; version reads from `package.json`.

### Docs
- Colorful SVG **architecture diagram** and a **"4 Layers of AI Engineering"** section mapping Prompt / Context / Harness / Loop to Orbit's implementation.
- MIT license; professional README with hero banner, badges, and provider/mode tables.

## v1.0.1

Stability release. A 30-agent adversarial audit of every command found 19 real bugs; all are fixed and covered by regression tests.

### Fixed — tool calling (high impact)
- **Truncated `<tool:write_file>` no longer wipes files.** A tool tag cut off by `max_tokens` was mis-parsed as a parameterless call and blanked the target file. The parser now requires a real `/>` or matching close tag (truncated ⇒ ignored), and `write_file` refuses when no content is provided.
- **Tool args with `>` or mixed quotes are preserved.** `run_command command="npm test > out.txt"` and `command="git commit -m 'fix'"` no longer truncate — attributes are parsed quote-aware.

### Fixed — TUI
- **Ctrl+C now really interrupts.** A running task's output/spinner no longer keeps clobbering the prompt after Ctrl+C, and an aborted run can't reset state or allow overlapping concurrent tasks (generation-guarded).
- **A failing slash command can't crash or freeze the TUI.** The command chain always resolves; one error no longer poisons every later `/command`.
- **`/toString`, `/constructor` etc.** are no longer mistaken for domain commands (null-prototype registry).
- `[FINISHED]` control tag is stripped from displayed output.

### Fixed — commands
- **Multi-word goals** (`orbit run build a snake game`) are kept whole instead of truncated to `build` — in `run` and `orchestrate`.
- **`team join --role` with a missing value** is rejected instead of storing a boolean that permanently broke `team status`.
- **`finding audit`** seeds tasks as `todo` so they show on the board (were invisible `open`).
- **`github` / `gitlab`** flag values with spaces/metacharacters are shell-quoted (no more split/misfired commands), and `pr`/`mr`/`issue` no longer drop flags when given no positional.
- **`skill new`** files now round-trip: `--desc` shows correctly and no longer leaks into the instructions.
- **Ollama** agents from the team generator work: the `default` model sentinel is resolved.

### Fixed — data & platform
- **Brain notes with CRLF** line endings parse correctly on Windows (frontmatter no longer leaks into the body).
- **`backup now` / `backup restore`** run under the store lock (no torn snapshots, no lost restores).
- **MCP server args with spaces** (e.g. `C:\Program Files\...`) are quoted on Windows.
- **`spawn`** reports terminal-launch failures instead of always claiming success.

### Added
- Multi-provider team e2e test proving different providers/models on different agents communicate, route, use tools, and synthesize as one team.
- v1.0.1 bug-fix regression suite. Test suites: 8, all green.

## v1.0.0

Initial release — multi-agent, multi-provider AI team CLI: shared task board, brain, 16 providers, MCP bridge, plugins/hooks/skills, GitHub/GitLab, installers.
