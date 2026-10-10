---
name: review
description: Review the current changes for bugs and risky edits before committing
---
Review the uncommitted changes.

1. Run `git status` and `git diff` to see what changed.
2. For each changed file, read the changed parts and the code around them.
3. Report problems in order of seriousness: wrong behaviour, missing error handling at trust boundaries, security, then smaller issues. For each: file, line, what is wrong, and a concrete fix.
4. Say what you checked and what you could not check (no tests ran, no way to run the app).
5. Do not change any file. If there is nothing wrong, say so plainly.
