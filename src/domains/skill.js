import fs from 'fs';
import path from 'path';
import { extSkills } from '../extensions.js';
import { extInit } from '../extensions.js';
import { getProvider } from '../providers/index.js';
import { isProviderConfigured, PROVIDER_NAMES } from '../config.js';
import { orbitDir } from '../store.js';

const skillsDir = () => path.join(orbitDir(), 'skills');

// Parse a <name>.md file: optional "# Title" or "description:" line → description, rest → instructions.
function parseMd(name, text) {
  const lines = text.split(/\r?\n/);
  let description = '';
  let start = 0;
  const first = (lines[0] || '').trim();
  const m = first.match(/^#\s+(.*)$/) || first.match(/^description:\s*(.*)$/i);
  if (m) { description = m[1].trim(); start = 1; }
  return { name, description, instructions: lines.slice(start).join('\n').trim() };
}

function fileSkills() {
  const dir = skillsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseMd(f.slice(0, -3), fs.readFileSync(path.join(dir, f), 'utf8')));
}

// extSkills (config + plugins) wins over markdown files on name collision.
async function allSkills() {
  await extInit(); // populate the extension registry before reading it
  const byName = new Map();
  for (const s of fileSkills()) byName.set(s.name, s);
  for (const s of extSkills()) if (s?.name) byName.set(s.name, s);
  return [...byName.values()];
}

export default {
  name: 'skill',
  help: 'Reusable instruction snippets — list, show, create, run',
  commands: {
    list: {
      desc: 'skill list — print each skill name + description',
      run: async (_args, ctx) => {
        const skills = await allSkills();
        if (!skills.length) { ctx.print('  (no skills)'); return; }
        for (const s of skills) ctx.print(`  ${s.name}${s.description ? '  — ' + s.description : ''}`);
      },
    },
    show: {
      desc: 'skill show <name> — print its instructions',
      run: async (args, ctx) => {
        const name = args._[0];
        if (!name) throw new Error('usage: skill show <name>');
        const s = (await allSkills()).find(x => x.name === name);
        if (!s) throw new Error(`no such skill: ${name}`);
        ctx.print(s.instructions || '(no instructions)');
      },
    },
    new: {
      desc: 'skill new <name> "instructions..." [--desc "..."] — create a markdown skill',
      run: async (args, ctx) => {
        const name = args._[0];
        const instructions = args._[1];
        if (!name || !instructions) throw new Error('usage: skill new <name> "instructions..." [--desc "..."]');
        fs.mkdirSync(skillsDir(), { recursive: true });
        const file = path.join(skillsDir(), `${name}.md`);
        const body = `# ${name}\n${args.desc ? `description: ${args.desc}\n` : ''}\n${instructions}\n`;
        fs.writeFileSync(file, body, 'utf8');
        ctx.print(`  wrote ${file}`);
      },
    },
    run: {
      desc: 'skill run <name> "input text" — execute a skill against the first configured provider',
      run: async (args, ctx) => {
        const name = args._[0];
        const input = args._[1];
        if (!name || !input) throw new Error('usage: skill run <name> "input text"');
        const skill = (await allSkills()).find(x => x.name === name);
        if (!skill) throw new Error(`no such skill: ${name}`);
        const active = PROVIDER_NAMES.filter(isProviderConfigured);
        if (!active.length) throw new Error('no provider configured');
        const chosen = active.includes('claude-code') ? 'claude-code' : active[0];
        const res = await getProvider(chosen).chat({
          systemPrompt: skill.instructions,
          messages: [{ role: 'user', content: input }],
        });
        ctx.print(res.content);
      },
    },
  },
};
