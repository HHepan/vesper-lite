// =============================================================================
// Vesper WebUI — Theme System (browser-compatible port of TUI theme.ts)
//
// All color tokens live here. Components import the `theme` singleton.
// Default palette: VSCode Dark+ terminal ANSI hex colors.
//
// Users can override via localStorage('lux-theme') or config panel.
// =============================================================================

// ---------------------------------------------------------------------------
// ThemeConfig — semantic color tokens (identical to TUI)
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
  statusSupervisor: string;
  statusProvider: string;

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

  // System messages
  systemDot: string;
  systemLabel: string;
  systemText: string;

  // Cross-session link messages
  linkMessageDot: string;
  linkMessageText: string;

  // Autocomplete menu
  autocompleteHighlight: string;
  autocompleteCommand: string;
  autocompleteDescription: string;

  // Misc
  streamingCursor: string;
  treeBorder: string;

  // Background colors
  bgPrimary: string;
  bgOverlay: string;

  // Markdown
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

  // Code syntax highlighting
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
// Default theme: Warm Dark palette (One Dark Pro inspired, softened & warmed)
// 
// Design goals:
// - Lighter background (#282C34) — less "black", more breathable
// - Lower contrast text (#D4D4D4) — easier on the eyes
// - Warmer blues (#4FA6C7) — less cold/tool-like
// - Softer borders (#3E4452) — less harsh edges
// ---------------------------------------------------------------------------

