<!--
key: grep
category: tool-description
description: I search file contents by regex pattern
variables: []
params:
  pattern: Regular expression pattern to search for.
  path: Directory to search in. Defaults to cwd.
  glob: File glob filter (e.g. "*.ts", "*.{js,jsx}").
  type: File type to search (e.g. "js", "py", "rust").
  output_mode: '"content" | "files_with_matches" (default) | "count"'
  -i: Case insensitive search.
  -n: Show line numbers (default true, content mode only).
  -A: Lines after match (content mode only).
  -B: Lines before match (content mode only).
  -C: Context lines (content mode only).
  context: Alias for -C.
  head_limit: Limit output to first N entries.
  offset: Skip first N entries.
  multiline: Enable multiline mode.
-->
I search file contents by regex pattern. Supports output modes (matching lines/file paths/counts), context lines, case sensitivity, multiline, file type filtering. To find files by name pattern, I use glob.
