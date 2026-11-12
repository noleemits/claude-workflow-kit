#!/usr/bin/env node
// Idle-tab guard + zero-token handoff digest (UserPromptSubmit hook).
// WHY: a tab left idle past the prompt-cache TTL (1h on many plans) re-reads the WHOLE conversation on
// the next message, often 200k to 300k tokens. This hook stops that message before it costs anything,
// writes a compact digest of the session to disk (a script, no model call), and suggests opening a
// fresh tab and running /pickup, which reads the digest (~5-10k tokens) instead.
//
// Modes:
//   hook:  node idle-guard.js            (UserPromptSubmit; hook JSON on stdin)
//   cli:   node idle-guard.js --digest <cwd> [--exclude <sessionId>]
//          writes a digest of the newest session for <cwd> and prints its path.
//
// Override: if a message is blocked, sending again within 10 minutes goes through.

const fs = require('fs');
const path = require('path');
const os = require('os');

const IDLE_MIN = 60;          // prompt cache TTL (1h on many plans)
const MIN_CTX = 80000;        // below this, re-caching is cheap enough to just continue
const OVERRIDE_MIN = 10;
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');

function slugFor(cwd) { return cwd.replace(/[^A-Za-z0-9]/g, '-'); }

function readLines(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial line */ }
  }
  return out;
}

function stripNoise(s) {
  return s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    // harness-injected blocks (browser_instruction, ide_selection, command-name, ...): tags with _ or -
    .replace(/<([a-z]+[_-][a-z_-]+)>[\s\S]*?<\/\1>/g, '')
    .trim();
}

function textOf(content, role) {
  if (typeof content === 'string') return stripNoise(content);
  if (!Array.isArray(content)) return '';
  return content.filter(b => b.type === 'text').map(b => stripNoise(b.text || '')).filter(Boolean).join('\n\n');
}

function clip(s, n) { return s.length > n ? s.slice(0, n) + `\n[... ${s.length - n} more chars cut]` : s; }

function stats(entries) {
  let lastTs = null, ctx = 0;
  for (const e of entries) {
    if ((e.type === 'user' || e.type === 'assistant') && e.timestamp) lastTs = e.timestamp;
    if (e.type === 'assistant' && e.message && e.message.usage && !e.isSidechain) {
      const u = e.message.usage;
      ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    }
  }
  return { lastTs, ctx };
}

function buildDigest(file) {
  const entries = readLines(file);
  const { lastTs, ctx } = stats(entries);
  let title = '', cwd = '', branch = '', sessionId = path.basename(file, '.jsonl');
  const turns = [];
  const files = new Set();
  for (const e of entries) {
    if (e.type === 'ai-title' && e.aiTitle) title = e.aiTitle;
    if (e.cwd) cwd = e.cwd;
    if (e.gitBranch) branch = e.gitBranch;
    if (e.isSidechain || !e.message) continue;
    if (e.type === 'user' && !e.isMeta) {
      const t = textOf(e.message.content, 'user');
      if (t) turns.push({ role: 'User', t, ts: e.timestamp });
    } else if (e.type === 'assistant') {
      const c = e.message.content;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === 'tool_use' && b.input && b.input.file_path && /^(Edit|Write|NotebookEdit)$/.test(b.name)) files.add(b.input.file_path);
        }
      }
      const t = textOf(c, 'assistant');
      if (t) turns.push({ role: 'Claude', t, ts: e.timestamp });
    }
  }
  const first = turns.find(x => x.role === 'User');
  const tail = [];
  let budget = 36000;
  for (let i = turns.length - 1; i >= 0 && budget > 0; i--) {
    const x = turns[i];
    const body = clip(x.t, x.role === 'User' ? 2500 : 4000);
    budget -= body.length;
    tail.unshift(`### ${x.role} (${(x.ts || '').slice(0, 16).replace('T', ' ')} UTC)\n\n${body}`);
    if (tail.length >= 24) break;
  }
  const md = [
    `# Handoff: ${title || sessionId}`,
    '',
    `- Session: \`${sessionId}\` (resume the full thing with \`claude --resume ${sessionId}\` only if the digest is not enough)`,
    `- Folder: \`${cwd}\`  Branch: \`${branch || 'n/a'}\``,
    `- Last activity: ${lastTs || 'unknown'}  Context at the end: ~${Math.round(ctx / 1000)}k tokens`,
    '',
    '## Original ask',
    '',
    first ? clip(first.t, 3000) : '(none found)',
    '',
    '## Files edited in that session',
    '',
    files.size ? [...files].map(f => `- \`${f}\``).join('\n') : '- none',
    '',
    '## Last turns (tool output left out)',
    '',
    tail.join('\n\n'),
    '',
  ].join('\n');
  const dir = path.join(path.dirname(file), 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  const day = (lastTs || new Date().toISOString()).slice(0, 10);
  const out = path.join(dir, `${day}-${sessionId.slice(0, 8)}.md`);
  fs.writeFileSync(out, md, 'utf8');
  return { out, ctx, lastTs, title };
}

function cli(args) {
  const cwd = args[args.indexOf('--digest') + 1] || process.cwd();
  const ex = args.includes('--exclude') ? args[args.indexOf('--exclude') + 1] : null;
  const dir = path.join(PROJECTS, slugFor(cwd));
  if (!fs.existsSync(dir)) { console.error(`No sessions for ${cwd} (looked in ${dir})`); process.exit(2); }
  const list = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!ex || !f.startsWith(ex)))
    .map(f => ({ f: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  const n = args.includes('--list') ? 8 : 1;
  for (const { f } of list.slice(0, n)) {
    const r = buildDigest(f);
    console.log(`${r.out}\t~${Math.round(r.ctx / 1000)}k\t${r.lastTs}\t${r.title}`);
  }
}

function hook() {
  let raw = '';
  process.stdin.on('data', d => raw += d);
  process.stdin.on('end', () => {
    try {
      const h = JSON.parse(raw || '{}');
      const tp = h.transcript_path;
      if (!tp || !fs.existsSync(tp)) return;
      const { lastTs, ctx } = stats(readLines(tp));
      if (!lastTs) return;
      const idleMin = (Date.now() - Date.parse(lastTs)) / 60000;
      if (idleMin < IDLE_MIN || ctx < MIN_CTX) return;
      const marker = path.join(os.tmpdir(), `cc-idle-guard-${h.session_id}`);
      if (fs.existsSync(marker) && (Date.now() - fs.statSync(marker).mtimeMs) / 60000 < OVERRIDE_MIN) {
        fs.unlinkSync(marker);
        return; // second send: he chose to continue here
      }
      const r = buildDigest(tp);
      fs.writeFileSync(marker, String(Date.now()));
      const idle = idleMin >= 1440 ? `${(idleMin / 1440).toFixed(1)} days` : `${(idleMin / 60).toFixed(1)} h`;
      const reason =
        `Paused: this tab has been idle ${idle} and holds ~${Math.round(ctx / 1000)}k tokens. ` +
        `Sending here would re-read all of it.\n` +
        `Cheaper: open a NEW Claude tab in this same folder and type /pickup (reads a ~5-10k digest).\n` +
        `Digest saved: ${r.out}\n` +
        `To continue in this tab anyway, send your message again within ${OVERRIDE_MIN} minutes.`;
      process.stdout.write(JSON.stringify({ decision: 'block', reason }));
    } catch (err) {
      // never break a prompt because of this guard
    }
  });
}

if (process.argv.includes('--digest')) cli(process.argv.slice(2)); else hook();
