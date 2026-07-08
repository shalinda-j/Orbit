import fs from 'fs';
import path from 'path';
import { orbitDir } from './store.js';

// ─────────────────────────────────────────────
// The Brain — a persistent, self-contained knowledge base (like company-brain).
// Notes are plain markdown files with YAML-ish frontmatter under ./.orbit/brain,
// so they stay human-readable, git-friendly, and greppable. Links via [[slug]].
// ─────────────────────────────────────────────

const brainDir = () => path.join(orbitDir(), 'brain');

function ensure() { fs.mkdirSync(brainDir(), { recursive: true }); }

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'note';
}

function toList(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  return String(tags || '').split(/[\s,]+/).filter(Boolean);
}

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = { title: path.basename(file, '.md'), category: '', tags: [], updated: '' };
  let body = raw;
  if (m) {
    body = m[2];
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (!kv) continue;
      if (kv[1] === 'tags') meta.tags = toList(kv[2]);
      else if (kv[1] in meta) meta[kv[1]] = kv[2];
    }
  }
  return { slug: path.basename(file, '.md'), file, body: body.trim(), ...meta };
}

function allNotes() {
  ensure();
  return fs.readdirSync(brainDir())
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const file = path.join(brainDir(), f);
      const note = parse(file);
      note.mtime = fs.statSync(file).mtimeMs;
      return note;
    });
}

export function brainSave({ title, content, category = '', tags = '' }) {
  ensure();
  if (!title) throw new Error('brain save needs a title');
  const slug = slugify(title);
  const file = path.join(brainDir(), slug + '.md');
  const fm = [
    '---',
    `title: ${title}`,
    `category: ${category}`,
    `tags: ${toList(tags).join(', ')}`,
    `updated: ${new Date().toISOString()}`,
    '---',
    '',
    '',
  ].join('\n');
  fs.writeFileSync(file, fm + (content || ''), 'utf8');
  return { slug, file };
}

export function brainGet(slug) {
  const file = path.join(brainDir(), slugify(slug) + '.md');
  if (!fs.existsSync(file)) return null;
  return parse(file);
}

export function brainSearch({ query = '', category = '', tag = '' } = {}) {
  const q = query.toLowerCase();
  return allNotes()
    .filter(n => !category || n.category === category)
    .filter(n => !tag || n.tags.includes(tag))
    .filter(n => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q)))
    .sort((a, b) => b.mtime - a.mtime);
}

export function brainRecent(n = 10) {
  return allNotes().sort((a, b) => b.mtime - a.mtime).slice(0, n);
}

/** Notes that link to the given slug via [[slug]]. */
export function brainBacklinks(slug) {
  const target = slugify(slug);
  return allNotes().filter(n => new RegExp(`\\[\\[\\s*${target}\\s*\\]\\]`, 'i').test(n.body));
}
