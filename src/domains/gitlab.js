import { spawn, spawnSync } from 'child_process';

// Is glab on PATH? (cached — with shell:true a missing binary won't emit ENOENT, so check up front.)
let _has = null;
function installed() {
  if (_has !== null) return _has;
  try { _has = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['glab'], { stdio: 'ignore' }).status === 0; }
  catch { _has = false; }
  return _has;
}

// Spawn `glab` with the given args, inherit stdio so output streams live.
// Shell-quote one arg so values with spaces / metacharacters survive shell:true.
function shq(s) {
  s = String(s);
  return process.platform === 'win32' ? `"${s.replace(/"/g, '""')}"` : `'${s.replace(/'/g, `'\\''`)}'`;
}

function run(glabArgs) {
  if (!installed()) {
    console.log('GitLab CLI not found — install from https://gitlab.com/gitlab-org/cli then run: glab auth login');
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    const p = spawn('glab ' + glabArgs.map(shq).join(' '), { shell: true, stdio: 'inherit' });
    p.on('error', (err) => { console.log('glab failed: ' + err.message); resolve(1); });
    p.on('close', (code) => resolve(code ?? 0));
  });
}

// Rebuild the flags the parser stripped off args (raw; run() quotes them).
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
  name: 'gitlab',
  help: 'Thin wrapper over the GitLab CLI (glab)',
  commands: {
    default: {
      desc: 'gitlab <any glab args...> — passthrough to glab',
      run: (a) => run([...a._, ...flagsOf(a)]),
    },
    status: {
      desc: 'gitlab status — glab auth status',
      run: () => run(['auth', 'status']),
    },
    mr: {
      desc: 'gitlab mr [list|view <n>|create ...] — pass through to glab mr',
      run: (a) => run(['mr', ...(a._.length ? a._ : ['list']), ...flagsOf(a)]),
    },
    issue: {
      desc: 'gitlab issue [list|...] — pass through to glab issue',
      run: (a) => run(['issue', ...(a._.length ? a._ : ['list']), ...flagsOf(a)]),
    },
  },
};
