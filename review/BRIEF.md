# Workflow review brief (for reviewer agents)

The user works with Claude Code every day and wants an honest review of their biggest pain points
and areas of improvement, so they can fix them with hooks, skills, CLAUDE.md rules, permission
settings or habits.

Input: compact per-session digests in `~/.claude/workflow-review/digests/<project>/*.md` made by
`review/extract.js`. Each has a stats header (wall minutes, prompts, tool calls, errors, rejections,
interrupts, compactions, peak context tokens), minutes between prompts, top tools, the user's prompts
(timestamped, clipped), rejected or denied tool calls and tool errors. Also read `~/.claude/CLAUDE.md`
first, so you don't propose what already exists and can spot rules that are NOT being followed.

Read every digest in your assigned folders. Look for, with evidence:
1. Corrections: the user says Claude was wrong, repeats themselves, "I said", "no", "again", frustration.
2. Re-explaining: context given again and again across sessions (paths, logins, conventions, which
   site or server, how to test) that could live in a skill, memory or hook.
3. Repeated manual procedures: the same multi-step ask across sessions that could be a skill.
4. Waiting and babysitting: long sessions, many short "continue/yes/go" prompts, permission denials,
   classifier blocks, browser tool failures, retry loops.
5. Rules in CLAUDE.md being broken.
6. Context cost: huge sessions, compactions, tabs reused across unrelated tasks.
7. What a hook could catch deterministically versus what needs judgment (skill or rule).

Write findings to `~/.claude/workflow-review/findings/<your-group>.md`:
- Top findings ranked by cost to the user (time, tokens, frustration), max 10.
- For each: what happens, how often (count sessions), 2-3 short evidence quotes with the digest file
  name, and the fix type (hook / skill / CLAUDE.md / settings / habit) in one line.
- A short "already working well" list.
Be concrete and skeptical: nothing you can't point to evidence for. Write nothing outside the findings
folder. Return a 10-line summary of your top findings as your final message.
