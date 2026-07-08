import fs from 'fs';
import path from 'path';
import { withStore, logEvent, orbitDir } from '../store.js';

const storeFile = () => path.join(orbitDir(), 'store.json');
const backupsDir = () => path.join(orbitDir(), 'backups');
const summariesDir = () => path.join(orbitDir(), 'summaries');
const ensure = (d) => { fs.mkdirSync(d, { recursive: true }); return d; };
// note: file names come from --label / --name; strip path separators so nothing escapes .orbit
const safe = (s) => String(s).replace(/[^\w.\-]+/g, '-');

export default {
  name: 'backup',
  help: 'Snapshots of store.json + session summaries',
  commands: {
    now: {
      desc: "'backup now [--label X]' — snapshot store.json into backups/",
      run: async (a, ctx) => {
        if (!fs.existsSync(storeFile())) throw new Error('no store.json to back up yet');
        const name = `${Date.now()}${a.label ? '-' + safe(a.label) : ''}.json`;
        const dest = path.join(ensure(backupsDir()), name);
        // Copy under the store lock so we never snapshot a half-written store.json.
        await withStore(s => { fs.copyFileSync(storeFile(), dest); logEvent(s, 'backup.now', a.by || '', { file: name }); });
        ctx.print(`  ✓ backup ${name}  (${fs.statSync(dest).size} bytes)`);
      },
    },
    list: {
      desc: "'backup list' — list snapshot files with size",
      run: async (a, ctx) => {
        const dir = backupsDir();
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
        if (!files.length) return ctx.print('  (no backups)');
        ctx.print('\n  Backups');
        for (const f of files) ctx.print(`   ${f}  (${fs.statSync(path.join(dir, f)).size} bytes)`);
        ctx.print('');
      },
    },
    restore: {
      desc: "'backup restore <file>' — copy a snapshot back over store.json",
      run: async (a, ctx) => {
        const file = a._[0];
        if (!file) throw new Error('restore needs a backup file name (see `backup list`)');
        const src = path.join(backupsDir(), path.basename(file)); // basename: no traversal out of backups/
        if (!fs.existsSync(src)) throw new Error(`backup not found: ${file}`);
        let data;
        try { data = JSON.parse(fs.readFileSync(src, 'utf8')); } catch { throw new Error(`backup is not valid JSON: ${file}`); }
        // Apply under the lock so a concurrent writer can't clobber the restore.
        await withStore(s => { for (const k of Object.keys(s)) delete s[k]; Object.assign(s, data); });
        ctx.print(`  ✓ restored ${path.basename(file)} -> store.json`);
      },
    },
    checkpoint: {
      desc: "'backup checkpoint \"summary\" --by X' — append a context checkpoint line",
      run: async (a, ctx) => {
        const text = a._[0] || a.summary;
        if (!text) throw new Error('checkpoint needs a summary string');
        const by = a.by || '';
        const line = `${new Date().toISOString()}  ${by || 'unknown'}  ${text}\n`;
        fs.appendFileSync(path.join(ensure(summariesDir()), 'checkpoints.log'), line);
        await withStore(s => logEvent(s, 'backup.checkpoint', by, { summary: text }));
        ctx.print('  ✓ checkpoint saved');
      },
    },
    'save-summary': {
      desc: "'backup save-summary \"text\" --name X' — write summaries/<name>.md",
      run: async (a, ctx) => {
        const text = a._[0] || a.text;
        if (!text) throw new Error('save-summary needs summary text');
        if (!a.name) throw new Error('save-summary needs --name');
        const file = path.join(ensure(summariesDir()), safe(a.name) + '.md');
        fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n', 'utf8');
        ctx.print(`  ✓ summary ${safe(a.name)}.md`);
      },
    },
    'load-summary': {
      desc: "'backup load-summary <name>' — print summaries/<name>.md",
      run: async (a, ctx) => {
        const name = a._[0] || a.name;
        if (!name) throw new Error('load-summary needs a name');
        const file = path.join(summariesDir(), safe(name) + '.md');
        if (!fs.existsSync(file)) throw new Error(`summary not found: ${name}`);
        ctx.print('\n' + fs.readFileSync(file, 'utf8'));
      },
    },
  },
};
