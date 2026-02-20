---
name: significant-change-commit
description: Commit meaningful implementation steps with clear messages and verification
compatibility: opencode
---

# Significant Change Commit

Use this skill after a substantial implementation step (feature, bug fix, refactor, or broad test update).

## When to use

- A logical chunk of work is complete and verified.
- Multiple related files were updated for one purpose.
- The change is stable enough to checkpoint in git.

## Workflow

1. Inspect `git status`, `git diff`, and recent commit messages.
2. Stage only files related to the completed change.
3. Run verification (`npm test`, targeted tests, or build command).
4. Write a short commit message in repository style (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
5. Create the commit and confirm clean post-commit status.

## Safety

- Do not commit secrets or local credentials.
- Do not use destructive git operations.
- Do not amend pushed commits.
