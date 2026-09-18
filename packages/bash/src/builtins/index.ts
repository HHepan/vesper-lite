// ═══════════════════════════════════════════════════════════════════════════
// @vesper/bash — Builtin Command Registry
// ═══════════════════════════════════════════════════════════════════════════

import type { BuiltinFn } from '../types.js';
import { fsBuiltins } from './fs.js';
import { textBuiltins } from './text.js';
import { navBuiltins } from './nav.js';
import { envBuiltins } from './env.js';
import { utilsBuiltins } from './utils.js';

export const builtins: Record<string, BuiltinFn> = {
  ...fsBuiltins,
  ...textBuiltins,
  ...navBuiltins,
  ...envBuiltins,
  ...utilsBuiltins,
};

export function getBuiltin(name: string): BuiltinFn | undefined {
  return builtins[name];
}

export function listBuiltins(): string[] {
  return Object.keys(builtins);
}
