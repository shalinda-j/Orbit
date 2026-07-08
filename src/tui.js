import chalk from 'chalk';
import { readFileSync } from 'fs';

// Single source of truth for the version — read from package.json (no hardcoded string to drift).
export const VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; }
  catch { return '0.0.0'; }
})();

// ─────────────────────────────────────────────
// Color Palette (Claude Code-inspired dark theme)
// ─────────────────────────────────────────────
export const COLORS = {
  primary:    chalk.hex('#A78BFA'),   // Soft violet (brand)
  secondary:  chalk.hex('#67E8F9'),   // Cyan accent
  success:    chalk.hex('#34D399'),   // Emerald green
  warning:    chalk.hex('#FBBF24'),   // Amber
  error:      chalk.hex('#F87171'),   // Soft red
  muted:      chalk.hex('#6B7280'),   // Gray-500
  dim:        chalk.hex('#4B5563'),   // Gray-600
  text:       chalk.hex('#D1D5DB'),   // Gray-300
  bright:     chalk.hex('#F3F4F6'),   // Gray-100
  white:      chalk.hex('#FFFFFF'),   // Pure white

  agent1:     chalk.hex('#818CF8'),   // Indigo
  agent2:     chalk.hex('#34D399'),   // Emerald
  agent3:     chalk.hex('#F472B6'),   // Pink
  agent4:     chalk.hex('#FBBF24'),   // Amber
  agent5:     chalk.hex('#67E8F9'),   // Cyan

  icon:       chalk.hex('#C084FC'),   // Purple-400 for the icon
  iconDark:   chalk.hex('#7C3AED'),   // Purple-600
};

const AGENT_COLORS = [COLORS.agent1, COLORS.agent2, COLORS.agent3, COLORS.agent4, COLORS.agent5];
const agentColorMap = new Map();

export function getAgentColor(agentName) {
  if (agentName === 'System') return COLORS.warning;
  if (agentName === 'Supervisor') return COLORS.muted;
  if (agentName === 'Synthesizer') return COLORS.secondary;
  if (!agentColorMap.has(agentName)) {
    agentColorMap.set(agentName, AGENT_COLORS[agentColorMap.size % AGENT_COLORS.length]);
  }
  return agentColorMap.get(agentName);
}

// ─────────────────────────────────────────────
// Terminal Utilities
// ─────────────────────────────────────────────
export function clearScreen() {
  process.stdout.write('\x1B[2J\x1B[H');
}

export function clearLine() {
  process.stdout.write('\x1B[2K\r');
}

// Big block "ORBIT" wordmark, gradient: deep-purple → cyan → white.
function getWordmark() {
  const L = {
    O: ['██████', '██  ██', '██  ██', '██  ██', '██████'],
    R: ['█████ ', '██  ██', '█████ ', '██ ██ ', '██  ██'],
    B: ['█████ ', '██  ██', '█████ ', '██  ██', '█████ '],
    I: ['██████', '  ██  ', '  ██  ', '  ██  ', '██████'],
    T: ['██████', '  ██  ', '  ██  ', '  ██  ', '  ██  '],
  };
  const word = ['O', 'R', 'B', 'I', 'T'];
  const ramp = [COLORS.iconDark, COLORS.icon, COLORS.primary, COLORS.secondary, COLORS.white];
  const rows = [];
  for (let r = 0; r < 5; r++) rows.push(word.map((ch, i) => ramp[i].bold(L[ch][r])).join(' '));
  return rows; // 34 visible cols each
}

// Left padding to centre a block of known visible width in the terminal.
function center(cols, visible) {
  return ' '.repeat(Math.max(2, Math.floor((cols - visible) / 2)));
}

// Color for the current mode (shared by banner, status bar, and prompt).
export function modeColor(mode) {
  return mode === 'chat' ? COLORS.secondary
    : mode === 'plan' ? COLORS.warning
    : COLORS.success; // build
}

