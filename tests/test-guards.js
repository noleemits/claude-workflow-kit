// Tests for hooks/workflow-guards.js and hooks/pain-log.js. Run: node tests/test-guards.js
// Uses a temporary HOME so your real ~/.claude is never touched.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const G = path.join(ROOT, 'hooks', 'workflow-guards.js');
const P = path.join(ROOT, 'hooks', 'pain-log.js');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cwk-'));
const env = { ...process.env, HOME, USERPROFILE: HOME };
const run = (file, mode, obj) => execFileSync('node', [file, ...(mode ? [mode] : [])], { input: JSON.stringify(obj), encoding: 'utf8', env });
const dec = s => (s ? (JSON.parse(s).hookSpecificOutput?.permissionDecision || JSON.parse(s).decision || 'ctx') : 'allow');

// A fake project with a release script check.
const proj = path.join(HOME, 'proj');
fs.mkdirSync(proj, { recursive: true });
fs.writeFileSync(path.join(proj, 'my-plugin.php'), '<?php\n/* Plugin Name: My Plugin */');
const other = path.join(HOME, 'other');
fs.mkdirSync(other, { recursive: true });
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'workflow-guards.config.json'), JSON.stringify({
  release: { folderChecks: [{ commandPattern: 'deploy-my-plugin\\.ps1[^\\n]*-Release', mainFile: 'my-plugin.php', mustContain: 'Plugin Name:\\s*My Plugin' }] },
  inboxRoot: path.join(HOME, 'inbox'),
}));

const results = [];
const t = (name, want, got) => results.push({ ok: got === want, line: `${got === want ? 'PASS' : 'FAIL'}  ${name}: want ${want}, got ${got}` });

run(G, 'prompt', { session_id: 'a', prompt: 'fix the header' });
t('release without being asked', 'deny', dec(run(G, 'pretool', { session_id: 'a', tool_name: 'Bash', cwd: proj, tool_input: { command: 'gh release create v1 x.zip' } })));
t('ordinary command', 'allow', dec(run(G, 'pretool', { session_id: 'a', tool_name: 'Bash', cwd: proj, tool_input: { command: 'git status' } })));
run(G, 'prompt', { session_id: 'b', prompt: 'looks good, release 1.2.0' });
t('release asked', 'allow', dec(run(G, 'pretool', { session_id: 'b', tool_name: 'Bash', cwd: proj, tool_input: { command: 'gh release create v1.2.0' } })));
t('release script, right folder', 'allow', dec(run(G, 'pretool', { session_id: 'b', tool_name: 'PowerShell', cwd: proj, tool_input: { command: '.\\deploy-my-plugin.ps1 -Release' } })));
t('release script, wrong folder', 'deny', dec(run(G, 'pretool', { session_id: 'b', tool_name: 'PowerShell', cwd: other, tool_input: { command: '.\\deploy-my-plugin.ps1 -Release' } })));
run(G, 'prompt', { session_id: 'c', prompt: "commit it but don't release yet" });
t('"not yet" wins', 'deny', dec(run(G, 'pretool', { session_id: 'c', tool_name: 'Bash', cwd: proj, tool_input: { command: 'npm publish' } })));
t('search over home', 'deny', dec(run(G, 'pretool', { tool_name: 'Grep', cwd: proj, tool_input: { pattern: 'x', path: HOME } })));
t('search in a project', 'allow', dec(run(G, 'pretool', { tool_name: 'Grep', cwd: proj, tool_input: { pattern: 'x', path: proj } })));

// Context nudge: fake transcript with a large usage line.
const tp = path.join(HOME, 't.jsonl');
fs.writeFileSync(tp, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: 350000 } } }) + '\n');
t('nudge on a big tab', 'ctx', dec(run(G, 'prompt', { session_id: 'd', prompt: 'hi', transcript_path: tp })));
t('nudge only once', 'allow', dec(run(G, 'prompt', { session_id: 'd', prompt: 'hi', transcript_path: tp })));

// Inbox notice.
const inbox = path.join(HOME, 'inbox');
fs.mkdirSync(path.join(inbox, 'my-plugin', 'new'), { recursive: true });
fs.writeFileSync(path.join(inbox, 'plugins.json'), JSON.stringify({ plugins: [{ slug: 'my-plugin', name: 'My Plugin', workspaces: [proj] }] }));
fs.writeFileSync(path.join(inbox, 'my-plugin', 'new', '2026-01-01-0000-test.md'), '# test');
t('inbox notice in workspace', 'ctx', dec(run(G, 'inbox', { cwd: proj })));
t('no inbox notice elsewhere', 'allow', dec(run(G, 'inbox', { cwd: other })));

// pain: logger.
t('pain: is blocked', 'block', dec(run(P, null, { prompt: 'pain: had to explain it again', cwd: proj, session_id: 'e' })));
t('normal prompt passes', 'allow', dec(run(P, null, { prompt: 'hello', cwd: proj, session_id: 'e' })));
t('pain: was logged', true, fs.readFileSync(path.join(HOME, '.claude', 'workflow-review', 'pain-log.md'), 'utf8').includes('had to explain it again'));

fs.rmSync(HOME, { recursive: true, force: true });
console.log(results.map(r => r.line).join('\n'));
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
