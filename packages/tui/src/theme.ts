// =============================================================================
// Vesper TUI -- Theme System (centralized color palette)
//
// All TUI colors live here. Components import the `theme` singleton.
// Default palette: VSCode Dark+ terminal ANSI colors.
//
// Users can override any token via:
//   ~/.vesper/config.json    { "theme": { "bannerMascot": "#FF6B6B" } }
//   .vesper/config.json      (project-level, higher priority)
// =============================================================================

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// ThemeConfig — semantic color tokens
// ---------------------------------------------------------------------------

export interface ThemeConfig {
  // Chrome
  separator: string;
  border: string;
  dimText: string;

  // User input
  promptMarker: string;
  promptText: string;
  promptBg: string;

  // Assistant output
  assistantDot: string;

  // System messages
  systemDot: string;
  systemLabel: string;
  systemText: string;

  // Thinking
  thinkingDot: string;
  thinkingLabel: string;
  thinkingContent: string;

  // Tool calls
  toolName: string;
  toolSuccess: string;
  toolError: string;
  toolPending: string;
  toolArgs: string;
  toolResult: string;

  // Status bar
  statusModel: string;
  statusBudgetNormal: string;
  statusBudgetWarn: string;
  statusBudgetCritical: string;
  statusStack: string;

  // Pending sidebands
  pendingIcon: string;
  pendingText: string;

  // Permission dialog
  permissionBorder: string;
  permissionHeader: string;
  permissionTool: string;
  permissionAllowOnce: string;
  permissionAllowAlways: string;
  permissionDeny: string;

  // Ask user dialog
  askUserBorder: string;
  askUserHeader: string;
  askUserQuestion: string;
  askUserOptionLabel: string;
  askUserOptionDesc: string;
  askUserSelected: string;
  askUserOther: string;
  askUserChip: string;

  // Agent spinner
  spinnerActive: string;
  spinnerIdle: string;
  spinnerHueCycling: boolean;

  // Welcome banner
  bannerMascot: string;
  bannerTitle: string;
  bannerSubtext: string;
  bannerBorder: string;

  // Errors
  errorText: string;
  errorDot: string;

  // Task panel
  taskPanelTree: string;
  taskDone: string;
  taskInProgress: string;
  taskPending: string;
  taskHeader: string;
  taskActiveForm: string;
  taskTitleStar: string;

  // Canvas browser
  canvasBrowserBorder: string;
  canvasBrowserHeader: string;
  canvasBrowserSelected: string;
  canvasBrowserFolded: string;
  canvasBrowserPinned: string;
  canvasBrowserTokens: string;

  // Autocomplete menu
  autocompleteHighlight: string;
  autocompleteCommand: string;
  autocompleteDescription: string;

  // Misc
  streamingCursor: string;
  treeBorder: string;

  // Markdown (marked-terminal)
  mdHeading: string;
  mdFirstHeading: string;
  mdCode: string;
  mdCodespan: string;
  mdBlockquote: string;
  mdLink: string;
  mdHref: string;

  // Diff view
  diffAdded: string;
  diffRemoved: string;
  diffAddedBg: string;
  diffRemovedBg: string;
  diffAddedHighlight: string;
  diffRemovedHighlight: string;
  diffContent: string;
  diffContext: string;
  diffHunkHeader: string;
  diffLineNumber: string;
  diffFilePath: string;

  // Code syntax highlighting (cli-highlight tokens inside fenced code blocks)
  codeKeyword: string;
  codeString: string;
  codeNumber: string;
  codeComment: string;
  codeFunction: string;
  codeBuiltIn: string;
  codeLiteral: string;
  codeType: string;
  codeRegexp: string;
  codeMeta: string;
  codeTag: string;
  codeAttr: string;
  codeName: string;
  codeVariable: string;
  codeTitle: string;
  codeParams: string;
  codeAddition: string;
  codeDeletion: string;
}

// ---------------------------------------------------------------------------
// Default theme: VSCode Dark+ terminal ANSI hex colors
// ---------------------------------------------------------------------------

