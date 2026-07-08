# Orbit — Multi-Agent Team CLI + Brain

`orbit` is a command-line multi-agent team system. It gives you a shared **task board**, a team
**channel**, a persistent **brain** (knowledge base), and the ability to run work with either
**orbit's own in-process AI agents** (any provider) or **spawned external coding CLIs**
(claude / codex / gemini / …) — all coordinating through one shared, on-disk state.

It's a self-contained CLI reimagining of the Claude-Team-MCP + company-brain idea: **no MCP server
required** — every capability is a plain `orbit <domain> <action>` command, so any agent (human or CLI)
coordinates just by shelling out to `orbit`.

---

## Concepts

- **Shared store** — all team state lives in `./.orbit/store.json` (tasks, messages, roster, findings,
  debates, approvals, events). Every `orbit` process in that directory reads/writes the same state under a lock.
- **Brain** — markdown notes in `./.orbit/brain/` with tags and `[[links]]`, searchable and greppable.
- **Domains** — each capability is an auto-discovered file in `src/domains/`. Run `orbit help` to list them.
- **Two kinds of agents**
  - *In-process* — `orbit run "goal"` designs a team of orbit's own provider agents and builds the task.
  - *External* — `orbit spawn new --role Backend --cli claude` opens a real CLI in a new terminal that
    joins the team and coordinates via `orbit` commands.

---

## Install

**curl** (macOS / Linux / Git-Bash) — clones orbit and puts it on your PATH, no sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/shalinda-j/Orbit/main/install.sh | bash
```

**PowerShell** (Windows):

```powershell
irm https://raw.githubusercontent.com/shalinda-j/Orbit/main/install.ps1 | iex
```

**npm / bun** (once published to the registry):

```bash
npm i -g orbit-ai        # or:  bun i -g orbit-ai
```

**brew / paru** — formula + PKGBUILD are in [`packaging/`](packaging/) (publish to a tap / the AUR).

**From source:**

```bash
git clone https://github.com/shalinda-j/Orbit && cd Orbit
npm install
npm i -g .          # or `npm link` — puts `orbit` on your PATH
```

Then run `orbit init` to write a `.env` template, and `orbit` to start.

## Providers

Provide **at least one** of:

- **Claude Code subscription (no API key)** — install [Claude Code](https://claude.com/claude-code)
  and log in (`claude` once, or `claude setup-token`). Orbit auto-detects the `claude` CLI, prefers it,
  and runs agents on your subscription with **no per-token API cost**. Nothing to put in `.env`.
- **An API key** for a native provider — OpenAI, Anthropic, Gemini, or NVIDIA.
- **A preset provider** — just add the key; the base URL is baked in:
  **OpenRouter, z.ai (GLM), Kimi (Moonshot), Groq, DeepSeek, Together, Mistral, xAI (Grok), Fireworks**
  (`OPENROUTER_API_KEY`, `ZAI_API_KEY`, `KIMI_API_KEY`, …; override the model with `<NAME>_MODEL`).
- **Ollama** (local) or the **`custom`** provider (any OpenAI-compatible base URL you specify).

Run **`orbit connect`** (or `/connect` in the TUI) to list every provider and how to wire each one.
`orbit init` writes a `.env` template; see `.env.example` for all keys.

Because agents are assigned per-provider, a single run can mix them — e.g. a Groq agent planning, a
DeepSeek agent coding, and a Kimi agent reviewing.

> When using the `claude-code` provider, the token counts orbit reports include Claude Code's own
> system prompt overhead, and the dollar cost estimate does not apply — usage is covered by your subscription.

---

## Usage

Run `orbit` with no arguments for the interactive TUI, or use one-shot commands:

```bash
orbit help                                   # list every domain & action

# roster
orbit team join --role PM --cli human
orbit team status

# task board
orbit task add "Build auth API" --assignee Backend --priority high --by PM
orbit task add "Write tests" --depends 1
orbit task board
orbit task start 1 --by Backend
orbit task done 1 --by Backend

# team channel
orbit msg post "starting on auth" --from Backend --mention PM
orbit msg read --mention PM
orbit msg wait --role Backend --timeout 60   # block until pinged

# brain (persistent knowledge)
orbit brain save "Auth Decision" "JWT + refresh tokens, 15m access TTL" --tags auth,security
orbit brain search jwt
orbit brain recent

# run work with orbit's own AI agents
orbit run "Create a Python CLI that summarizes Apache access logs"

# bring in an external coding CLI as a teammate
orbit spawn new --role Backend --cli claude
```

### Extending orbit

Orbit is extensible through a config file (`./.orbit/config.json`, plus a global `~/.orbit/config.json`):

- **Add any provider manually** — `orbit connect add --name myllm --base-url https://… --key-env MY_KEY --model …`
  (or hand-edit `providers` in the config). Any OpenAI-compatible endpoint works.
