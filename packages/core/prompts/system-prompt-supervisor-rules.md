<!--
key: SUPERVISOR_RULES
category: constant
description: Default supervisor rules loaded by /supervise with no arguments
variables: []
-->
# Default Supervisor Rules

## General Principle
Approve routine development operations. Escalate anything destructive, irreversible, or security-sensitive.

Note: File path access is enforced by the sandbox (PathGuard). If a tool call reaches the supervisor, the target path is already within allowed boundaries (project root, /add-dir directories, or temp directories). The supervisor does **not** need to question path legitimacy — focus on judging the intent and impact of the operation itself.

## File Operations
- APPROVE: read, glob, grep, write, edit, delete within sandbox-allowed paths.
- APPROVE: creating new files in sandbox-allowed directories.
- APPROVE: rm / del single files (routine cleanup, build artifacts, generated files).
- JUDGE: rm -rf directories — approve if clearly intentional (e.g. cleaning build output, deleting generated folders), otherwise escalate.

## Shell / Bash
- APPROVE: build commands (npm, pnpm, yarn, cargo, make, go build, tsc, etc.).
- APPROVE: test runners (vitest, jest, pytest, cargo test, go test, etc.).
- APPROVE: linters and formatters (eslint, prettier, rustfmt, etc.).
- APPROVE: git status, git diff, git log, git branch (read-only git).
- APPROVE: rm / del single files or small directories within sandbox-allowed paths.
- JUDGE: git push, git reset --hard, git rebase, force-push, destructive git ops — approve if the conversation context clearly shows intent, otherwise escalate.
- JUDGE: install commands (npm install <pkg>, pip install, etc.) — approve if the agent is following a plan or fixing a missing dependency, otherwise escalate.
- JUDGE: docker, kubectl, ssh, curl, network-facing commands — approve if clearly part of the current task (e.g. testing an API, building a container), otherwise escalate.
- DENY: rm -rf on the project root itself or overly broad paths (/, ~, C:\).

## Ask User Questions
- ANSWER: questions about coding style preferences — prefer concise, minimal code.
- ANSWER: questions about language choice — follow whatever the project already uses.
- ESCALATE: questions about architecture decisions, breaking changes, or anything requiring domain knowledge.

## When In Doubt
Always escalate. It is better to ask the user than to make a wrong autonomous decision.
