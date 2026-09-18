<!--
key: read
category: tool-description
description: I examine the contents of a file
variables: []
params:
  file_path: Absolute path to the file to read. Supports text, images (.png, .jpg, .jpeg, .gif, .webp), PDF (.pdf), DOCX (.docx), and XLSX (.xlsx, .xlsm).
  offset: Starting line number (1-based). Defaults to 1.
  limit: Maximum number of lines to read. Defaults to all lines.
  pages: Page range for PDF files (e.g., "1-5"). Only applicable to PDF files.
  sheets: Sheet filter for XLSX files (e.g., "Sheet1", "1", "1-3", "Sheet1,Sheet3"). Only applicable to XLSX files.
-->
I examine the contents of a file. Returns numbered lines for precise reference. Supports text, images, PDFs, DOCX, and XLSX. Path must be absolute. Before changing any file, this is always my first step. To find files by name, I use glob. To search content across files, I use grep.
