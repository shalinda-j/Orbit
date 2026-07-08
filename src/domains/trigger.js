import { withStore, readStore, nextId, logEvent } from '../store.js';

// trigger — event-driven automations. Store in store.triggers[]:
//   { id, on, action, text, mention, title, by, lastFiredTs }
// 'on' is an event-type prefix; 'action' is 'post' (channel message) or 'task' (new task).
// We can't hook the event bus (no store.js edits), so 'check' polls: scan events with
// type startsWith(on) and ts>lastFiredTs, fire, then advance lastFiredTs. Idempotent.

export default {
  name: 'trigger',
  help: 'event automations: add / list / remove / check',
  commands: {
    add: {
      desc: "'trigger add --on task.status --action post --text \"...\" [--mention X] | --action task --title \"...\"'",
      run: async (args, ctx) => {
        const on = args.on;
        const action = args.action;
        if (!on) throw new Error('need --on <event.prefix>');
        if (action !== 'post' && action !== 'task') throw new Error("need --action post|task");
        if (action === 'post' && !args.text) throw new Error('post trigger needs --text "..."');
        if (action === 'task' && !args.title) throw new Error('task trigger needs --title "..."');
        const t = await withStore((store) => {
          const rec = {
            id: nextId(store, 'trigger'),
            on,
            action,
            text: args.text || null,
            mention: args.mention || null,
            title: args.title || null,
            by: args.by || 'system',
            lastFiredTs: Date.now(), // ponytail: only fire on events AFTER creation, not backfill history
          };
          store.triggers.push(rec);
          logEvent(store, 'trigger.add', rec.by, { id: rec.id, on, action });
          return rec;
        });
        ctx.print(`trigger #${t.id} on ${t.on} -> ${t.action}`);
      },
    },
    list: {
      desc: "'trigger list'",
      run: async (args, ctx) => {
        const rows = readStore().triggers;
        if (!rows.length) { ctx.print('(no triggers)'); return; }
        for (const t of rows) {
          const what = t.action === 'post'
            ? `post "${t.text}"${t.mention ? ` @${t.mention}` : ''}`
            : `task "${t.title}"`;
          ctx.print(`#${t.id} on ${t.on} -> ${what}`);
        }
      },
    },
    remove: {
      desc: "'trigger remove <id>'",
      run: async (args, ctx) => {
        const id = parseInt(args._[0], 10);
        if (!id) throw new Error('need <id>');
        const ok = await withStore((store) => {
          const i = store.triggers.findIndex(t => t.id === id);
          if (i < 0) return false;
          store.triggers.splice(i, 1);
          logEvent(store, 'trigger.remove', 'system', { id });
          return true;
        });
        if (!ok) throw new Error(`no trigger #${id}`);
        ctx.print(`removed trigger #${id}`);
      },
    },
    check: {
      desc: "'trigger check'",
      run: async (args, ctx) => {
        const fired = await withStore((store) => {
          const out = [];
          for (const t of store.triggers) {
            const matches = store.events.filter(e => e.type.startsWith(t.on) && e.ts > t.lastFiredTs);
            if (!matches.length) continue;
            for (const e of matches) {
              if (t.action === 'post') {
                store.messages.push({
                  id: nextId(store, 'message'),
                  from: `trigger#${t.id}`,
                  text: t.text,
                  mention: t.mention || null,
                  ts: Date.now(),
                  readBy: [],
                });
              } else { // task
                const now = Date.now();
                store.tasks.push({
                  id: nextId(store, 'task'),
                  title: t.title,
                  assignee: t.mention || null,
                  status: 'todo',
                  priority: 'normal',
                  dependsOn: [],
                  parentId: null,
                  acceptance: null,
                  createdBy: `trigger#${t.id}`,
                  createdAt: now,
                  updatedAt: now,
                });
              }
            }
            // advance to newest matched event so re-running check is idempotent
            t.lastFiredTs = matches[matches.length - 1].ts;
            logEvent(store, 'trigger.fire', 'system', { id: t.id, on: t.on, count: matches.length });
            out.push({ id: t.id, on: t.on, action: t.action, count: matches.length });
          }
          return out;
        });
        if (!fired.length) { ctx.print('nothing fired'); return; }
        for (const f of fired) ctx.print(`trigger #${f.id} (${f.on}) fired ${f.count} ${f.action}(s)`);
      },
    },
  },
};