export const VSCODE_DARK_PLUS: ThemeConfig = {
  // Chrome
  separator: '#505050',
  border: '#505050',
  dimText: '#999999',

  // User input
  promptMarker: '#888888',
  promptText: '#E5E5E5',
  promptBg: '#373737',

  // Assistant output — Claude orange
  assistantDot: '#D77757',

  // System messages — IDE blue
  systemDot: '#4782C8',
  systemLabel: '#4782C8',
  systemText: '#999999',

  // Thinking — Claude orange
  thinkingDot: '#D77757',
  thinkingLabel: '#D77757',
  thinkingContent: '#999999',

  // Tool calls
  toolName: '#B1B9F9',      // Suggestion blue-purple
  toolSuccess: '#4EBA65',   // Green
  toolError: '#FF6B80',     // Soft red
  toolPending: '#999999',   // Dim gray
  toolArgs: '#999999',      // Dim gray
  toolResult: '#999999',    // Dim gray

  // Status bar
  statusModel: '#999999',
  statusBudgetNormal: '#999999',
  statusBudgetWarn: '#FFC107',
  statusBudgetCritical: '#FF6B80',
  statusStack: '#AF87FF',   // autoAccept purple

  // Pending sidebands — Amber
  pendingIcon: '#FFC107',
  pendingText: '#FFC107',

  // Permission dialog
  permissionBorder: '#B1B9F9',
  permissionHeader: '#B1B9F9',
  permissionTool: '#4782C8',       // IDE blue
  permissionAllowOnce: '#4EBA65',  // Green
  permissionAllowAlways: '#4782C8', // IDE blue
  permissionDeny: '#FF6B80',       // Soft red

  // Ask user dialog
  askUserBorder: '#B1B9F9',
  askUserHeader: '#B1B9F9',
  askUserQuestion: '#E5E5E5',
  askUserOptionLabel: '#B1B9F9',
  askUserOptionDesc: '#999999',
  askUserSelected: '#4EBA65',
  askUserOther: '#AF87FF',
  askUserChip: '#4782C8',

  // Agent spinner
  spinnerActive: '#D77757', // Claude orange
  spinnerIdle: '#999999',
  spinnerHueCycling: true,

  // Welcome banner
  bannerMascot: '#D77757',  // Claude orange
  bannerTitle: '#E5E5E5',   // White
  bannerSubtext: '#999999',
  bannerBorder: '#505050',

  // Errors
  errorText: '#FF6B80',
  errorDot: '#FF6B80',

  // Task panel
  taskPanelTree: '#505050',      // same as treeBorder
  taskDone: '#4EBA65',           // Green (completed ✓)
  taskInProgress: '#FFC107',     // Amber (in-progress ■)
  taskPending: '#E5E5E5',       // White (normal)
  taskHeader: '#999999',         // dim header
  taskActiveForm: '#AF87FF',     // autoAccept purple
  taskTitleStar: '#D77757',      // Claude orange

  // Canvas browser
  canvasBrowserBorder: '#4782C8',     // IDE blue
  canvasBrowserHeader: '#4782C8',     // IDE blue
  canvasBrowserSelected: '#E5E5E5',   // White (bright for selected row)
  canvasBrowserFolded: '#999999',     // Dim gray (folded blocks)
  canvasBrowserPinned: '#FFC107',     // Amber (pinned indicator)
  canvasBrowserTokens: '#999999',     // Dim gray (token counts)

  // Autocomplete menu
  autocompleteHighlight: '#2B3660',  // Dark blue selection
  autocompleteCommand: '#B1B9F9',    // Suggestion blue-purple
  autocompleteDescription: '#999999', // Dim gray

  // Misc
  streamingCursor: '#D77757', // Claude orange
  treeBorder: '#505050',

  // Markdown
  mdHeading: '#4EBA65',       // Green
  mdFirstHeading: '#AF87FF',  // autoAccept purple
  mdCode: '#D77757',          // Claude orange
  mdCodespan: '#D77757',
  mdBlockquote: '#999999',
  mdLink: '#4782C8',          // IDE blue
  mdHref: '#4782C8',

  // Diff view
  diffAdded: '#23B05D',       // Semantic green (added lines — readable, not too bright)
  diffRemoved: '#F05050',     // Semantic red (removed lines — clear danger signal)
  diffAddedBg: '#225C2B',    // Dark green background (CC-matched)
  diffRemovedBg: '#7A2936',  // Dark red background (CC-matched)
  diffAddedHighlight: '#38A660',   // Bright green (word-level highlight — CC-matched)
  diffRemovedHighlight: '#B3596B', // Bright red (word-level highlight — CC-matched)
  diffContent: '#FBFBFB',    // Bright white (diff line text — CC-matched)
  diffContext: '#A0A0A0',     // Light gray (context lines — readable, not washed out)
  diffHunkHeader: '#569CD6',  // Blue (same as codeKeyword)
  diffLineNumber: '#555555',  // Dim gray (gutter, subtle but visible)
  diffFilePath: '#DCDCAA',    // Yellow (same as codeFunction)

  // Code syntax highlighting — VSCode Dark+ token colors
  codeKeyword: '#569CD6',     // Blue (if, else, return, const, etc.)
  codeString: '#CE9178',      // Orange-brown (string literals)
  codeNumber: '#B5CEA8',      // Light green (numeric literals)
  codeComment: '#6A9955',     // Green (comments)
  codeFunction: '#DCDCAA',    // Yellow (function names at call site)
  codeBuiltIn: '#4EC9B0',     // Teal (built-in objects: console, Math, etc.)
  codeLiteral: '#569CD6',     // Blue (true, false, null)
  codeType: '#4EC9B0',        // Teal (type names)
  codeRegexp: '#D16969',      // Dark red (regex literals)
  codeMeta: '#9CDCFE',        // Light blue (decorators, preprocessor)
  codeTag: '#569CD6',         // Blue (HTML/XML tags)
  codeAttr: '#9CDCFE',        // Light blue (HTML attributes, JSON keys)
  codeName: '#569CD6',        // Blue (tag names)
  codeVariable: '#9CDCFE',    // Light blue (variables)
  codeTitle: '#DCDCAA',       // Yellow (function/class declaration names)
  codeParams: '#9CDCFE',      // Light blue (function parameters)
  codeAddition: '#B5CEA8',    // Light green (diff additions)
  codeDeletion: '#CE9178',    // Orange-brown (diff deletions)
};

// ---------------------------------------------------------------------------
// Config loading (synchronous, runs once at startup)
// ---------------------------------------------------------------------------

function readJsonField(filePath: string, field: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>)[field];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }
  } catch {
    // File doesn't exist or invalid JSON — silently fall back
  }
  return null;
}

export function loadThemeConfig(): ThemeConfig {
  const globalTheme = readJsonField(join(homedir(), '.vesper', 'config.json'), 'theme');
  const projectTheme = readJsonField(resolve(process.cwd(), '.vesper', 'config.json'), 'theme');

  return {
    ...VSCODE_DARK_PLUS,
    ...(globalTheme as Partial<ThemeConfig> | null),
    ...(projectTheme as Partial<ThemeConfig> | null),
  };
}

// ---------------------------------------------------------------------------
// Exported singleton — all components import this
// ---------------------------------------------------------------------------

export const theme: ThemeConfig = loadThemeConfig();
