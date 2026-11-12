---
name: pickup
description: Continue work from an earlier Claude session in this folder without re-reading its whole conversation. Use when the user types /pickup, says "pick up where we left off", "continue the last session", "what was I doing here", or after the idle-tab guard paused an old tab and told them to open a new one.
---

# Pickup: resume from a digest, not the full transcript

An old tab that sat idle past the 1h prompt cache costs its whole context again on the next
message (often 200k to 300k tokens). The idle guard hook (`~/.claude/hooks/idle-guard.js`) blocks
that message and writes a digest. This skill reads the digest instead, for about 5k to 10k tokens.

## Steps

1. Get the digest for the newest earlier session in this folder (this also works when the guard
   never fired, because the script builds one on demand). Exclude the current session:

   ```bash
   node "~/.claude/hooks/idle-guard.js" --digest "<cwd>" --exclude "<current session id if known>"
   ```

   If the user names a different session or says "not that one", add `--list` to print the 8 newest
   (path, size, last activity, title) and let the user choose by title.
2. Read the digest file it prints. If the folder also holds a `HANDOFF.md` for the ticket, read
   that too; it wins over the digest where they disagree.
3. Check the live state before trusting the digest: `git status` / `git log -3` if it is a repo,
   and re-open any file the digest says was edited only when the next step needs it.
4. Reply with: what that session was doing, where it stopped, what is still open, and the next
   step you propose. Then wait for the user, unless they already said what to do next.

Do not run `claude --resume` on the old session: that loads the full context and defeats the point.
Only suggest it if the digest is clearly missing something that matters.
