// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Prompt Store (External JSON/Folder loading + template interpolation)
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, type Dirent } from 'node:fs';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptOverrides {
  [key: string]: string | string[] | undefined;
  TOOL_DESC?: Record<string, string> | any;
}

export interface FrontmatterMeta {
  key: string;
  category: 'constant' | 'template' | 'tool-description';
  description: string;
  variables: string[];
  params?: Record<string, string>;  // tool-description only
}

export interface ManifestSchema {
  version: string;
  constants: Record<string, string>;
  qqbot: Record<string, string>;
  templates: Record<string, string>;
  toolDescriptions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let overrides: PromptOverrides = {};

// ---------------------------------------------------------------------------
// Frontmatter Parser
// ---------------------------------------------------------------------------

export function parseFrontmatter(raw: string): { meta: FrontmatterMeta; body: string } {
  let fmMatch = raw.match(/^<!--\n([\s\S]*?)\n-->\n?([\s\S]*)$/);
  if (!fmMatch) {
    fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  }
  if (!fmMatch) {
    return {
      meta: { key: '', category: 'constant', description: '', variables: [] },
      body: raw.trim(),
    };
  }

  const fmBlock = fmMatch[1];
  const body = fmMatch[2].trim();

  const meta: FrontmatterMeta = {
    key: '',
    category: 'constant',
    description: '',
    variables: [],
  };

  const lines = fmBlock.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const [, field, value] = kvMatch;
      if (field === 'key' || field === 'name') {
        meta.key = value.trim();
      } else if (field === 'category') {
        meta.category = value.trim() as FrontmatterMeta['category'];
      } else if (field === 'description') {
        const trimmed = value.trim();
        // Support YAML multi-line string syntax: | (literal) and >- (folded with strip)
        if (trimmed === '|' || trimmed === '>' || trimmed === '>-') {
          // Collect continuation lines (indented block)
          const indentMatch = lines[i + 1]?.match(/^(\s*)/);
          const baseIndent = indentMatch ? indentMatch[1].length : 2;
          const contLines: string[] = [];
          i++;
          while (i < lines.length) {
            const contLine = lines[i];
            const contIndent = contLine.match(/^(\s*)/)?.[1].length ?? 0;
            if (contIndent < baseIndent && contLine.trim() !== '') break;
            contLines.push(contLine.trimStart());
            i++;
          }
          const mode = trimmed; // '|' = literal (keep newlines), '>' or '>-' = folded (join with spaces)
          if (mode === '|') {
            meta.description = contLines.join('\n').trim();
          } else {
            // Folded scalar: join with spaces, collapse multiple spaces
            meta.description = contLines.join(' ').replace(/\s+/g, ' ').trim();
          }
          continue;
        }
        meta.description = trimmed;
      } else if (field === 'variables') {
        const arrMatch = value.match(/^\[(.*)\]$/);
        if (arrMatch) {
          const inner = arrMatch[1].trim();
          meta.variables = inner
            ? inner.split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
            : [];
        }
      } else if (field === 'params') {
        meta.params = {};
        i++;
        while (i < lines.length) {
          const paramLine = lines[i];
          const paramMatch = paramLine.match(/^\s{2}(\w+):\s*(.+)$/);
          if (paramMatch) {
            meta.params[paramMatch[1]] = paramMatch[2].trim();
            i++;
          } else {
            break;
          }
        }
        continue;
      }
    }
    i++;
  }

  return { meta, body };
}

// ---------------------------------------------------------------------------
// Folder Loading
// ---------------------------------------------------------------------------