- **Plugins** — `orbit plugin add ./my-plugin.js`. A plugin exports `register(api)` and can call
  `api.addProvider()`, `api.addDomain()`, `api.addHook()`, `api.addSkill()`. See `examples/orbit-plugin-example.js`.
- **Hooks** — run a shell command on lifecycle events: `orbit hook add --on run.after --run "notify-send done"`.
  Events: `session.start`, `run.before`, `run.after` (the command receives `ORBIT_EVENT` / `ORBIT_CONTEXT`).
- **Skills** — reusable instruction snippets: `orbit skill new review "You are a strict code reviewer…"`, then
  `orbit skill run review "<paste diff>"`. Skills also load from `.orbit/skills/*.md` and plugins.
- **MCP servers** — connect Model Context Protocol servers: `orbit mcp add --name fs --command npx --args "-y,@modelcontextprotocol/server-filesystem,."`,
  then `orbit mcp tools fs` / `orbit mcp call fs read_file --args '{"path":"README.md"}'`.
  **Bridged into runs:** every configured MCP server's tools are auto-discovered and offered to the agents
  during `orbit run` / build & plan modes — an agent can call one mid-task with
  `<tool:mcp server="fs" name="read_file">{"path":"README.md"}</tool:mcp>` and gets the result fed back.
- **GitHub / GitLab** — `orbit github pr list`, `orbit gitlab mr list` (wraps the `gh` / `glab` CLIs).
  For raw REST access with a token (no CLI needed), add the plugin: `orbit plugin add ./plugins/git-api.js`
  then `orbit ghapi repo <owner/repo>` / `orbit glapi issues <group/project>` (set `GITHUB_TOKEN` / `GITLAB_TOKEN`).

Run `orbit config` to see everything that's loaded.

### Full-parity domains

Beyond the core above, orbit mirrors the Claude-Team-MCP surface:

| Domain        | What it does                                                             |
|---------------|--------------------------------------------------------------------------|
| `debate`      | Structured propose → critique → revise → vote → judge                    |
| `finding`     | Security findings board (report / triage / verify / summary / audit)     |
| `approval`    | Approval gates (request / approve / reject / check)                      |
| `metrics`     | velocity, burndown, bottlenecks, retrospective, timeline, export         |
| `template`    | Save & run reusable team/goal templates                                  |
| `backup`      | Store snapshots, restore, checkpoints, session summaries                 |
| `trigger`     | Event-driven automations (`on task.status → post/task`, via `check`)     |
| `dashboard`   | Live web view of board + channel + findings (`dashboard serve`)          |
| `orchestrate` | High-level "build X with a team" — creates tasks & spawns the members    |

Run `orbit <domain>` with no action to see its available actions.

### Interactive TUI modes

Like Claude Code, the TUI has modes (shown in the prompt and banner). Cycle with `/mode`, or set directly:

| Mode      | What it does                                                                 |
|-----------|------------------------------------------------------------------------------|
| **chat**  | One fast, cheap reply — no team, no synthesis. For quick questions.          |
| **plan**  | The team produces a plan/design only — read-only, no file writes or commands.|
| **build** | Full multi-agent build.                                                      |

- `/skip` toggles **permissions**: `safe` (read-only) ↔ `auto` (agents may write files & run commands).
- `/style` toggles `collaborative` ↔ `sequential`. `/turns N` sets max turns.

### Interactive TUI slash commands

Session: `/help`, `/mode`, `/chat` `/plan` `/build`, `/skip`, `/style`, `/turns N`, `/model`, `/clear`, `/exit`.
Plus the **whole domain system** — `/board`, `/team`, `/brain`, `/task add "…"`, `/brain save "t" "…"`,
`/msg post "…"`, `/spawn new --role X`, and any other `orbit <domain> <action>`.
Type a message with no slash to run the team on it.

---

## How external agents coordinate (no MCP)

`orbit spawn new` opens a coding CLI in a new terminal and posts a kickoff message to the channel.
That agent joins and works purely through `orbit` commands against the shared `./.orbit` state:

```
orbit team join --role Backend --cli claude
orbit msg read --mention Backend
orbit task list
# ... do the work ...
orbit msg post "auth done" --from Backend --mention PM
orbit task done 3 --by Backend
```

Override how a CLI is launched with the `CLI_COMMANDS` env var, e.g. `CLI_COMMANDS="claude=claude,foo=foo-cli"`.

---

## Tests

```bash
npm test        # core logic + team/brain domain tests (offline, providers mocked)
```
