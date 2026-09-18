<!--
key: lsp_rename_symbol_strict
category: tool-description
description: Rename symbol at a specific position.
variables: []
params:
  file_path: File path.
  line: Line number.
  character: Character position.
  new_name: New name.
  dry_run: Preview only.
-->
Rename a symbol at a specific position (more precise than name-based rename). Use when multiple symbols share the same name in a file.