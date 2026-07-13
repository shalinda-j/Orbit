import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Security helpers ─────────────────────────────────────────────
// Contain a tool path to the working directory: resolve it, then verify it stays
// inside cwd. Rejects '../' traversal and absolute paths (C:\..., /root/.ssh, ~).
// This is the trust boundary — an LLM-steered agent must not read/write outside the project.
export function containedPath(relPath) {
  if (relPath == null || relPath === '') return { ok: false, reason: 'no path given' };
  const root = path.resolve(process.cwd());
  const full = path.resolve(root, String(relPath));
  const rel = path.relative(root, full);
  // Outside cwd when the relative path climbs out ('..') or is absolute (different drive on Windows).
  if (rel === '' ) return { ok: true, full };            // cwd itself (list_dir '.')
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: `path escapes the working directory: ${relPath}` };
  }
  return { ok: true, full };
}

// Files/dirs the agent tools must not touch: secrets and machinery, plus anything the user
// lists in .orbitignore. Protects .env from being read into the brain, and keeps agents out of
// node_modules / .git / .orbit. Patterns: a name (`.env`), a dir (`node_modules`), or `*.ext`.
function loadIgnore() {
  const patterns = ['.env', '.git', 'node_modules', '.orbit'];
  try {
    const f = path.join(process.cwd(), '.orbitignore');
    if (fs.existsSync(f)) {
      for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const t = l.trim();
        if (t && !t.startsWith('#')) patterns.push(t.replace(/[\\/]+$/, ''));
      }
    }
  } catch { /* no ignore file */ }
  return patterns;
}
export function isIgnored(rel) {
  const norm = String(rel).replace(/\\/g, '/');
  if (!norm || norm === '.') return false;
  const first = norm.split('/')[0];
  const base = norm.split('/').pop();
  for (const raw of loadIgnore()) {
    const pat = raw.replace(/\\/g, '/');
    if (norm === pat || first === pat) return true;              // exact, or a top-level ignored dir/name
    if (norm.startsWith(pat + '/')) return true;                 // inside an ignored path
    if (pat.startsWith('*.') && base.endsWith(pat.slice(1))) return true; // *.log style
    if (base === pat) return true;                               // bare filename anywhere
  }
  return false;
}

// Strip home/cwd absolute prefixes out of an error string so tool/provider errors
// fed back to the model (and persisted to the brain) don't leak local filesystem layout.
export function redact(msg) {
  let s = String(msg == null ? '' : msg);
  try {
    const home = os.homedir();
    if (home) s = s.split(home).join('~');
    const cwd = process.cwd();
    s = s.split(cwd).join('.');
  } catch { /* best effort */ }
  return s;
}

const MAX_TOOL_OUTPUT = 20000;   // cap what any tool returns to the model (context/token guard)
const MAX_CMD_BUFFER = 1024 * 1024; // 1 MB stdout/stderr ceiling for run_command

function clip(text, limit = MAX_TOOL_OUTPUT) {
  const s = String(text ?? '');
  if (s.length <= limit) return s;
  return s.slice(0, limit) + `\n…[truncated ${s.length - limit} more chars]`;
}