async function loadFolder(folderPath: string): Promise<void> {
  const manifestRaw = await readFile(join(folderPath, 'manifest.json'), 'utf-8');
  const manifest = JSON.parse(manifestRaw) as ManifestSchema;
  overrides = {};

  // 1. Load constants from manifest
  if (manifest.constants) {
    for (const [key, filename] of Object.entries(manifest.constants)) {
      try {
        const filePath = join(folderPath, filename);
        const raw = await readFile(filePath, 'utf-8');
        const { body } = parseFrontmatter(raw);
        overrides[key] = body;
      } catch { /* skip missing */ }
    }
  }

  // 2. Load qqbot from manifest
  if (manifest.qqbot) {
    for (const [key, filename] of Object.entries(manifest.qqbot)) {
      try {
        const filePath = join(folderPath, filename);
        const raw = await readFile(filePath, 'utf-8');
        const { body } = parseFrontmatter(raw);
        overrides[key] = body;
      } catch { /* skip missing */ }
    }
  }

  // 3. Load templates from manifest
  if (manifest.templates) {
    for (const [key, filename] of Object.entries(manifest.templates)) {
      try {
        const filePath = join(folderPath, filename);
        const raw = await readFile(filePath, 'utf-8');
        const { body } = parseFrontmatter(raw);
        overrides[key] = body;
      } catch { /* skip missing */ }
    }
  }

  // 4. Load toolDescriptions from manifest
  if (manifest.toolDescriptions) {
    if (!overrides.TOOL_DESC) overrides.TOOL_DESC = {};
    for (const [toolKey, filename] of Object.entries(manifest.toolDescriptions)) {
      try {
        const filePath = join(folderPath, filename);
        const raw = await readFile(filePath, 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        (overrides.TOOL_DESC as Record<string, string>)[toolKey] = body;
        if (meta.params) {
          for (const [param, desc] of Object.entries(meta.params)) {
            (overrides.TOOL_DESC as Record<string, string>)[`${toolKey}_${param}`] = desc;
          }
        }
      } catch { /* skip missing */ }
    }
  }

  // 5. Auto-discover Roles from 'roles/' subdirectory
  try {
    const rolesDir = join(folderPath, 'roles');
    const roleFiles = await readdir(rolesDir);
    for (const f of roleFiles) {
      if (f.endsWith('.md')) {
        const raw = await readFile(join(rolesDir, f), 'utf-8');
        const { body } = parseFrontmatter(raw);
        // Normalize name: roles/role-architect.md -> ROLE_ARCHITECT
        let base = basename(f, '.md');
        if (base.startsWith('role-')) base = base.slice(5);
        const name = base.toUpperCase().replace(/[-]/g, '_');
        overrides[`ROLE_${name}`] = body;
      }
    }
  } catch {
    // skip if roles dir missing
  }
}

// ---------------------------------------------------------------------------
// Load overrides from .vesper/prompts/ (flat .md files, no manifest needed)
// These override the built-in prompts loaded from dist/prompts/.
// ---------------------------------------------------------------------------

/**
 * Derive the override key from a prompt .md file.
 * Priority:
 * 1. Frontmatter `key:` field (e.g. <!-- key: IDENTITY -->) — most reliable
 * 2. Filename convention for egos/ and roles/ subdirectories
 * 3. Filename as fallback (uppercased, dashes → underscores)
 */
function deriveOverrideKey(filename: string, subdir: string | null, raw: string): string | null {
  // 1. Try frontmatter key first — this is the authoritative source
  const { meta } = parseFrontmatter(raw);
  if (meta.key) return meta.key;

  // 2. Subdirectory conventions
  if (subdir === 'roles') {
    let base = filename.replace(/\.md$/, '');
    if (base.startsWith('role-')) base = base.slice(5);
    return `ROLE_${base.toUpperCase().replace(/[-]/g, '_')}`;
  }

  // 3. Fallback: filename → key (less reliable but better than nothing)
  return null;
}

async function loadDotLuxOverrides(dotLuxPromptsDir: string): Promise<void> {
  // Load .md files from .vesper/prompts/ using frontmatter `key:` to determine
  // the override key. This matches the same convention used in dist/prompts/.
  try {
    const entries = await readdir(dotLuxPromptsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Scan subdirectories (egos/, roles/)
        const subDir = join(dotLuxPromptsDir, entry.name);
        let subEntries: Dirent[];
        try {
          subEntries = await readdir(subDir, { withFileTypes: true });
        } catch { continue; }
        for (const sub of subEntries) {
          if (sub.isFile() && sub.name.endsWith('.md')) {
            try {
              const raw = await readFile(join(subDir, sub.name), 'utf-8');
              const { body } = parseFrontmatter(raw);
              const key = deriveOverrideKey(sub.name, entry.name, raw);
              if (key) overrides[key] = body;
            } catch { /* skip unreadable */ }
          }
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Root-level .md files: use frontmatter key
        try {
          const raw = await readFile(join(dotLuxPromptsDir, entry.name), 'utf-8');
          const { body } = parseFrontmatter(raw);
          const key = deriveOverrideKey(entry.name, null, raw);
          if (key) overrides[key] = body;
        } catch { /* skip unreadable */ }
      }
    }
  } catch {
    // .vesper/prompts/ doesn't exist — that's fine, no overrides
  }
}

// ---------------------------------------------------------------------------
// Load / Reset
// ---------------------------------------------------------------------------

export async function loadPrompts(pathOrFolder?: string, dotLuxPromptsDir?: string): Promise<void> {
  if (!pathOrFolder) {
    overrides = {};
    return;
  }

  try {
    const s = await stat(join(pathOrFolder, 'manifest.json'));
    if (s.isFile()) {
      await loadFolder(pathOrFolder);
    }
  } catch {
    // try as JSON file
    try {
      const raw = await readFile(pathOrFolder, 'utf-8');
      overrides = JSON.parse(raw) as PromptOverrides;
    } catch {
      overrides = {};
    }
  }

  // Apply .vesper/prompts/ overrides on top (highest priority)
  if (dotLuxPromptsDir) {
    await loadDotLuxOverrides(dotLuxPromptsDir);
  }
}

export function resetPromptStore(): void {
  overrides = {};
}

/**
 * Check if a specific prompt file has a .vesper/prompts/ override.
 * Returns the override path if it exists, undefined otherwise.
 */
export function getDotLuxOverridePath(filename: string, dotLuxPromptsDir?: string): string | undefined {
  if (!dotLuxPromptsDir) return undefined;
  const overridePath = join(dotLuxPromptsDir, filename);
  return existsSync(overridePath) ? overridePath : undefined;
}

/**
 * Get the .vesper/prompts/ directory path for the current working directory.
 */
export function getDotLuxPromptsDir(): string {
  return resolve(process.cwd(), '.vesper', 'prompts');
}

// ---------------------------------------------------------------------------
// Resolve Helpers
// ---------------------------------------------------------------------------

export function resolveConstant(key: string, defaultValue: string): string {
  const val = overrides[key];
  if (val === undefined) return defaultValue;
  if (Array.isArray(val)) return val.join('\n');
  return String(val);
}

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    return vars[name] ?? '';
  });
}

export function resolveTemplate(
  key: string,
  defaultFn: () => string,
  vars: Record<string, string>,
): string {
  const val = overrides[key];
  if (val === undefined) return defaultFn();
  const template = Array.isArray(val) ? val.join('\n') : String(val);
  return interpolate(template, vars);
}

/**
 * Resolve a TOOL_DESC string property.
 */
export function resolveToolDesc(key: string, defaultValue: string): string {
  const td = overrides.TOOL_DESC;
  if (td && typeof td === 'object' && key in td) {
    const val = td[key];
    if (Array.isArray(val)) return val.join('\n');
    return String(val);
  }
  return defaultValue;
}

/**
 * Resolve a TOOL_DESC function property (e.g. search_tools(lazyCount)).
 */
export function resolveToolDescFn(
  key: string,
  defaultFn: () => string,
  vars: Record<string, string>,
): string {
  const td = overrides.TOOL_DESC;
  if (td && typeof td === 'object' && key in td) {
    const val = td[key];
    const template = Array.isArray(val) ? val.join('\n') : String(val);
    return interpolate(template, vars);
  }
  return defaultFn();
}
