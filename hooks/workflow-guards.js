#!/usr/bin/env node
// Workflow guards for Claude Code. One file, one mode per hook event:
//
//   prompt        UserPromptSubmit  remember the latest prompt (for the release guard); once a tab passes
//                                   a context size (default 300k, then every +150k), ask Claude to suggest /handoff.
//   pretool       PreToolUse        (a) block a release command unless the user's latest prompt asked for one,
//                                       and check the folder holds the project that script releases;
//                                   (b) refuse Grep/Glob over huge roots (home, Documents, drive root): they time out.
//   precompact    PreCompact        write a digest of the session before compaction (no model call).
//   aftercompact  SessionStart      tell Claude where that digest is, and to re-read HANDOFF.md.
//   inbox         SessionStart      in a project's workspace, list items waiting in its inbox folder.
//
// Config: ~/.claude/workflow-guards.config.json (see examples/workflow-guards.config.json). Everything
// fails OPEN: an error in this file must never block your work.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const MODE = process.argv[2];
const HOME = os.homedir();
const STATE = path.join(HOME, '.claude', 'hooks', 'state');

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function expand(p) { return String(p || '').replace(/^~(?=$|[\\/])/, HOME); }

const DEFAULTS = {
  nudgeAt: 300000,
  nudgeStep: 150000,
  blockedSearchRoots: ['~', '~/Documents', '~/AppData', 'C:\\', 'C:', 'D:\\', 'D:', '/'],
  release: {
    commandPattern: '\\bgh\\s+release\\s+create\\b|\\bnpm\\s+publish\\b',
    askedPattern: '\\b(release|ship|publish|go live|deploy)\\b',
    notYetPattern: "\\b(don'?t|do not|not yet|no|hold|wait)\\b[^.!?\\n]{0,30}\\b(release|ship|publish|deploy)",
    folderChecks: [],
  },
  inboxRoot: '~/Documents/plugin-inbox',
};
const CFG = (() => {
  const user = readJson(path.join(HOME, '.claude', 'workflow-guards.config.json'), {});
  return { ...DEFAULTS, ...user, release: { ...DEFAULTS.release, ...(user.release || {}) } };
})();

function stateFile(id) { return path.join(STATE, `${String(id || 'x').replace(/[^\w-]/g, '')}.json`); }
function out(obj) { process.stdout.write(JSON.stringify(obj)); }

function lastContext(tp) {
  // Read only the tail of the transcript: the last assistant usage is near the end.
  const st = fs.statSync(tp);
  const len = Math.min(st.size, 2_000_000);
  const fd = fs.openSync(tp, 'r');
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, st.size - len);
  fs.closeSync(fd);
  for (const l of buf.toString('utf8').split('\n').reverse()) {
    if (!l.includes('"usage"')) continue;
    try {
      const e = JSON.parse(l);
      if (e.isSidechain) continue;
      const u = e.message && e.message.usage;
      if (u) return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    } catch { /* partial first line */ }
  }
  return 0;
}

function onPrompt(h) {
  fs.mkdirSync(STATE, { recursive: true });
  const sf = stateFile(h.session_id);
  const s = readJson(sf, {});
  s.lastPrompt = String(h.prompt || '').slice(0, 4000);
  s.lastPromptAt = Date.now();
  let ctx = 0;
  try { if (h.transcript_path) ctx = lastContext(h.transcript_path); } catch { /* ignore */ }
  let note = null;
  if (ctx >= (s.nextNudge || CFG.nudgeAt)) {
    s.nextNudge = ctx + CFG.nudgeStep;
    note = `This tab is at about ${Math.round(ctx / 1000)}k tokens of context. After answering, add ONE short line ` +
      `suggesting the user run /handoff here and continue in a fresh tab with /pickup (skip it if the work is about to finish).`;
  }
  fs.writeFileSync(sf, JSON.stringify(s));
  if (note) out({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: note } });
}

