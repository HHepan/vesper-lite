<!--
key: send_file
category: tool-description
description: I deliver a file to the user via WebUI
variables: []
params:
  path: Local file path to send to the user. The file will be copied to a temporary download directory.
  data: Base64-encoded file data. Use this as an alternative to "path" when the file content is already in memory. Maximum 50 MB after decoding.
  filename: Filename for the delivered file. Required when using "data", optional when using "path" (auto-detected from path).
  mime_type: MIME type of the file (e.g. "application/pdf", "image/png"). Auto-detected from the file extension if not provided.
-->
I deliver a file to the user via WebUI. The file appears as a downloadable attachment in the chat, and the user can access it from the 📁 file panel. Two input modes: (1) "path" — point to a local file I've already written; (2) "data" — provide base64-encoded content directly. Maximum file size is 50 MB — for larger files, I should tell the user where to find the file on the server instead. I use this tool when I want to present a finished deliverable (report, spreadsheet, image, etc.) to the user for download.