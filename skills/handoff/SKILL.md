---
name: handoff
description: Write or refresh the HANDOFF.md for the current work so a fresh tab can continue with /pickup. Use when the user types /handoff, asks for a "post compact message", "prompt for the next chat", "handoff", "summary for a new tab", when the context-size hook suggests it, or before ending a long session mid-task.
---

# Handoff: leave the work so a fresh tab can pick it up cold


## Where the file goes

1. If the task already has a handoff (`work/<feature>/HANDOFF.md`, a ticket folder's `HANDOFF.md`, a
   `ppd-worktrees/*HANDOFF*.md`), **update that file**. Do not start a second one.
2. Otherwise create `HANDOFF.md` in the task's own folder (ticket folder, `work/<feature>/`, or the
   project root if the work is project-wide).

## What goes in it (keep it under ~150 lines; replace the "Now" part, keep history short)

```markdown
# <Task name>: handoff
_Updated YYYY-MM-DD HH:MM by Claude (session <first 8 chars of session id>)_

## Goal
One or two sentences: what the user wants and why.

## Now
- Done and verified: ... (how it was verified)
- Done, NOT verified: ...
- In progress: ... (exact file and what was half-done)
- Next step: the single next action, concrete enough to start without asking.

## Decisions (do not re-litigate)
- YYYY-MM-DD: decision, and who made it (the user / Claude, approved).

## Where things are
- Repo / branch / worktree, site URL (staging or live, say which), MCP server name.
- Files touched, absolute paths.

## Traps
- Things that cost time this session and would cost it again.

## Open questions for the user
```

Rules: absolute paths; say staging vs live explicitly; no secrets, tokens or passwords (name the
password-manager item or `.env` key instead); verified vs not verified must be honest.

## Then

Reply in two lines: the path of the file (absolute, plus a `file:///` link), and
"Open a new tab in `<folder>` and type /pickup." Do not paste the handoff into the reply.
