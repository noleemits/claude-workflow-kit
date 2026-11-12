#!/usr/bin/env node
// pain: logger (UserPromptSubmit hook). A prompt starting with "pain:" is appended to
// ~/.claude/workflow-review/pain-log.md and BLOCKED, so it never reaches the model: no tokens, no
// derailed chat. Use it for a few days while you review your workflow, then remove it.

const fs = require('fs');
const path = require('path');
const os = require('os');

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const prompt = String(input.prompt || '');
  const m = prompt.match(/^\s*pain\s*:\s*([\s\S]+)/i);
  if (!m) return;

  const dir = path.join(os.homedir(), '.claude', 'workflow-review');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const note = m[1].trim().replace(/\r?\n/g, ' ');
  const line = `- ${stamp} | ${input.cwd || '?'} | session ${input.session_id || '?'} | ${note}\n`;
  fs.appendFileSync(path.join(dir, 'pain-log.md'), line, 'utf8');

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: 'Logged to the workflow review pain log. Not sent to the chat, so carry on.',
  }));
});
