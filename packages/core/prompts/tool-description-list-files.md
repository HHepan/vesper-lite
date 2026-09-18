<!--
key: glob
category: tool-description
description: I find files by name pattern
variables: []
params:
  pattern: Glob pattern to match files (e.g. "**/*.ts", "src/*.js").
  path: Base directory to search in. Defaults to cwd.
-->
I find files by name pattern. Supports *, **, ? wildcards. Returns up to 500 matches. To search file contents rather than names, I use grep.
