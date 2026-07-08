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

export function parseToolCall(content) {
  // 1. Block tag format: <tool:write_file path="src/test.txt">content</tool:write_file>
  const blockMatch = content.match(/<tool:(\w+)\s*([^>]*)>([\s\S]*?)<\/tool:\1>/);
  if (blockMatch) {
    const name = blockMatch[1];
    const attrsStr = blockMatch[2];
    const innerContent = blockMatch[3];
    const params = { content: innerContent };

    const attrRegex = /(\w+)=["']([^"']*)["']/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
      params[attrMatch[1]] = attrMatch[2];
    }
    return { name, params };
  }

  // 2. Self-closing format: <tool:view_file path="src/tui.js" />
  const inlineMatch = content.match(/<tool:(\w+)\s*([^>]*)\/?>/);
  if (inlineMatch) {
    const name = inlineMatch[1];
    const attrsStr = inlineMatch[2];
    const params = {};

    const attrRegex = /(\w+)=["']([^"']*)["']/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
      params[attrMatch[1]] = attrMatch[2];
    }
    return { name, params };
  }

  return null;
}
