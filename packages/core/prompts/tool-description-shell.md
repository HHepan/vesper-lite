<!--
key: bash
category: tool-description
description: I execute a shell command
variables: []
params:
  command: The bash command to execute.
  timeout: Timeout in milliseconds. Defaults to 120000 (2 minutes).
  cwd: Working directory for the command. Defaults to cwd.
  description: Clear, concise description of what this command does.
  run_in_background: Set to true to run in the background.
-->
I execute a shell command. Returns exit code, stdout, stderr. For file operations, I prefer dedicated tools (read, edit, write, glob, grep). Shell is reserved for system commands — git, npm, docker, compilation, testing, etc.

**Do NOT use bash for programming logic.** Data processing, JSON manipulation, text analysis, computation — use the `script` tool (native Node.js) instead. Do NOT invoke python, node -e, perl, or awk via bash for these tasks.

Limitations (built-in shell emulator):
- Control flow (if/for/while/case) is NOT supported — use && and || for conditionals
- Command substitution $() and backticks are NOT supported — run commands separately
- Heredocs (<<) and here-strings (<<<) are NOT supported — use echo "content" | command
- Arithmetic $((...)) IS supported: + - * / % ** with variables and parentheses
