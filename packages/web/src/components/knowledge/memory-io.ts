// Import/export helpers for the Knowledge sidebar.
// Export: turn a fetched ontology payload into a downloadable JSON file.
// Import: read a user-picked .json file and lightly validate its shape —
// full validation + id remapping happens server-side in ontology-handlers.

/** Trigger a browser download of `content` as `filename`. */
export function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Read a File into text. */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

/**
 * Light client-side check of an import payload.
 * Returns an error string, or null if the shape looks importable.
 */
export function validateImportJson(text: string): string | null {
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    return '不是有效的 JSON 文件';
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return '文件内容必须是一个 JSON 对象';
  }
  const { nodes, edges, notes } = payload;
  if (nodes === undefined && edges === undefined && notes === undefined) {
    return '文件中不包含 nodes / edges / notes 任何字段';
  }
  for (const [key, arr] of Object.entries({ nodes, edges, notes })) {
    if (arr !== undefined && !Array.isArray(arr)) {
      return `字段 ${key} 必须是数组`;
    }
  }
  return null;
}
