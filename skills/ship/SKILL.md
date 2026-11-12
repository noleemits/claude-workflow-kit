---
name: ship
description: Ship a change to one of your own projects in a fixed order - version bump, checks, commit, push, build, upload, release only on the user's explicit word, wrap-up. Use when the user types /ship, says "ship it", "commit and push", "release", "publish", "make the zip", or asks to finish a version.
---

# Ship: one order, every time

A PreToolUse hook (`workflow-guards.js`) also blocks any release command unless the user's latest
message asks for one, and can check the folder holds the project the release script names.

## 0. Fill this table in once for your projects (edit this file)

| Project | Repo folder | Release command | Checks |
|---|---|---|---|
| my-plugin | `~/code/my-plugin` | `./deploy.ps1 -Release` | `npm test` |

Confirm the folder's main file names the project you mean before anything else.

## 1. Ask what "ship" means this time, unless it was said

One line, and only if unclear: **(a)** commit + push only, **(b)** + build / pending upload,
**(c)** + release to users. Default when unclear: (a). Never (c) without the word "release" in the
user's latest message.

## 2. Steps, in order

1. `git status` and branch. Release builds come from the main branch with a clean tree.
2. Version: bump every place the version lives, and add the changelog entry in user-facing words.
3. Checks: run the project's suite. Report failures by NAME (grep the output for FAIL; do not rerun
   the whole battery just to find which one failed). Check the error log for new entries.
4. Commit (conventional message with the version), push.
5. Build/upload if (b) or (c): build-only first, then the pending upload.
6. Release only if (c) and the user said release.
7. After a release: docs if user-visible behaviour changed, then a short wrap-up note.

## 3. Report

Version, what ran, what passed or failed (by name), the commit hash, pending or released, and
anything skipped. One short list.
