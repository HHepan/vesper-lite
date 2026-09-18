// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Tools Barrel + createCoreTools()
// ═══════════════════════════════════════════════════════════════════════════

import type { ToolEntry } from '@vesper/shared';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { writeMdTool } from './write-md.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';

export { readTool, readToolDef, readExecutor } from './read.js';
export { writeTool, writeToolDef, writeExecutor } from './write.js';
export { writeMdTool, writeMdToolDef, writeMdExecutor } from './write-md.js';
export { editTool, editToolDef, editExecutor } from './edit.js';
export { globTool, globToolDef, globExecutor } from './glob.js';
export { grepTool, grepToolDef, grepExecutor } from './grep.js';
export { createNativeShellToolEntry, type ShellConfig, type ShellExecutor, type ShellExecResult, type ShellMeta } from './bash-bridge.js';
export { createScriptToolEntry, type ScriptToolConfig } from './script.js';
export { createTaskTools, type TaskStateAccessor } from './task-tools.js';
export { createAskUserTools, parseAskUserOp } from './ask-user-tools.js';
export { timeTool, timeToolDef, timeExecutor, formatCurrentTime } from './time-tool.js';
export { fetchTool, fetchToolDef, fetchExecutor, createFetchToolEntry } from './fetch.js';
export { webSearchTool, webSearchToolDef, webSearchExecutor, createWebSearchToolEntry } from './search.js';
export { listAllToolsets, getToolset, INFRASTRUCTURE_TOOLS, initBuiltinToolsets } from './toolset.js';

/**
 * Create the core file tool entries (definition + executor pairs).
 */
export function createCoreTools(): ToolEntry[] {
  return [readTool, writeTool, writeMdTool, editTool, globTool, grepTool];
}
