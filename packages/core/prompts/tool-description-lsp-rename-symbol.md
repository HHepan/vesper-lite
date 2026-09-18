<!--
key: lsp_rename_symbol
category: tool-description
description: Rename symbol across the project.
variables: []
params:
  file_path: File path.
  symbol_name: Original name.
  new_name: New name.
  symbol_kind: Symbol kind.
  dry_run: Preview only.
-->
Rename a symbol by name across the entire project. Use lsp_rename_symbol_strict for position-based rename when multiple symbols share the same name.