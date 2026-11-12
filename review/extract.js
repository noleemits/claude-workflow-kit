#!/usr/bin/env node
// Turn raw transcripts into compact per-session digests
// for a workflow review. No model calls. Usage: node extract.js <sinceISO> <outDir>
const fs = require('fs');
const path = require('path');
const os = require('os');

const since = new Date(process.argv[2] || '2026-10-13');
const outDir = process.argv[3] || path.join(__dirname, 'digests');
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
fs.mkdirSync(outDir, { recursive: true });

const strip = s => String(s || '')
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  .replace(/<([a-z]+[_-][a-z_-]+)>[\s\S]*?<\/\1>/g, '')
  .trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n) + ` [...+${s.length - n}]` : s);
const resultText = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b.text || '').join(' ') : '';

const summary = [];
for (const proj of fs.readdirSync(PROJECTS)) {
  if (/bench-runs|scratch-workspaces/.test(proj)) continue;
  const pdir = path.join(PROJECTS, proj);
  if (!fs.statSync(pdir).isDirectory()) continue;
  for (const f of fs.readdirSync(pdir).filter(x => x.endsWith('.jsonl'))) {
    const fp = path.join(pdir, f);
    if (fs.statSync(fp).mtime < since) continue;
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    const s = { project: proj, session: f.replace('.jsonl', ''), prompts: [], errors: [], rejections: [],
      interrupts: 0, compactions: 0, tools: {}, peakCtx: 0, first: null, last: null, entry: null,
      gaps: [], hookBlocks: 0 };
    const toolNames = {};
    let lastUserTs = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.isSidechain) continue;
      if (e.entrypoint && !s.entry) s.entry = e.entrypoint;
      if (e.timestamp) { s.first = s.first || e.timestamp; s.last = e.timestamp; }
      if (e.isCompactSummary || e.type === 'summary') s.compactions++;
      if (e.attachment && /block/i.test(JSON.stringify(e.attachment.type || '')) ) s.hookBlocks++;
      const msg = e.message;
      if (e.type === 'assistant' && msg) {
        const u = msg.usage;
        if (u) s.peakCtx = Math.max(s.peakCtx, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0));
        for (const b of Array.isArray(msg.content) ? msg.content : []) {
          if (b.type === 'tool_use') {
            s.tools[b.name] = (s.tools[b.name] || 0) + 1;
            toolNames[b.id] = { name: b.name, input: clip(JSON.stringify(b.input || {}), 160) };
          }
        }
      }
      if (e.type === 'user' && msg) {
        const c = msg.content;
        if (typeof c === 'string' || (Array.isArray(c) && c.some(b => b.type === 'text'))) {
          const t = typeof c === 'string' ? strip(c) : c.filter(b => b.type === 'text').map(b => strip(b.text)).join('\n');
          if (/\[Request interrupted/.test(t)) { s.interrupts++; continue; }
          if (!t || e.isMeta || /^<command-|^Caveat:/.test(t)) continue;
          if (e.isCompactSummary) continue;
          const ts = e.timestamp;
          if (lastUserTs && ts) s.gaps.push(Math.round((new Date(ts) - new Date(lastUserTs)) / 60000));
          lastUserTs = ts;
          s.prompts.push(`[${(ts || '').slice(5, 16)}] ${clip(t.replace(/\s+/g, ' '), 700)}`);
        }
        for (const b of Array.isArray(c) ? c : []) {
          if (b.type !== 'tool_result') continue;
          const txt = resultText(b.content);
          const tool = toolNames[b.tool_use_id] || { name: '?', input: '' };
          if (/doesn't want to proceed|user rejected|was rejected|denied by|Permission .*denied/i.test(txt)) {
            s.rejections.push(`${tool.name} ${tool.input} => ${clip(txt.replace(/\s+/g, ' '), 250)}`);
          } else if (b.is_error) {
            s.errors.push(`${tool.name} ${tool.input} => ${clip(txt.replace(/\s+/g, ' '), 250)}`);
          }
        }
      }
    }
    if (!s.prompts.length) continue;
    const mins = s.first && s.last ? Math.round((new Date(s.last) - new Date(s.first)) / 60000) : 0;
    const toolCalls = Object.values(s.tools).reduce((a, b) => a + b, 0);
    const row = { project: proj, session: s.session, start: s.first, wallMin: mins, prompts: s.prompts.length,
      toolCalls, errors: s.errors.length, rejections: s.rejections.length, interrupts: s.interrupts,
      compactions: s.compactions, peakCtx: s.peakCtx, entry: s.entry };
    summary.push(row);
    const topTools = Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(', ');
    const out = [
      `# ${proj} / ${s.session}`,
      `start ${s.first} | wall ${mins} min | prompts ${s.prompts.length} | tool calls ${toolCalls} | errors ${s.errors.length} | rejections ${s.rejections.length} | interrupts ${s.interrupts} | compactions ${s.compactions} | peak ctx ${s.peakCtx} | ${s.entry}`,
      `minutes between prompts: ${s.gaps.join(',')}`,
      `top tools: ${topTools}`,
      '', '## User prompts', ...s.prompts,
      '', '## Rejected tool calls', ...s.rejections.slice(0, 30),
      '', '## Tool errors (first 40)', ...s.errors.slice(0, 40), '',
    ].join('\n');
    const pd = path.join(outDir, proj);
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, `${(s.first || '').slice(0, 10)}_${s.session.slice(0, 8)}.md`), out);
  }
}
summary.sort((a, b) => String(a.start).localeCompare(String(b.start)));
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
const tot = k => summary.reduce((a, r) => a + r[k], 0);
console.log(`sessions ${summary.length}, prompts ${tot('prompts')}, toolCalls ${tot('toolCalls')}, errors ${tot('errors')}, rejections ${tot('rejections')}, interrupts ${tot('interrupts')}, compactions ${tot('compactions')}`);