function deny(reason) {
  out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

function onPreTool(h) {
  const tool = h.tool_name || '';
  const inp = h.tool_input || {};

  if (tool === 'Grep' || tool === 'Glob') {
    const norm = p => path.resolve(expand(p)).replace(/[\\/]+$/, '').toLowerCase();
    const target = norm(inp.path || h.cwd || '.');
    if (CFG.blockedSearchRoots.map(norm).includes(target)) {
      deny(`Searching ${inp.path || h.cwd} would scan a huge tree and time out. Search the specific project folder instead.`);
    }
    return;
  }

  if (tool !== 'Bash' && tool !== 'PowerShell') return;
  const cmd = String(inp.command || '');
  const checks = CFG.release.folderChecks || [];
  const patterns = [CFG.release.commandPattern, ...checks.map(c => c.commandPattern)].filter(Boolean);
  if (!patterns.some(p => new RegExp(p, 'i').test(cmd))) return;

  const asked = readJson(stateFile(h.session_id), {}).lastPrompt || '';
  if (!new RegExp(CFG.release.askedPattern, 'i').test(asked) || new RegExp(CFG.release.notYetPattern, 'i').test(asked)) {
    deny('Release blocked: the user\'s latest message does not ask for a release (or says not yet). ' +
      'Stop and ask "Release now?" with the version number. Builds and dry runs are fine.');
    return;
  }

  // A release script releases whatever folder it sits in. Check the folder holds the project it names.
  for (const c of checks) {
    if (!new RegExp(c.commandPattern, 'i').test(cmd)) continue;
    const m = cmd.match(/([A-Za-z]:[\\/][^"'\n;|&]*?|\/[^"'\n;|&]*?)[\\/][\w.-]+\.(?:ps1|sh|js|py)\b/) ||
      cmd.match(/Set-Location\s+["']?([^"';\n]+?)["']?\s*[;\n]/i) || cmd.match(/\bcd\s+["']?([^"';&\n]+?)["']?\s*(?:&&|;|\n)/i);
    const dir = m ? m[1] : h.cwd;
    const main = path.join(dir, c.mainFile);
    try {
      if (!new RegExp(c.mustContain, 'i').test(fs.readFileSync(main, 'utf8').slice(0, 4000))) {
        deny(`Release blocked: ${main} does not match /${c.mustContain}/. The folder may hold a different project.`);
      }
    } catch {
      deny(`Release blocked: ${main} not found, so this folder may not be the project this script releases.`);
    }
    return;
  }
}

function onPreCompact(h) {
  try {
    const r = execFileSync('node', [path.join(__dirname, 'idle-guard.js'), '--digest', h.cwd || process.cwd()],
      { encoding: 'utf8', timeout: 20000 });
    fs.mkdirSync(STATE, { recursive: true });
    const sf = stateFile(h.session_id);
    const s = readJson(sf, {});
    s.compactDigest = r.split('\t')[0].trim();
    fs.writeFileSync(sf, JSON.stringify(s));
  } catch { /* never block a compaction */ }
}

function onAfterCompact(h) {
  const s = readJson(stateFile(h.session_id), {});
  const lines = [];
  if (s.compactDigest) lines.push(`Before this compaction, a digest of the session (the user's asks and the last turns, verbatim) was saved at ${s.compactDigest}. Read it if the summary is missing a detail you need.`);
  let dir = h.cwd || '';
  for (let i = 0; i < 3 && dir; i++) {
    const f = path.join(dir, 'HANDOFF.md');
    if (fs.existsSync(f)) { lines.push(`This folder has a handoff file at ${f}. Re-read it before continuing.`); break; }
    const up = path.dirname(dir); if (up === dir) break; dir = up;
  }
  if (lines.length) out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } });
}

function onInbox(h) {
  const root = expand(CFG.inboxRoot);
  const map = readJson(path.join(root, 'plugins.json'), { plugins: [] });
  const cwd = path.resolve(String(h.cwd || '')).toLowerCase();
  const p = map.plugins.find(x => (x.workspaces || []).some(w => cwd.startsWith(path.resolve(expand(w)).toLowerCase())));
  if (!p) return;
  const list = d => { try { return fs.readdirSync(path.join(root, p.slug, d)).filter(f => f.endsWith('.md')); } catch { return []; } };
  const fresh = list('new');
  const waiting = list('needs-you');
  if (!fresh.length && !waiting.length) return;
  const lines = [`Inbox for ${p.name} (${path.join(root, p.slug)}): ${fresh.length} new, ${waiting.length} waiting on the user.`];
  if (fresh.length) lines.push('New: ' + fresh.slice(0, 8).map(f => f.replace(/\.md$/, '')).join('; '));
  lines.push('Mention this to the user in one line at your first reply. Triage with the plugin-inbox skill when they say "check the inbox".');
  out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } });
}

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let h; try { h = JSON.parse(raw || '{}'); } catch { return; }
  try {
    if (MODE === 'prompt') onPrompt(h);
    else if (MODE === 'pretool') onPreTool(h);
    else if (MODE === 'precompact') onPreCompact(h);
    else if (MODE === 'aftercompact') onAfterCompact(h);
    else if (MODE === 'inbox') onInbox(h);
  } catch { /* fail open */ }
});
