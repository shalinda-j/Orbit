// orbit plugin — copy-paste example
// ────────────────────────────────────────────────────────────────
// A plugin is a plain ESM module that exports register(api). orbit calls it
// once at startup for every entry in your config's `plugins` array. Install with:
//
//   orbit plugin add ./examples/orbit-plugin-example.js
//   (then restart orbit)
//
// The `api` handed to register() gives you five things:
//   api.addProvider(name, instance)      — a chat backend
//   api.addDomain({name, help, commands}) — new `orbit <domain> <action>` commands
//   api.addHook(event, async (ctx)=>{})   — 'session.start' | 'run.before' | 'run.after'
//   api.addSkill({name, description, instructions}) — a reusable instruction snippet
//   api.config                            — the loaded orbit config (read-only)
//   api.log(...)                          — namespaced logger, prints "  [plugin] ..."
// ────────────────────────────────────────────────────────────────

export function register(api) {
  // 1) A domain. Adds `orbit hello` / `orbit hello "Ada"`.
  //    A `default` command runs when no action is given.
  api.addDomain({
    name: 'hello',
    help: 'demo domain from the example plugin',
    commands: {
      default: {
        desc: 'greet: hello [name]',
        run: async (args, ctx) => {
          const who = args._[0] || 'world';
          ctx.print(`  👋 hello, ${who}!`);
        },
      },
    },
  });

  // 2) A hook. Fires after every run; log whatever the run passed us.
  api.addHook('run.after', async (ctx) => {
    api.log('run finished:', ctx?.task ?? ctx ?? '(no context)');
  });

  // 3) A skill — a named instruction snippet agents can pull in.
  api.addSkill({
    name: 'eli5',
    description: 'explain simply',
    instructions: 'Explain like I am 5, in 3 sentences.',
  });

  // 4) A provider (commented — needs a real endpoint + key). A provider is any
  //    object with { name, async chat({systemPrompt, messages, model}) } that
  //    returns { content, usage:{promptTokens,completionTokens,totalTokens} }.
  //    For an OpenAI-compatible endpoint, orbit already ships a wrapper:
  //
  //   import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.js';
  //   api.addProvider('mylab', new OpenAICompatibleProvider({
  //     name: 'mylab',
  //     baseUrl: 'https://api.example.com/v1',
  //     apiKey: process.env.MYLAB_API_KEY || '',
  //     defaultModel: 'gpt-4o-mini',
  //   }));
  //
  //    Or hand-roll one (no deps) — fetch is global in modern Node:
  //
  //   api.addProvider('echo', {
  //     name: 'echo',
  //     async chat({ messages }) {
  //       const content = messages.at(-1)?.content ?? '';
  //       return { content, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  //     },
  //   });

  api.log('example plugin loaded: domain "hello", hook run.after, skill "eli5"');
}

// Export both styles so `import x` and `import { register }` both work.
export default { register };
