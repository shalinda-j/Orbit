import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const BUILTIN_TOOLS = [
  {
    name: 'view_file',
    description: 'Read the contents of a file. Optionally specify startLine and endLine (1-indexed).',
    parameters: ['path', 'startLine', 'endLine'],
    execute: async ({ path: filePath, startLine, endLine }) => {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) {
        return `Error: File not found at ${filePath}`;
      }
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (startLine || endLine) {
          const lines = content.split('\n');
          const start = startLine ? parseInt(startLine, 10) - 1 : 0;
          const end = endLine ? parseInt(endLine, 10) : lines.length;
          return lines.slice(start, end).join('\n');
        }
        return content;
      } catch (err) {
        return `Error reading file: ${err.message}`;
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
      const fullPath = path.resolve(process.cwd(), filePath);
      try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content || '', 'utf8');
        return `Success: Wrote file to ${filePath}`;
      } catch (err) {
        return `Error writing file: ${err.message}`;
      }
    }
  },
  {
    name: 'list_dir',
    description: 'List the files and directories inside a folder.',
    parameters: ['path'],
    execute: async ({ path: dirPath }) => {
      const targetPath = dirPath || '.';
      const fullPath = path.resolve(process.cwd(), targetPath);
      if (!fs.existsSync(fullPath)) {
        return `Error: Directory not found at ${targetPath}`;
      }
      try {
        const files = fs.readdirSync(fullPath);
        if (files.length === 0) return 'Directory is empty.';
        return files.map(f => {
          const stat = fs.statSync(path.join(fullPath, f));
          return `${stat.isDirectory() ? '[DIR]' : '[FILE]'} ${f} (${stat.size} bytes)`;
        }).join('\n');
      } catch (err) {
        return `Error listing directory: ${err.message}`;
      }
    }
  },
  {
    name: 'run_command',
    description: 'Execute a command in the local terminal shell.',
    parameters: ['command'],
    execute: async ({ command }) => {
      if (!command) return `Error: run_command needs a command string.`;
      const blocklist = ['rm -rf /', 'del /s', 'format', 'mkfs'];
      if (blocklist.some(b => command.includes(b))) {
        return `Error: Command blocked for safety.`;
      }
      try {
        const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
        return stdout + (stderr ? `\nStderr:\n${stderr}` : '');
      } catch (err) {
        return `Error running command: ${err.message}`;
      }
    }
  }
];

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
