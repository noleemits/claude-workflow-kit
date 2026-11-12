#!/usr/bin/env node
// Install the kit into ~/.claude: copies hooks and skills, registers the hooks in settings.json
// (a backup is written first), and drops an example config if you have none. Idempotent.
//
//   node install.js            install everything
//   node install.js --no-pain  skip the temporary pain: logger
//   node install.js --dry-run  show what would change, write nothing
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const NO_PAIN = args.includes('--no-pain');
const CLAUDE = path.join(os.homedir(), '.claude');
const HOOKS = path.join(CLAUDE, 'hooks');
const SKILLS = path.join(CLAUDE, 'skills');
const SRC = __dirname;
const log = (...a) => console.log(DRY ? '[dry-run]' : '', ...a);

function copy(from, to) {
  log('copy', path.relative(SRC, from), '->', to);
  if (DRY) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

for (const f of ['idle-guard.js', 'workflow-guards.js', ...(NO_PAIN ? [] : ['pain-log.js'])]) {
  copy(path.join(SRC, 'hooks', f), path.join(HOOKS, f));
}
for (const s of fs.readdirSync(path.join(SRC, 'skills'))) {
  const target = path.join(SKILLS, s, 'SKILL.md');
  if (fs.existsSync(target)) { log('skip skill (already exists):', s); continue; }
  copy(path.join(SRC, 'skills', s, 'SKILL.md'), target);
}
const cfg = path.join(CLAUDE, 'workflow-guards.config.json');
if (!fs.existsSync(cfg)) copy(path.join(SRC, 'examples', 'workflow-guards.config.json'), cfg);

const settingsFile = path.join(CLAUDE, 'settings.json');
const j = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
const hooksDir = HOOKS.replace(/\\/g, '/');
const cmd = (file, mode) => `node "${hooksDir}/${file}"${mode ? ' ' + mode : ''} || true`;
j.hooks = j.hooks || {};
const add = (ev, command, matcher) => {
  const list = (j.hooks[ev] = j.hooks[ev] || []);
  if (list.some(x => (x.hooks || []).some(h => h.command === command))) return;
  const entry = { hooks: [{ type: 'command', command, timeout: 20 }] };
  if (matcher) entry.matcher = matcher;
  list.push(entry);
  log('hook', ev, matcher || '', '->', command);
};
add('UserPromptSubmit', cmd('idle-guard.js'));
add('UserPromptSubmit', cmd('workflow-guards.js', 'prompt'));
if (!NO_PAIN) add('UserPromptSubmit', cmd('pain-log.js'));
add('PreToolUse', cmd('workflow-guards.js', 'pretool'), 'Bash|PowerShell|Grep|Glob');
add('PreCompact', cmd('workflow-guards.js', 'precompact'));
add('SessionStart', cmd('workflow-guards.js', 'aftercompact'), 'compact');
add('SessionStart', cmd('workflow-guards.js', 'inbox'), 'startup|resume|clear');

if (!DRY) {
  if (fs.existsSync(settingsFile)) {
    const bak = `${settingsFile}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(settingsFile, bak);
    console.log('backup:', bak);
  }
  fs.writeFileSync(settingsFile, JSON.stringify(j, null, 2) + '\n');
  JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
}
console.log('done. Edit', cfg, 'to set your release checks and inbox folder.');