export const VSCODE_DARK_PLUS: ThemeConfig = {
  // Chrome — softened borders
  separator: '#4B5263',       // softer than #505050
  border: '#ABB2BF',          // softer than #888888
  dimText: '#5C6370',         // warmer gray than #999999

  // User input
  promptMarker: '#ABB2BF',    // softer prompt marker
  promptText: '#D4D4D4',      // slightly dimmed from #FFFFFF
  promptBg: '#D4E8F2',

  // Assistant output — warm coral orange
  assistantDot: '#E5A07B',    // warmer, softer claude orange

  // Thinking — warm coral
  thinkingDot: '#E5A07B',     // warmer coral
  thinkingLabel: '#E5A07B',   // warmer coral
  thinkingContent: '#5C6370', // warmer gray

  // Tool calls — warmer blue-purple
  toolName: '#B8C0E8',        // warmer suggestion
  toolSuccess: '#5EB76B',     // warmer success green
  toolError: '#E06C75',       // softer red
  toolPending: '#5C6370',     // warmer gray
  toolArgs: '#5C6370',        // warmer gray
  toolResult: '#5C6370',      // warmer gray

  // Status bar
  statusModel: '#5C6370',     // warmer gray
  statusBudgetNormal: '#5C6370',
  statusBudgetWarn: '#D19A66', // warmer amber
  statusBudgetCritical: '#E06C75', // softer red
  statusStack: '#C678DD',     // warmer purple
  statusSupervisor: '#D19A66', // warmer amber (supervisor mode indicator)
  statusProvider: '#56B6C2',  // warmer cyan (provider label)

  // Pending sidebands — warm amber
  pendingIcon: '#D19A66',
  pendingText: '#D19A66',

  // Permission dialog — warmer blue-purple
  permissionBorder: '#B8C0E8',  // warmer permission
  permissionHeader: '#B8C0E8',
  permissionTool: '#5BA8D0',    // warmer ide blue
  permissionAllowOnce: '#5EB76B', // warmer success
  permissionAllowAlways: '#5BA8D0', // warmer ide
  permissionDeny: '#E06C75',    // softer red

  // Ask user dialog
  askUserBorder: '#B8C0E8',     // warmer permission
  askUserHeader: '#B8C0E8',
  askUserQuestion: '#D4D4D4',   // softer text
  askUserOptionLabel: '#B8C0E8', // warmer suggestion
  askUserOptionDesc: '#5C6370', // warmer gray
  askUserSelected: '#5EB76B',   // warmer success
  askUserOther: '#C678DD',      // warmer purple
  askUserChip: '#5BA8D0',       // warmer ide

  // Agent spinner — warm coral
  spinnerActive: '#E5A07B',     // warmer coral
  spinnerIdle: '#5C6370',       // warmer gray
  spinnerHueCycling: true,

  // Welcome banner — warmer tones
  bannerMascot: '#4FA6C7',      // warmer cyan
  bannerTitle: '#D4D4D4',       // softer text
  bannerSubtext: '#5C6370',     // warmer gray
  bannerBorder: '#3E4452',      // softer border

  // Errors
  errorText: '#E06C75',         // softer red
  errorDot: '#E06C75',

  // Task panel
  taskPanelTree: '#4B5263',     // softer subtle
  taskDone: '#5EB76B',          // warmer success
  taskInProgress: '#D19A66',    // warmer amber
  taskPending: '#D4D4D4',       // softer text
  taskHeader: '#5C6370',        // warmer gray
  taskActiveForm: '#C678DD',    // warmer purple
  taskTitleStar: '#E5A07B',     // warmer coral

  // Canvas browser — warmer ide blue
  canvasBrowserBorder: '#5BA8D0',
  canvasBrowserHeader: '#5BA8D0',
  canvasBrowserSelected: '#D4D4D4',
  canvasBrowserFolded: '#5C6370',
  canvasBrowserPinned: '#D19A66', // warmer amber
  canvasBrowserTokens: '#5C6370',

  // System messages — warmer ide blue
  systemDot: '#5BA8D0',
  systemLabel: '#5BA8D0',
  systemText: '#5C6370',

  // Cross-session link messages — warm amber/gold
  linkMessageDot: '#E5A55B',    // warmer gold
  linkMessageText: '#ABB2BF',

  // Autocomplete menu
  autocompleteHighlight: '#3E4759', // warmer highlight bg
  autocompleteCommand: '#B8C0E8',   // warmer suggestion
  autocompleteDescription: '#5C6370',

  // Misc
  streamingCursor: '#E5A07B',   // warmer coral
  treeBorder: '#4B5263',        // softer subtle

  // Background colors
  bgPrimary: '#282C34',         // main background
  bgOverlay: 'rgba(0, 0, 0, 0.2)', // semi-transparent overlay

  // Markdown
  mdHeading: '#5EB76B',         // warmer success
  mdFirstHeading: '#C678DD',    // warmer purple
  mdCode: '#E5A07B',            // warmer coral
  mdCodespan: '#E5A07B',        // warmer coral
  mdBlockquote: '#5C6370',      // warmer gray
  mdLink: '#5BA8D0',            // warmer ide
  mdHref: '#5BA8D0',

  // Diff view — warmer tones
  diffAdded: '#5EB76B',         // warmer green
  diffRemoved: '#E06C75',       // softer red
  diffAddedBg: '#2D4A3E',       // warmer added bg
  diffRemovedBg: '#4A2D3A',     // warmer removed bg
  diffAddedHighlight: '#5EB76B',
  diffRemovedHighlight: '#E06C75',
  diffContent: '#D4D4D4',       // softer text
  diffContext: '#5C6370',       // warmer gray
  diffHunkHeader: '#6FA0C8',    // warmer professional blue
  diffLineNumber: '#4B5263',    // softer subtle
  diffFilePath: '#B8C0E8',      // warmer suggestion

  // Code syntax highlighting (One Dark Pro palette)
  codeKeyword: '#C678DD',       // warmer purple
  codeString: '#98C379',        // warmer green
  codeNumber: '#D19A66',        // warmer amber
  codeComment: '#5C6370',       // warmer gray
  codeFunction: '#61AFEF',      // warmer blue
  codeBuiltIn: '#56B6C2',       // warmer cyan
  codeLiteral: '#C678DD',       // warmer purple
  codeType: '#56B6C2',          // warmer cyan
  codeRegexp: '#E06C75',        // softer red
  codeMeta: '#ABB2BF',          // warmer gray
  codeTag: '#E06C75',           // softer red
  codeAttr: '#D19A66',          // warmer amber
  codeName: '#E06C75',          // softer red
  codeVariable: '#E5C07B',      // warmer yellow
  codeTitle: '#61AFEF',         // warmer blue
  codeParams: '#ABB2BF',        // warmer gray
  codeAddition: '#98C379',      // warmer green
  codeDeletion: '#E06C75',      // softer red
};

// ---------------------------------------------------------------------------
// Light theme: Soft Warm Light (inspired by One Light, but gentler)
//
// Design goals:
// - Soft warm background (#F8F7F4) — ivory white, not blinding
// - Warm gray tones — less harsh than pure white
// - Muted accents — comfortable for extended use
// - No "flashbang" effect when switching from dark mode
// ---------------------------------------------------------------------------