// Snapshot a file's current contents before an agent overwrites it, so a bad edit is
// recoverable from .orbit/undo/ (mirrors the relative path; keeps only the latest).
// ponytail: latest-version-only snapshot; add a versioned trash if multi-undo is ever needed.
function checkpoint(root, rel, full) {
  try {
    if (!fs.existsSync(full)) return; // nothing to back up (new file)
    const dest = path.join(root, '.orbit', 'undo', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(full, dest);
  } catch { /* best effort — never block the write on a failed backup */ }
}

// Detect genuinely destructive commands (defense-in-depth, NOT a sandbox). Matches the
// dangerous *shape* (whitespace-tolerant, variant-aware) instead of a few literal strings.
// ponytail: this is a guard, not isolation — real safety would run commands in a container.
const DANGER = [
  /\bdel\s+\/[sq]/i,                    // del /s  del /q
  /\brmdir\s+\/s/i,
  /\bmkfs(\.\w+)?\b/i,                  // format a filesystem
  /\bformat\s+[a-z]:/i,                 // format C:
  /\bdd\s+.*\bof=\/dev\/(sd|nvme|disk|hd)/i, // dd to a raw disk
  /\bshutdown\b|\breboot\b|\bhalt\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb :(){ :|:& };:
  /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, // curl … | sh
  /\bpowershell\b[^\n]*\s-(enc|e|encodedcommand)\b/i,      // encoded PowerShell payload
  /\b(chmod|chown)\s+-R\s+.*\s\//i,
  />\s*\/dev\/(sd|nvme|disk)/i,
];

function isDangerous(command) {
  const c = String(command).toLowerCase();
  // `rm` with a recursive+force flag aimed at a root/home/cwd/glob target — the classic catastrophe.
  const hasRm = /\brm\b/.test(c);
  const recursiveForce = /(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\s+-f|-f\s+-r|--recursive|--force)/.test(c);
  const rootTarget = /(^|\s)(\/|~|\.|\*)(\s|$|\*|\/)/.test(c); // '/', '/*', '~', '.', '*' (not a specific subdir)
  if (hasRm && recursiveForce && rootTarget) return true;
  return DANGER.some((re) => re.test(command));
}

export const BUILTIN_TOOLS = [
  {
    name: 'view_file',
    description: 'Read the contents of a file. Optionally specify startLine and endLine (1-indexed).',
    parameters: ['path', 'startLine', 'endLine'],
    execute: async ({ path: filePath, startLine, endLine }) => {
      const c = containedPath(filePath);
      if (!c.ok) return `Error: ${c.reason}`;
      if (isIgnored(path.relative(process.cwd(), c.full))) return `Error: "${filePath}" is protected/ignored — access denied.`;
      if (!fs.existsSync(c.full)) {
        return `Error: File not found at ${filePath}`;
      }
      try {
        const content = fs.readFileSync(c.full, 'utf8');
        if (startLine || endLine) {
          const lines = content.split('\n');
          const start = startLine ? parseInt(startLine, 10) - 1 : 0;
          const end = endLine ? parseInt(endLine, 10) : lines.length;
          return clip(lines.slice(start, end).join('\n'));
        }
        return clip(content);
      } catch (err) {
        return `Error reading file: ${redact(err.message)}`;
      }
    }
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file with new content.',
    parameters: ['path', 'content'],
    execute: async ({ path: filePath, content }) => {
      // Refuse when no content was provided (e.g. a truncated tag) — never blank an existing file.
      if (content === undefined) return `Error: write_file needs content (none provided — the tool call may have been truncated). File left unchanged.`;
      const c = containedPath(filePath);
      if (!c.ok) return `Error: ${c.reason}`;
      if (isIgnored(path.relative(process.cwd(), c.full))) return `Error: "${filePath}" is protected/ignored — refusing to write.`;
      try {
        const root = path.resolve(process.cwd());
        const rel = path.relative(root, c.full);
        checkpoint(root, rel, c.full); // snapshot prior contents → .orbit/undo/ for recovery
        fs.mkdirSync(path.dirname(c.full), { recursive: true });
        fs.writeFileSync(c.full, content || '', 'utf8');
        return `Success: Wrote file to ${filePath}`;
      } catch (err) {
        return `Error writing file: ${redact(err.message)}`;
      }
    }
  },
  {
    name: 'list_dir',
    description: 'List the files and directories inside a folder.',
    parameters: ['path'],
    execute: async ({ path: dirPath }) => {
      const c = containedPath(dirPath || '.');
      if (!c.ok) return `Error: ${c.reason}`;
      if (isIgnored(path.relative(process.cwd(), c.full))) return `Error: "${dirPath || '.'}" is protected/ignored — access denied.`;
      if (!fs.existsSync(c.full)) {
        return `Error: Directory not found at ${dirPath || '.'}`;
      }
      try {
        const files = fs.readdirSync(c.full);
        if (files.length === 0) return 'Directory is empty.';
        return clip(files.map(f => {
          const stat = fs.statSync(path.join(c.full, f));
          return `${stat.isDirectory() ? '[DIR]' : '[FILE]'} ${f} (${stat.size} bytes)`;
        }).join('\n'));
      } catch (err) {
        return `Error listing directory: ${redact(err.message)}`;
      }
    }
  },
  {
    name: 'run_command',
    description: 'Execute a command in the local terminal shell.',
    parameters: ['command'],
    execute: async ({ command }) => {
      if (!command) return `Error: run_command needs a command string.`;
      if (isDangerous(command)) {
        return `Error: Command blocked for safety (matched a destructive pattern). If this is intentional, run it yourself outside the agent.`;
      }
      try {
        // stdio:'ignore' for stdin so a command that waits on input can't hang until the timeout;
        // maxBuffer caps memory; output is clipped before it reaches the model.
        const { stdout, stderr } = await execAsync(command, {
          timeout: 30000,
          maxBuffer: MAX_CMD_BUFFER,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return clip(stdout + (stderr ? `\nStderr:\n${stderr}` : ''));
      } catch (err) {
        // err carries partial stdout/stderr on timeout/maxBuffer — surface what we have, redacted.
        const extra = (err.stdout || '') + (err.stderr ? `\nStderr:\n${err.stderr}` : '');
        return clip(`Error running command: ${redact(err.message)}${extra ? '\n' + extra : ''}`);
      }
    }
  }
];

// Run a verification/acceptance command and report pass/fail by EXIT CODE (unlike the
// run_command tool, which only returns text). Same danger gate + output caps. Powers the
// build→verify loop: "done" means the checks actually pass, not just that an agent said so.
// A longer timeout than run_command (a real test/build suite is slower than an agent's ad-hoc command).
const MAX_CHECK_MS = 120000;
export async function runCheck(command) {
  if (!command) return { passed: false, output: 'no verify command given' };
  if (isDangerous(command)) {
    return { passed: false, output: 'verify command blocked for safety (matched a destructive pattern)' };
  }
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: MAX_CHECK_MS,
      maxBuffer: MAX_CMD_BUFFER,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { passed: true, output: clip(stdout + (stderr ? `\nStderr:\n${stderr}` : '')) };
  } catch (err) {
    // Non-zero exit (or timeout/maxBuffer) rejects — that's a FAILED check. Surface what we have, redacted.
    const extra = (err.stdout || '') + (err.stderr ? `\nStderr:\n${err.stderr}` : '');
    return { passed: false, output: clip(`${redact(err.message)}${extra ? '\n' + extra : ''}`) };
  }
}

// Parse an attribute string, honoring the SAME quote that opened each value.
// Values may contain the other quote type and '>' without truncating.
function parseAttrs(str) {
  const params = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(str)) !== null) params[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return params;
}

/**
 * Parse the first <tool:NAME .../> or <tool:NAME ...>body</tool:NAME> tag.
 * Scans attributes quote-aware (so `>` and the other quote type inside a value
 * don't break it) and requires a real self-close ('/>') or a matching close tag —
 * a TRUNCATED tag returns null instead of a dangerous parameterless call.
 */
export function parseToolCall(content) {
  const open = content.match(/<tool:(\w+)/);
  if (!open) return null;
  const name = open[1];

  // Walk the attribute region until an unquoted '>' ends the tag.
  let i = open.index + open[0].length;
  let attrs = '';
  let quote = null;
  for (; i < content.length; i++) {
    const ch = content[i];
    if (quote) { attrs += ch; if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") { quote = ch; attrs += ch; }
    else if (ch === '>') break;
    else attrs += ch;
  }
  if (i >= content.length) return null; // no closing '>' — truncated tag, ignore

  let selfClose = false;
  if (attrs.trimEnd().endsWith('/')) { selfClose = true; attrs = attrs.trimEnd().slice(0, -1); }

  const params = parseAttrs(attrs);
  if (selfClose) return { name, params };

  // Block form — require the matching close tag; unterminated block ⇒ ignore.
  const close = `</tool:${name}>`;
  const bodyStart = i + 1;
  const closeIdx = content.indexOf(close, bodyStart);
  if (closeIdx === -1) return null;
  params.content = content.slice(bodyStart, closeIdx);
  return { name, params };
}
