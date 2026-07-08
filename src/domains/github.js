import { spawn, spawnSync } from 'child_process';

// Is gh on PATH? (cached — with shell:true a missing binary won't emit ENOENT, so check up front.)
let _has = null;
function installed() {
  if (_has !== null) return _has;
  try { _has = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['gh'], { stdio: 'ignore' }).status === 0; }
  catch { _has = false; }
  return _has;
}

// Spawn `gh` with the given args, inherit stdio so output streams live.
function run(ghArgs) {
  if (!installed()) {
    console.log('GitHub CLI not found — install from https://cli.github.com then run: gh auth login');
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    const p = spawn('gh', ghArgs, { shell: true, stdio: 'inherit' });
    let missing = false;
    p.on('error', (err) => {
      if (err.code === 'ENOENT') {
        missing = true;
        console.log('GitHub CLI not found — install from https://cli.github.com then run: gh auth login');
      } else {
        console.log('gh failed: ' + err.message);
      }
      resolve(1);
    });
    p.on('close', (code) => { if (!missing) resolve(code ?? 0); });
  });
}

// Rebuild the flags the parser stripped off args, so passthrough keeps them.
// ponytail: values are re-quoted naively; fine for gh's typical flag shapes.
function flagsOf(a) {
  const out = [];
  for (const [k, v] of Object.entries(a)) {
    if (k === '_') continue;
    if (v === true) out.push('--' + k);
    else out.push('--' + k, String(v));
  }
  return out;
}

export default {
  name: 'github',
  help: 'Thin wrapper over the GitHub CLI (gh)',
  commands: {
    default: {
      desc: 'github <any gh args...> — passthrough to gh',
      run: (a) => run([...a._, ...flagsOf(a)]),
    },
    status: {
      desc: 'github status — gh auth status + current repo url',
      run: async () => {
        await run(['auth', 'status']);
        await run(['repo', 'view', '--json', 'name,url', '-q', '.url']);
      },
    },
    pr: {
      desc: 'github pr [list|view <n>|create ...] — pass through to gh pr',
      run: (a) => run(['pr', ...(a._.length ? [...a._, ...flagsOf(a)] : ['list'])]),
    },
    issue: {
      desc: 'github issue [list|...] — pass through to gh issue',
      run: (a) => run(['issue', ...(a._.length ? [...a._, ...flagsOf(a)] : ['list'])]),
    },
  },
};