export const VSCODE_LIGHT_PLUS: ThemeConfig = {
  // Chrome — warm paper & slate teal borders
  separator: '#E6E4DD',
  border: '#DFDCD4',
  dimText: '#78756F',         // elegant warm gray for secondary text

  // User input
  promptMarker: '#1B4D44',    // deep slate teal
  promptText: '#1F2421',
  promptBg: '#EBE8DF',        // distinct warm slate/linen card tint that separates clearly from #FAF9F6 canvas

  // Assistant output — warm terracotta
  assistantDot: '#C86B4D',

  // Thinking — deep teal & terracotta
  thinkingDot: '#2A6A5E',
  thinkingLabel: '#2A6A5E',
  thinkingContent: '#706D67',

  // Tool calls — slate teal & elegant status colors
  toolName: '#24584E',        // slate teal
  toolSuccess: '#2E7D47',     // forest green
  toolError: '#C53939',       // deep crimson
  toolPending: '#78756F',
  toolArgs: '#5A5752',
  toolResult: '#5A5752',

  // Status bar
  statusModel: '#6E6B65',
  statusBudgetNormal: '#6E6B65',
  statusBudgetWarn: '#B87832',
  statusBudgetCritical: '#C53939',
  statusStack: '#6A5490',
  statusSupervisor: '#B87832',
  statusProvider: '#24584E',

  // Pending sidebands
  pendingIcon: '#B87832',
  pendingText: '#B87832',

  // Permission dialog — deep slate teal theme
  permissionBorder: '#24584E',
  permissionHeader: '#24584E',
  permissionTool: '#24584E',
  permissionAllowOnce: '#2E7D47',
  permissionAllowAlways: '#24584E',
  permissionDeny: '#C53939',

  // Ask user dialog
  askUserBorder: '#24584E',
  askUserHeader: '#24584E',
  askUserQuestion: '#1F2421',
  askUserOptionLabel: '#24584E',
  askUserOptionDesc: '#78756F',
  askUserSelected: '#2E7D47',
  askUserOther: '#6A5490',
  askUserChip: '#24584E',

  // Agent spinner
  spinnerActive: '#24584E',
  spinnerIdle: '#78756F',
  spinnerHueCycling: false,

  // Welcome banner — slate teal brand
  bannerMascot: '#24584E',
  bannerTitle: '#1F2421',
  bannerSubtext: '#78756F',
  bannerBorder: '#E6E4DD',

  // Errors
  errorText: '#C53939',
  errorDot: '#C53939',

  // Task panel
  taskPanelTree: '#DFDCD4',
  taskDone: '#2E7D47',
  taskInProgress: '#B87832',
  taskPending: '#1F2421',
  taskHeader: '#78756F',
  taskActiveForm: '#6A5490',
  taskTitleStar: '#24584E',

  // Canvas browser
  canvasBrowserBorder: '#24584E',
  canvasBrowserHeader: '#24584E',
  canvasBrowserSelected: '#1F2421',
  canvasBrowserFolded: '#78756F',
  canvasBrowserPinned: '#B87832',
  canvasBrowserTokens: '#78756F',

  // System messages
  systemDot: '#24584E',
  systemLabel: '#24584E',
  systemText: '#78756F',

  // Cross-session link messages
  linkMessageDot: '#B87832',
  linkMessageText: '#4E4B46',

  // Autocomplete menu
  autocompleteHighlight: '#EAE7E0',
  autocompleteCommand: '#24584E',
  autocompleteDescription: '#78756F',

  // Misc
  streamingCursor: '#24584E',
  treeBorder: '#DFDCD4',

  // Background colors — soft warm ivory/linen
  bgPrimary: '#FAF9F6',
  bgOverlay: 'rgba(27, 77, 68, 0.05)',

  // Markdown
  mdHeading: '#1B4D44',
  mdFirstHeading: '#1B4D44',
  mdCode: '#24584E',
  mdCodespan: '#24584E',
  mdBlockquote: '#78756F',
  mdLink: '#1B4D44',
  mdHref: '#1B4D44',

  // Diff view
  diffAdded: '#1B6A35',
  diffRemoved: '#C53939',
  diffAddedBg: '#E9F5ED',
  diffRemovedBg: '#FCEBEA',
  diffAddedHighlight: '#C3E7CD',
  diffRemovedHighlight: '#F8C8C6',
  diffContent: '#1F2421',
  diffContext: '#78756F',
  diffHunkHeader: '#24584E',
  diffLineNumber: '#DFDCD4',
  diffFilePath: '#24584E',

  // Code syntax highlighting
  codeKeyword: '#793B98',
  codeString: '#286F44',
  codeNumber: '#A07838',
  codeComment: '#7A7B7B',
  codeFunction: '#4B7D98',
  codeBuiltIn: '#4B8B8B',
  codeLiteral: '#9B4BA4',
  codeType: '#4B8B8B',
  codeRegexp: '#B84B4B',
  codeMeta: '#4A4744',
  codeTag: '#B84B4B',
  codeAttr: '#A07838',
  codeName: '#B84B4B',
  codeVariable: '#A07838',
  codeTitle: '#4B7D98',
  codeParams: '#4A4744',
  codeAddition: '#2B754B',
  codeDeletion: '#B84B4B',
};

