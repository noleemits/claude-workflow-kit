# Claude Workflow Kit

Hooks and skills for people who use [Claude Code](https://claude.com/claude-code) all day. They came out of
a review of 328 real sessions (30 days, 53,000 tool calls) that asked one question: where does the time and
the token budget actually go?

The answers, and what this kit does about each:

| What the review found | What the kit does |
|---|---|
| Tabs live for days, pass 300k to 700k tokens and get compacted; the user ends up asking for "a post-compact message" by hand | A nudge at 300k tokens, a `/handoff` skill that writes one `HANDOFF.md`, `/pickup` to resume in a fresh tab for ~5-10k tokens, and a digest saved automatically before every compaction |
| A tab idle past the prompt cache re-reads its whole context on the next message | The idle guard pauses that message and offers `/pickup` instead (send again to continue anyway) |
| Releases ran when the user had said "not yet", or from the wrong folder | A release guard: no release command unless the latest prompt asks for one, plus an optional check that the folder holds the project being released |
| Searches over the whole home folder time out | A search guard that refuses Grep/Glob over huge roots |
| The user carries text between Claude tabs, Codex and ChatGPT | A `/relay` skill: Claude tabs message each other directly, Codex reads a brief from a file, ChatGPT gets it on the clipboard |
| Bugs found in your own tools while doing other work get lost, or become prompts you paste into another chat | A project inbox: any chat files the bug where that project's chat will see it, with a policy file listing what must never be built from an item |

Everything is plain Node.js (no dependencies) and fails open: if a hook errors, your work carries on.

## Install

Requires Node.js 18+ and Claude Code.

```bash
git clone https://github.com/<you>/claude-workflow-kit
cd claude-workflow-kit
node tests/test-guards.js        # 15 checks, uses a temporary home folder
node install.js --dry-run        # see what would change
node install.js                  # or: node install.js --no-pain
```

The installer copies the hooks to `~/.claude/hooks/`, the skills to `~/.claude/skills/` (it never
overwrites a skill you already have), writes `~/.claude/workflow-guards.config.json` if missing, backs up
`~/.claude/settings.json` and registers the hooks. Running it twice adds nothing twice.

Claude Code may refuse to edit its own `settings.json` even when you ask it to (it counts as changing
its own permissions). Run the installer yourself in a terminal.

## What's inside

### Hooks (`hooks/`)

| File | Event | What it does |
|---|---|---|
| `idle-guard.js` | UserPromptSubmit | Pauses a message to a tab idle over 1h holding over 80k tokens, writes a digest, suggests `/pickup`. Also a CLI: `node idle-guard.js --digest <folder>` |
| `workflow-guards.js prompt` | UserPromptSubmit | Remembers the latest prompt for the release guard; nudges toward `/handoff` at 300k tokens, then every +150k |
| `workflow-guards.js pretool` | PreToolUse | Release guard and search guard |
| `workflow-guards.js precompact` | PreCompact | Saves a digest of the session before compaction |
| `workflow-guards.js aftercompact` | SessionStart (compact) | Tells Claude where that digest is, and to re-read `HANDOFF.md` |
| `workflow-guards.js inbox` | SessionStart | In a project's workspace, lists what is waiting in its inbox |
| `pain-log.js` | UserPromptSubmit | Temporary. A prompt starting `pain:` is logged and never reaches the model. Use it for a few days while you review your workflow |

### Skills (`skills/`)

- **handoff**: write or refresh one `HANDOFF.md` in a fixed shape (goal, done and verified, done but not
  verified, next step, decisions, traps).
- **pickup**: resume from the handoff or digest in a fresh tab.
- **ship**: commit, check, build and release in one order; never release without the word. Fill in its
  project table once.
- **relay**: pass a brief to another Claude tab, Codex or ChatGPT without copying by hand.
- **plugin-inbox**: file bugs and ideas for your own projects into their inbox, and triage them there.

### Configuration

`~/.claude/workflow-guards.config.json` (example in `examples/`):

- `nudgeAt`, `nudgeStep`: when the big-tab nudge fires.
- `blockedSearchRoots`: folders too big to search.
- `release.commandPattern`: regex for commands that count as a release (default: `gh release create`,
  `npm publish`).
- `release.folderChecks`: per release script, a file that must exist next to it and a regex it must contain,
  so a script cannot release the wrong project.
- `inboxRoot`: where the project inbox lives. Copy `examples/plugin-inbox/` there, edit `plugins.json` and
  `POLICY.md`, and create `<slug>/new`, `done`, `rejected`, `needs-you` for each project.

### Review your own workflow (`review/`)

1. `node review/extract.js 2026-01-01 ~/.claude/workflow-review/digests` turns your transcripts since that date
   into compact per-session digests (no model calls).
2. Ask Claude to split the digest folders into groups and run one reviewer agent per group with
   `review/BRIEF.md`, then merge the findings into one ranked report.
3. Keep `pain-log.js` on for a few days so the report also sees what annoyed you, not only what happened.

## Uninstall

Remove the entries that mention `idle-guard.js`, `workflow-guards.js` or `pain-log.js` from
`~/.claude/settings.json` (or restore the backup the installer made), then delete those files and skills.

## License

MIT