// ─────────────────────────────────────────────
// Banner (flat, no boxes)
// ─────────────────────────────────────────────
export function renderBanner(providerStatuses, cwd, state = {}) {
  const { mode = 'build', permissions = 'safe', style = 'collaborative', turns = 6, lazy = false } = state;
  const cols = process.stdout.columns || 80;
  const wm = getWordmark();   // 34 visible cols
  const lines = [''];

  // Big ORBIT wordmark, centred.
  const wmPad = center(cols, 34);
  for (const row of wm) lines.push(wmPad + row);

  lines.push('');
  const tag = `Multi-Agent Team · Multi-Provider · v${VERSION}`;
  lines.push(center(cols, tag.length) + COLORS.muted(tag));
  const dir = cwd || process.cwd();
  lines.push(center(cols, dir.length) + COLORS.dim(dir));
  lines.push('');

  // Show connected providers in full; collapse the rest to a "+N more" hint (there are many presets).
  const connected = providerStatuses.filter(p => p.configured);
  const moreCount = providerStatuses.length - connected.length;
  const connectedText = connected.length
    ? connected.map(p => COLORS.success('●') + ' ' + COLORS.text(p.name)).join(COLORS.dim(' · '))
    : COLORS.dim('none');
  const moreText = moreCount ? COLORS.dim(`   · +${moreCount} available → `) + COLORS.secondary('/connect') : '';
  lines.push(COLORS.dim('  │ ') + COLORS.muted('Providers ') + connectedText + moreText);

  const mc = modeColor(mode);
  lines.push(
    COLORS.dim('  ├ ') +
    COLORS.muted('Mode ') + mc.bold(mode) +
    COLORS.dim(' · ') + COLORS.muted('Perms ') + (permissions === 'auto' ? COLORS.warning('auto') : COLORS.text('safe')) +
    COLORS.dim(' · ') + COLORS.muted('Style ') + COLORS.text(style) +
    COLORS.dim(' · ') + COLORS.muted('Turns ') + COLORS.text(String(turns)) +
    (lazy ? COLORS.dim(' · ') + COLORS.success('⚡ lazy') : '')
  );
  lines.push(COLORS.dim('  └ ') + COLORS.muted('Team ') + COLORS.bright('Dynamic (generated per task)'));

  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Agent Response (Claude Code flat style)
// ─────────────────────────────────────────────
// The [FINISHED] tag is an internal control token — never show it to the user.
function stripControlTags(text) {
  return String(text).replace(/\s*\[FINISHED\]\s*/g, ' ').trim();
}

export function renderAgentResponse(agentName, model, content, usage = null) {
  const color = getAgentColor(agentName);
  content = stripControlTags(content);
  const lines = [];

  // Agent header line
  let header = '  ' + color.bold(agentName);
  if (model) header += COLORS.dim(` (${model})`);
  if (usage && (usage.promptTokens || usage.completionTokens)) {
    header += COLORS.dim(`  ${usage.promptTokens}→${usage.completionTokens} tokens`);
  }
  lines.push(header);

  // Content with tree-style left border
  const formatted = formatMarkdownTerminal(content);
  const contentLines = formatted.split('\n');
  for (let i = 0; i < contentLines.length; i++) {
    const isLast = i === contentLines.length - 1;
    const prefix = isLast ? COLORS.dim('  └ ') : COLORS.dim('  │ ');
    lines.push(prefix + contentLines[i]);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────
// System Message (tree-style, minimal)
// ─────────────────────────────────────────────
export function renderSystemMessage(text) {
  return COLORS.dim('  │ ') + COLORS.warning(text);
}

// ─────────────────────────────────────────────
// Prompt — shows the active mode, like Claude Code
// ─────────────────────────────────────────────
export function renderPrompt(mode = 'build') {
  return modeColor(mode).bold(mode) + COLORS.dim(' › ');
}

// ─────────────────────────────────────────────
// Status Bar (bottom hints)
// ─────────────────────────────────────────────
export function renderStatusBar() {
  return COLORS.dim('  type / for commands (Tab to complete)') + COLORS.dim(' · ') +
    COLORS.dim('/mode') + COLORS.dim(' · ') + COLORS.dim('/lazy') + COLORS.dim(' · ') +
    COLORS.dim('/help') + COLORS.dim(' · ') + COLORS.dim('/exit');
}

// ─────────────────────────────────────────────
// Markdown-ish Terminal Formatting
// ─────────────────────────────────────────────
function formatMarkdownTerminal(text) {
  let result = text;

  // Code blocks
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const header = lang ? COLORS.dim(`  ${lang}`) : '';
    const codeLines = code.split('\n').map(l => COLORS.secondary('  ' + l)).join('\n');
    return (header ? header + '\n' : '') + codeLines;
  });

  // Inline code
  result = result.replace(/`([^`]+)`/g, (_, code) => COLORS.secondary(code));

  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, bold) => chalk.bold(bold));

  // Headers
  result = result.replace(/^### (.+)$/gm, (_, h) => chalk.bold(h));
  result = result.replace(/^## (.+)$/gm, (_, h) => chalk.bold.underline(h));
  result = result.replace(/^# (.+)$/gm, (_, h) => COLORS.primary.bold(h));

  // Bullets
  result = result.replace(/^(\s*)[-*] /gm, '$1• ');

  return result;
}

// ─────────────────────────────────────────────
// Help (Claude Code flat tree style)
// ─────────────────────────────────────────────
export function renderHelp() {
  const row = (k, v) => COLORS.dim('  │ ') + COLORS.primary(k.padEnd(22)) + COLORS.text(v);
  const lines = [
    '',
    COLORS.bright.bold('  Session'),
    COLORS.dim('  │'),
    row('/help', 'Show this help'),
    row('/mode', 'Cycle mode: chat → plan → build'),
    row('/chat /plan /build', 'Set mode directly'),
    row('/skip', 'Toggle permissions: safe ↔ auto'),
    row('/style', 'Toggle collaborative ↔ sequential'),
    row('/lazy', 'Toggle lazy mode — fewest agents, terse, fewer tokens'),
    row('/tokens N', 'Cap output tokens per turn'),
    row('/turns N', 'Set max collaboration turns'),
    row('/model [name]', 'View or set the NVIDIA model'),
    row('/clear', 'Clear the screen'),
    row('/exit', 'Exit Orbit'),
    '',
    COLORS.bright.bold('  Team & Brain') + COLORS.dim('  (same as `orbit <cmd>` in any terminal)'),
    COLORS.dim('  │'),
    row('/board', 'Show the task board'),
    row('/team', 'Show the roster'),
    row('/brain', 'Recent brain notes'),
    row('/task add "…"', 'Add a task  (--by me)'),
    row('/brain save "t" "…"', 'Save a knowledge note'),
    row('/msg post "…"', 'Post to the channel  (--from me)'),
    row('/spawn new --role X', 'Bring in an external CLI agent'),
    COLORS.dim('  └ ') + COLORS.muted('also: debate · finding · approval · metrics · template · backup · trigger · dashboard · orchestrate'),
    '',
    COLORS.dim('  ') + COLORS.muted('Type a task with no slash to run the multi-agent team.'),
    '',
  ];
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Agent List (flat tree style)
// ─────────────────────────────────────────────
export function renderAgentList(agents) {
  const lines = [];
  lines.push('');
  lines.push(COLORS.bright.bold('  Active Agents'));
  lines.push(COLORS.dim('  │'));

  if (!agents || agents.length === 0) {
    lines.push(COLORS.dim('  └ ') + COLORS.text('Dynamic Team (Generated on-demand per task)'));
  } else {
    agents.forEach((a, i) => {
      const color = getAgentColor(a.name);
      const isLast = i === agents.length - 1;
      const branch = isLast ? '  └ ' : '  ├ ';
      const cont   = isLast ? '    ' : '  │ ';

      lines.push(COLORS.dim(branch) + color.bold(a.name) + COLORS.dim(` · ${a.role}`));
      lines.push(COLORS.dim(cont) + COLORS.muted(`  ${a.providerName}`) + COLORS.dim(' / ') + COLORS.text(a.model || 'default'));
    });
  }

  lines.push('');
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Spinner (minimal, Claude Code style)
// ─────────────────────────────────────────────
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  constructor() {
    this.frameIndex = 0;
    this.interval = null;
    this.text = '';
  }

  start(text = 'Thinking') {
    this.text = text;
    this.frameIndex = 0;
    this.interval = setInterval(() => {
      clearLine();
      const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
      process.stdout.write(COLORS.primary(`  ${frame} `) + COLORS.muted(this.text));
      this.frameIndex++;
    }, 80);
  }

  update(text) {
    this.text = text;
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      clearLine();
    }
  }
}

// ─────────────────────────────────────────────
// Token Summary — compact one-liner (+ per-agent breakdown)
// ─────────────────────────────────────────────
export function renderTokenSummary(tokenStats, opts = {}) {
  const { subscription = false } = opts;
  const t = tokenStats;

  // Under a subscription there is no per-token dollar cost — don't invent one.
  const cost = subscription
    ? COLORS.secondary('subscription · no API cost')
    : COLORS.success('~$' + (((t.promptTokens / 1e6) * 1.5) + ((t.completionTokens / 1e6) * 6)).toFixed(4));

  const head = '  ' +
    COLORS.muted('↑ ') + COLORS.text(t.promptTokens.toLocaleString()) + '   ' +
    COLORS.muted('↓ ') + COLORS.text(t.completionTokens.toLocaleString()) + '   ' +
    COLORS.muted('Σ ') + COLORS.bright.bold(t.totalTokens.toLocaleString()) +
    COLORS.dim('   ·   ') + cost;

  const lines = ['', head];
  const entries = Object.entries(t.breakdown || {});
  if (entries.length) {
    const parts = entries.map(([name, s]) => getAgentColor(name)(name) + COLORS.dim(` ${s.promptTokens}→${s.completionTokens}`));
    lines.push(COLORS.dim('  ') + parts.join(COLORS.dim('  ·  ')));
  }
  lines.push('');
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Final Result Block
// ─────────────────────────────────────────────
export function renderFinalResult(content) {
  content = stripControlTags(content);
  const lines = [];
  lines.push('');
  lines.push('  ' + COLORS.success.bold('✦ Final Result'));
  const contentLines = content.split('\n');
  for (let i = 0; i < contentLines.length; i++) {
    const isLast = i === contentLines.length - 1;
    const prefix = isLast ? COLORS.success('  └ ') : COLORS.success('  │ ');
    lines.push(prefix + formatMarkdownTerminal(contentLines[i]));
  }
  lines.push('');
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Task Header
// ─────────────────────────────────────────────
export function renderTaskHeader(taskNum, task) {
  const lines = [];
  lines.push('');
  lines.push(COLORS.dim(`  ── Task #${taskNum} ──`));
  lines.push(COLORS.dim('  │ ') + COLORS.bright(task));
  lines.push(COLORS.dim('  └'));
  lines.push('');
  return lines.join('\n');
}