// ---------------------------------------------------------------------------
// Config loading (browser-compatible: localStorage + optional fetch)
// ---------------------------------------------------------------------------

export function loadThemeConfig(): ThemeConfig {
  // Detect current theme from DOM or localStorage
  let themeName: 'dark' | 'light' = 'dark';
  
  // Check localStorage first
  try {
    const stored = localStorage.getItem('lux-theme-name');
    if (stored === 'light' || stored === 'dark') {
      themeName = stored;
    }
  } catch {
    // Ignore
  }
  
  // Check DOM data-theme attribute (may override localStorage if set)
  if (typeof document !== 'undefined') {
    const domTheme = document.documentElement.getAttribute('data-theme');
    if (domTheme === 'light' || domTheme === 'dark') {
      themeName = domTheme;
    }
  }
  
  // Select base theme
  const baseTheme = themeName === 'light' ? VSCODE_LIGHT_PLUS : VSCODE_DARK_PLUS;
  
  // Apply user overrides
  let overrides: Partial<ThemeConfig> = {};
  try {
    const stored = localStorage.getItem('lux-theme');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed === 'object' && parsed !== null) {
        overrides = parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }

  return { ...baseTheme, ...overrides };
}

// ---------------------------------------------------------------------------
// Get theme by name (for dynamic theme switching)
// ---------------------------------------------------------------------------

export function getThemeByName(name: 'dark' | 'light'): ThemeConfig {
  const baseTheme = name === 'light' ? VSCODE_LIGHT_PLUS : VSCODE_DARK_PLUS;
  
  // Apply user overrides
  let overrides: Partial<ThemeConfig> = {};
  try {
    const stored = localStorage.getItem('lux-theme');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed === 'object' && parsed !== null) {
        overrides = parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }

  return { ...baseTheme, ...overrides };
}

// ---------------------------------------------------------------------------
// Exported singleton — all components import this
// Uses CSS variables for dynamic theme support
// ---------------------------------------------------------------------------

