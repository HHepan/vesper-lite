<!--
key: write_xlsx
category: tool-description
description: I create or overwrite an XLSX spreadsheet from TSV or Markdown tables
variables: []
params:
  file_path: Absolute path to the .xlsx file to write. Must end with .xlsx.
  content: TSV content to convert to XLSX. Use tab characters to separate columns, newlines to separate rows. Use "--- Sheet: Name ---" to start a new sheet. Markdown table format (with | separators) is also accepted.
-->
I create or overwrite an XLSX (.xlsx) spreadsheet from TSV or Markdown table content. Use "--- Sheet: Name ---" headers to create multiple sheets. Tab-separated values within each sheet. Only accepts .xlsx paths.
