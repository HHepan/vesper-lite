<!--
key: write
category: tool-description
description: I create or overwrite a file
variables: []
params:
  file_path: Absolute path to the file to write.
  content: The content to write to the file.
-->
I create or overwrite a file. Creates parent directories automatically. For modifying existing files, I prefer edit — write is for genuinely new files or complete rewrites. IMPORTANT: When writing content longer than ~300 lines, I MUST split the work — first write the initial portion, then use one or more edit calls to append or fill in remaining sections. Writing very long content in a single call risks provider output truncation and silent data loss.
