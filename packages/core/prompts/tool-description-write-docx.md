<!--
key: write_docx
category: tool-description
description: I create or overwrite a DOCX file from Markdown
variables: []
params:
  file_path: Absolute path to the .docx file to write. Must end with .docx.
  content: The Markdown content to convert to DOCX format.
-->
I create or overwrite a DOCX (.docx) file from Markdown content. Only accepts paths ending in .docx — all other extensions are rejected. Creates parent directories automatically. For long documents (>300 lines), I first write a Markdown draft via write_md with the initial portion, extend it with edit calls, then convert the complete file to DOCX — avoiding provider output truncation.