// Create a theme config that uses CSS variables instead of hardcoded colors
// This allows the theme to respond to data-theme attribute changes
const CSS_VAR_THEME: ThemeConfig = {
  // Chrome
  separator: 'var(--separator-color)',
  border: 'var(--border-color)',
  dimText: 'var(--text-muted)',

  // User input
  promptMarker: 'var(--prompt-marker)',
  promptText: 'var(--prompt-text)',
  promptBg: 'var(--prompt-bg)',

  // Assistant output
  assistantDot: 'var(--assistant-dot)',

  // Thinking
  thinkingDot: 'var(--thinking-dot)',
  thinkingLabel: 'var(--thinking-label)',
  thinkingContent: 'var(--thinking-content)',

  // Tool calls
  toolName: 'var(--tool-name)',
  toolSuccess: 'var(--tool-success)',
  toolError: 'var(--tool-error)',
  toolPending: 'var(--tool-pending)',
  toolArgs: 'var(--tool-args)',
  toolResult: 'var(--tool-result)',

  // Status bar
  statusModel: 'var(--statusbar-model)',
  statusBudgetNormal: 'var(--statusbar-budget-normal)',
  statusBudgetWarn: 'var(--statusbar-budget-warn)',
  statusBudgetCritical: 'var(--statusbar-budget-critical)',
  statusStack: 'var(--statusbar-stack)',
  statusSupervisor: 'var(--statusbar-supervisor)',
  statusProvider: 'var(--statusbar-provider)',

  // Pending sidebands
  pendingIcon: 'var(--pending-icon)',
  pendingText: 'var(--pending-text)',

  // Permission dialog
  permissionBorder: 'var(--permission-border)',
  permissionHeader: 'var(--permission-header)',
  permissionTool: 'var(--permission-tool)',
  permissionAllowOnce: 'var(--permission-allow-once)',
  permissionAllowAlways: 'var(--permission-allow-always)',
  permissionDeny: 'var(--permission-deny)',

  // Ask user dialog
  askUserBorder: 'var(--askuser-border)',
  askUserHeader: 'var(--askuser-header)',
  askUserQuestion: 'var(--askuser-question)',
  askUserOptionLabel: 'var(--askuser-option-label)',
  askUserOptionDesc: 'var(--askuser-option-desc)',
  askUserSelected: 'var(--askuser-selected)',
  askUserOther: 'var(--askuser-other)',
  askUserChip: 'var(--askuser-chip)',

  // Agent spinner
  spinnerActive: 'var(--spinner-active)',
  spinnerIdle: 'var(--spinner-idle)',
  spinnerHueCycling: true,

  // Welcome banner
  bannerMascot: 'var(--banner-mascot)',
  bannerTitle: 'var(--banner-title)',
  bannerSubtext: 'var(--banner-subtext)',
  bannerBorder: 'var(--banner-border)',

  // Errors
  errorText: 'var(--error-text)',
  errorDot: 'var(--error-dot)',

  // Task panel
  taskPanelTree: 'var(--task-tree)',
  taskDone: 'var(--task-done)',
  taskInProgress: 'var(--task-in-progress)',
  taskPending: 'var(--task-pending)',
  taskHeader: 'var(--task-header)',
  taskActiveForm: 'var(--task-active-form)',
  taskTitleStar: 'var(--task-title-star)',

  // Canvas browser
  canvasBrowserBorder: 'var(--canvas-border)',
  canvasBrowserHeader: 'var(--canvas-header)',
  canvasBrowserSelected: 'var(--canvas-selected)',
  canvasBrowserFolded: 'var(--canvas-folded)',
  canvasBrowserPinned: 'var(--canvas-pinned)',
  canvasBrowserTokens: 'var(--canvas-tokens)',

  // System messages
  systemDot: 'var(--system-dot)',
  systemLabel: 'var(--system-label)',
  systemText: 'var(--system-text)',

  // Cross-session link messages
  linkMessageDot: 'var(--accent-orange)',
  linkMessageText: 'var(--text-secondary)',

  // Autocomplete menu
  autocompleteHighlight: 'var(--autocomplete-highlight)',
  autocompleteCommand: 'var(--autocomplete-command)',
  autocompleteDescription: 'var(--autocomplete-description)',

  // Misc
  streamingCursor: 'var(--streaming-cursor)',
  treeBorder: 'var(--tree-border)',

  // Background colors
  bgPrimary: 'var(--bg-primary)',
  bgOverlay: 'var(--bg-overlay)',

  // Markdown
  mdHeading: 'var(--md-heading)',
  mdFirstHeading: 'var(--md-first-heading)',
  mdCode: 'var(--md-code)',
  mdCodespan: 'var(--md-codespan)',
  mdBlockquote: 'var(--md-blockquote)',
  mdLink: 'var(--md-link)',
  mdHref: 'var(--md-href)',

  // Diff view
  diffAdded: 'var(--diff-added)',
  diffRemoved: 'var(--diff-removed)',
  diffAddedBg: 'var(--diff-added-bg)',
  diffRemovedBg: 'var(--diff-removed-bg)',
  diffAddedHighlight: 'var(--diff-added-highlight)',
  diffRemovedHighlight: 'var(--diff-removed-highlight)',
  diffContent: 'var(--diff-content)',
  diffContext: 'var(--diff-context)',
  diffHunkHeader: 'var(--diff-hunk-header)',
  diffLineNumber: 'var(--diff-line-number)',
  diffFilePath: 'var(--diff-file-path)',

  // Code syntax highlighting
  codeKeyword: 'var(--code-keyword)',
  codeString: 'var(--code-string)',
  codeNumber: 'var(--code-number)',
  codeComment: 'var(--code-comment)',
  codeFunction: 'var(--code-function)',
  codeBuiltIn: 'var(--code-builtin)',
  codeLiteral: 'var(--code-literal)',
  codeType: 'var(--code-type)',
  codeRegexp: 'var(--code-regexp)',
  codeMeta: 'var(--code-meta)',
  codeTag: 'var(--code-tag)',
  codeAttr: 'var(--code-attr)',
  codeName: 'var(--code-name)',
  codeVariable: 'var(--code-variable)',
  codeTitle: 'var(--code-title)',
  codeParams: 'var(--code-params)',
  codeAddition: 'var(--code-addition)',
  codeDeletion: 'var(--code-deletion)',
};

export const theme: ThemeConfig = CSS_VAR_THEME;
