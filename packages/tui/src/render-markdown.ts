// =============================================================================
// Vesper TUI -- Markdown -> ANSI renderer (for frozen text blocks)
//
// Uses `marked` + `marked-terminal` to convert Markdown to ANSI-colored
// terminal strings. Colors are driven by the theme singleton.
// Only used for completed (frozen) text output -- streaming text stays plain
// to avoid partial-Markdown rendering artifacts.
// =============================================================================

import { marked, type MarkedExtension } from 'marked';
// @ts-expect-error -- marked-terminal has no type declarations
import { markedTerminal } from 'marked-terminal';
import { Chalk } from 'chalk';
import { theme } from './theme.js';

// Force truecolor support — Ink manages its own color output, so chalk's
// automatic TTY detection (which runs at module-load time before Ink takes
// over stdout) is unreliable and often returns level=0.
const chk = new Chalk({ level: 3 });

// Build cli-highlight theme from theme tokens (VSCode Dark+ syntax colors)
const codeTheme: Record<string, (s: string) => string> = {
  keyword:   chk.hex(theme.codeKeyword).bold,
  built_in:  chk.hex(theme.codeBuiltIn),
  type:      chk.hex(theme.codeType),
  literal:   chk.hex(theme.codeLiteral),
  number:    chk.hex(theme.codeNumber),
  regexp:    chk.hex(theme.codeRegexp),
  string:    chk.hex(theme.codeString),
  function:  chk.hex(theme.codeFunction),
  title:     chk.hex(theme.codeTitle),
  params:    chk.hex(theme.codeParams),
  comment:   chk.hex(theme.codeComment).italic,
  doctag:    chk.hex(theme.codeComment).bold,
  meta:      chk.hex(theme.codeMeta),
  tag:       chk.hex(theme.codeTag),
  name:      chk.hex(theme.codeName),
  attr:      chk.hex(theme.codeAttr),
  variable:  chk.hex(theme.codeVariable),
  addition:  chk.hex(theme.codeAddition),
  deletion:  chk.hex(theme.codeDeletion),
};

// Build chalk style functions from theme hex colors for Markdown elements,
// and pass cli-highlight theme as the second argument for fenced code blocks.
marked.use(markedTerminal({
  heading: chk.hex(theme.mdHeading).bold,
  firstHeading: chk.hex(theme.mdFirstHeading).bold,
  code: chk.hex(theme.mdCode),
  codespan: chk.hex(theme.mdCodespan),
  blockquote: chk.hex(theme.mdBlockquote).italic,
  link: chk.hex(theme.mdLink),
  href: chk.hex(theme.mdHref).underline,
}, {
  theme: codeTheme,
}) as MarkedExtension);

/**
 * Render a Markdown string to ANSI-colored terminal text.
 * Returns the original string unchanged if rendering fails.
 */
export function renderMarkdown(text: string): string {
  try {
    const rendered = marked.parse(text, { async: false }) as string;
    // Trim trailing whitespace/newlines that marked adds
    return rendered.replace(/\n+$/, '');
  } catch {
    return text;
  }
}
