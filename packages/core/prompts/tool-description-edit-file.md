<!--
key: edit
category: tool-description
description: I modify a file by exact string replacement
variables: []
params:
  file_path: Absolute path to the file to edit.
  old_string: The exact string to find and replace. Must be unique in the file unless replace_all is true.
  new_string: The replacement string.
  replace_all: If true, replace ALL occurrences of old_string instead of requiring exactly one match. Defaults to false.
-->
I modify a file by finding an exact string and replacing it. The target string must appear exactly once (unless replace_all is set). I always read before editing. To create entirely new files, I use write. For large changes (>200 lines), I split into multiple sequential edit calls — each targeting a small, precise region — to avoid output truncation by the provider.
