<!--
key: write_md
category: tool-description
description: I create or overwrite a Markdown (.md) file
variables: []
params:
  file_path: Absolute path to the .md file to write. Must end with .md.
  content: The Markdown content to write to the file.
-->
I create or overwrite a Markdown (.md) file. Only accepts paths ending in .md — all other extensions are rejected. Creates parent directories automatically. For long documents (>300 lines), I write the first portion with write_md, then use edit calls to append remaining sections — avoiding provider output truncation.
