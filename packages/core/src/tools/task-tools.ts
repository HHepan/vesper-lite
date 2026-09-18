// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Task List Tools
// 5 agent-facing tools for structured task tracking:
//   task_create, task_update, task_list, task_get, task_delete
// Auto-managed as a pinned canvas block (bottom zone) removed when all completed.
// ═══════════════════════════════════════════════════════════════════════════

import type { AgentState, ToolDefinition, ToolResult, ToolExecutor, ToolEntry, TaskItem, TaskStatus, CanvasBlock } from '@vesper/shared';
import { upsertBlock } from '../canvas.js';
import { countTokens } from '../tokenizer/index.js';
import { TOOL_DESC } from '../prompts.js';

// ---------------------------------------------------------------------------
// State Accessor
// ---------------------------------------------------------------------------

export interface TaskStateAccessor {
  getState(): AgentState;
  setState(state: AgentState): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASK_BLOCK_ID = '__task_list__';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recompute derived `blocks` field from all items' `blockedBy`.
 */
function recomputeBlocks(tasks: TaskItem[]): TaskItem[] {
  const blocksMap = new Map<string, string[]>();
  for (const t of tasks) {
    for (const bid of t.blockedBy ?? []) {
      const arr = blocksMap.get(bid) ?? [];
      arr.push(t.id);
      blocksMap.set(bid, arr);
    }
  }
  return tasks.map(t => {
    const derived = blocksMap.get(t.id);
    return { ...t, blocks: derived?.length ? derived : undefined };
  });
}

/**
 * Check if a task is blocked (any blocker not `completed`).
 */
function isBlocked(task: TaskItem, all: TaskItem[]): boolean {
  if (!task.blockedBy?.length) return false;
  return task.blockedBy.some(id => {
    const b = all.find(t => t.id === id);
    return b && b.status !== 'completed';
  });
}

/**
 * Serialize task items into a human-readable pinned block content.
 */
function serializeTaskList(tasks: TaskItem[]): string {
  const doneCount = tasks.filter((t) => t.status === 'completed').length;
  const lines: string[] = [`Task List (${doneCount}/${tasks.length} done)`];

  for (const task of tasks) {
    const blocked = isBlocked(task, tasks);
    const marker = task.status === 'completed' ? '[x]' : task.status === 'in_progress' ? '[~]' : blocked ? '[B]' : '[ ]';
    const ownerTag = task.owner ? ` [O:${task.owner}]` : '';
    lines.push(`- ${marker} ${task.subject}${ownerTag}`);
    if (blocked && task.blockedBy?.length) {
      const blockerNames = task.blockedBy.map(bid => {
        const blocker = tasks.find(t => t.id === bid);
        return blocker ? blocker.subject : bid;
      });
      lines.push(`      blocked by: ${blockerNames.join(', ')}`);
    }
    if (task.description) {
      lines.push(`      ${task.description}`);
    }
  }

  return lines.join('\n');
}

/**
 * Sync the task list pinned block with the current state.
 * - If no tasks or all completed → remove the pinned block
 * - Otherwise → upsert the pinned block with serialized content (bottom pin zone)
 */
function syncTaskPin(state: AgentState): AgentState {
  const { tasks } = state;
  const allCompleted = tasks.length > 0 && tasks.every((t) => t.status === 'completed');

  if (tasks.length === 0 || allCompleted) {
    // Remove the task pinned block AND clear the task array
    const blocks = state.canvas.blocks.filter((b) => b.id !== TASK_BLOCK_ID);
    return { ...state, tasks: [], canvas: { blocks } };
  }

  // Serialize and upsert
  const content = serializeTaskList(tasks);
  const block: CanvasBlock = {
    id: TASK_BLOCK_ID,
    type: 'pin',
    content,
    tokens: countTokens(content),
    timestamp: Date.now(),
    pinned: true,
    folded: false,
    foldable: false,
    pinZone: 'bottom',
  };

  return { ...state, canvas: upsertBlock(state.canvas, block) };
}

// ---------------------------------------------------------------------------
// task_create
// ---------------------------------------------------------------------------

function createTaskCreateTool(accessor: TaskStateAccessor): ToolEntry {
  const definition: ToolDefinition = {
    name: 'task_create',
    description: TOOL_DESC.task_create,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: TOOL_DESC.task_create_id,
        },
        subject: {
          type: 'string',
          description: TOOL_DESC.task_create_subject,
        },
        description: {
          type: 'string',
          description: TOOL_DESC.task_create_description,
        },
        blocked_by: {
          type: 'array',
          items: { type: 'string' },
          description: TOOL_DESC.task_create_blocked_by,
        },
        metadata: {
          type: 'object',
          description: TOOL_DESC.task_create_metadata,
        },
        active_form: {
          type: 'string',
          description: TOOL_DESC.task_create_active_form,
        },
      },
      required: ['id', 'subject'],
    },
  };

  const executor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
    const id = args.id as string;
    const subject = args.subject as string;
    if (!id || id.trim().length === 0) {
      return { content: 'Error: id must be a non-empty string.', isError: true };
    }
    if (!subject || subject.trim().length === 0) {
      return { content: 'Error: subject must be a non-empty string.', isError: true };
    }

    const trimmedId = id.trim();
    let state = accessor.getState();

    // Duplicate check
    if (state.tasks.some(t => t.id === trimmedId)) {
      return { content: `Error: task "${trimmedId}" already exists. Choose a unique id.`, isError: true };
    }

    const now = Date.now();
    const item: TaskItem = {
      id: trimmedId,
      subject: subject.trim(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    if (args.description && typeof args.description === 'string' && args.description.trim().length > 0) {
      item.description = args.description.trim();
    }

    // Handle blocked_by
    if (Array.isArray(args.blocked_by) && args.blocked_by.length > 0) {
      const validIds = args.blocked_by.filter((bid: string) =>
        typeof bid === 'string' && state.tasks.some(t => t.id === bid)
      );
      if (validIds.length > 0) {
        item.blockedBy = validIds;
      }
    }

    // Handle metadata
    if (args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)) {
      item.metadata = args.metadata as Record<string, unknown>;
    }

    // Handle active_form
    if (args.active_form && typeof args.active_form === 'string' && args.active_form.trim().length > 0) {
      item.metadata = { ...(item.metadata ?? {}), activeForm: args.active_form.trim() };
    }

    let newTasks = [...state.tasks, item];
    newTasks = recomputeBlocks(newTasks);
    state = { ...state, tasks: newTasks };
    state = syncTaskPin(state);
    accessor.setState(state);

    return {
      content: `Created task "${item.id}" — "${item.subject}" (pending). ${state.tasks.length} total.`,
    };
  };

  return { definition, executor };
}

// ---------------------------------------------------------------------------
// task_update
// ---------------------------------------------------------------------------

function createTaskUpdateTool(accessor: TaskStateAccessor): ToolEntry {
  const definition: ToolDefinition = {
    name: 'task_update',
    description: TOOL_DESC.task_update,
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: TOOL_DESC.task_update_task_id,
        },
        status: {
          type: 'string',
          description: TOOL_DESC.task_update_status,
        },
        subject: {
          type: 'string',
          description: TOOL_DESC.task_update_subject,
        },
        description: {
          type: 'string',
          description: TOOL_DESC.task_update_description,
        },
        add_blocked_by: {
          type: 'array',
          items: { type: 'string' },
          description: TOOL_DESC.task_update_add_blocked_by,
        },
        add_blocks: {
          type: 'array',
          items: { type: 'string' },
          description: TOOL_DESC.task_update_add_blocks,
        },
        owner: {
          type: 'string',
          description: TOOL_DESC.task_update_owner,
        },
        metadata: {
          type: 'object',
          description: TOOL_DESC.task_update_metadata,
        },
        active_form: {
          type: 'string',
          description: TOOL_DESC.task_update_active_form,
        },
      },
      required: ['task_id'],
    },
  };

  const executor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
    const id = args.task_id as string;
    const rawStatus = args.status as string | undefined;
    const newSubject = args.subject as string | undefined;
    const newDescription = args.description as string | undefined;
    const addBlockedBy = args.add_blocked_by as string[] | undefined;
    const addBlocksIds = args.add_blocks as string[] | undefined;
    const newOwner = args.owner as string | undefined;
    const newMetadata = args.metadata as Record<string, unknown> | undefined;
    const newActiveForm = args.active_form as string | undefined;

    const hasUpdate = rawStatus || newSubject || newDescription !== undefined ||
      addBlockedBy?.length || addBlocksIds?.length || newOwner !== undefined || newMetadata || newActiveForm !== undefined;

    if (!hasUpdate) {
      return { content: 'Error: at least one of status, subject, description, add_blocked_by, add_blocks, owner, metadata, or active_form must be provided.', isError: true };
    }

    if (rawStatus && !['pending', 'in_progress', 'completed', 'deleted'].includes(rawStatus)) {
      return { content: `Error: invalid status "${rawStatus}". Must be "pending", "in_progress", "completed", or "deleted".`, isError: true };
    }

    let state = accessor.getState();
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx < 0) {
      return { content: `Error: task "${id}" not found.`, isError: true };
    }

    // Handle deletion via status: 'deleted'
    if (rawStatus === 'deleted') {
      let newTasks = state.tasks.filter(t => t.id !== id);
      // Clean up blockedBy references
      newTasks = newTasks.map(t => {
        if (t.blockedBy?.includes(id)) {
          return { ...t, blockedBy: t.blockedBy.filter(bid => bid !== id) };
        }
        return t;
      });
      newTasks = recomputeBlocks(newTasks);
      state = { ...state, tasks: newTasks };
      state = syncTaskPin(state);
      accessor.setState(state);
      return { content: `Deleted task "${id}". ${state.tasks.length} remaining.` };
    }

    const existing = state.tasks[idx];
    const updated: TaskItem = {
      ...existing,
      updatedAt: Date.now(),
    };
    if (rawStatus) updated.status = rawStatus as TaskStatus;
    if (newSubject && newSubject.trim().length > 0) updated.subject = newSubject.trim();
    if (newDescription !== undefined) {
      updated.description = newDescription.trim().length > 0 ? newDescription.trim() : undefined;
    }
    if (newOwner !== undefined) {
      updated.owner = newOwner.trim().length > 0 ? newOwner.trim() : undefined;
    }

    // add_blocked_by — append to this item's blockedBy
    if (addBlockedBy?.length) {
      const existingBlockedBy = new Set(updated.blockedBy ?? []);
      for (const bid of addBlockedBy) {
        if (typeof bid === 'string' && bid !== id) existingBlockedBy.add(bid);
      }
      updated.blockedBy = [...existingBlockedBy];
    }

    let newTasks = [...state.tasks];
    newTasks[idx] = updated;

    // add_blocks — for each target, add this item's ID to target's blockedBy
    if (addBlocksIds?.length) {
      for (const targetId of addBlocksIds) {
        const targetIdx = newTasks.findIndex(t => t.id === targetId);
        if (targetIdx >= 0 && targetId !== id) {
          const target = newTasks[targetIdx];
          const targetBlockedBy = new Set(target.blockedBy ?? []);
          targetBlockedBy.add(id);
          newTasks[targetIdx] = { ...target, blockedBy: [...targetBlockedBy] };
        }
      }
    }

    // Handle active_form — merge into metadata.activeForm
    if (newActiveForm !== undefined) {
      const merged = { ...(updated.metadata ?? {}) };
      if (newActiveForm.trim().length > 0) {
        merged.activeForm = newActiveForm.trim();
      } else {
        delete merged.activeForm;
      }
      updated.metadata = Object.keys(merged).length > 0 ? merged : undefined;
      newTasks[idx] = updated;
    }

    // metadata merge (null values delete keys)
    if (newMetadata) {
      const merged = { ...(updated.metadata ?? {}) };
      for (const [key, value] of Object.entries(newMetadata)) {
        if (value === null) {
          delete merged[key];
        } else {
          merged[key] = value;
        }
      }
      updated.metadata = Object.keys(merged).length > 0 ? merged : undefined;
      newTasks[idx] = updated;
    }

    newTasks = recomputeBlocks(newTasks);
    state = { ...state, tasks: newTasks };

    // Check all-completed BEFORE syncTaskPin clears the array
    const completedCount = newTasks.filter((t) => t.status === 'completed').length;
    const total = newTasks.length;
    const allDone = completedCount === total && total > 0;

    state = syncTaskPin(state);
    accessor.setState(state);

    let msg = `Updated "${id}" — status: ${updated.status}. ${completedCount}/${total} done.`;
    if (allDone) {
      msg += ' All tasks complete — task list unpinned.';
    }

    return { content: msg };
  };

  return { definition, executor };
}

// ---------------------------------------------------------------------------
// task_list
// ---------------------------------------------------------------------------

function createTaskListTool(accessor: TaskStateAccessor): ToolEntry {
  const definition: ToolDefinition = {
    name: 'task_list',
    description: TOOL_DESC.task_list,
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: TOOL_DESC.task_list_filter,
        },
      },
      required: [],
    },
  };

  const executor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
    const filter = (args.filter as string | undefined) ?? 'all';
    const state = accessor.getState();

    let items = state.tasks;
    if (filter !== 'all') {
      if (!['pending', 'in_progress', 'completed'].includes(filter)) {
        return { content: `Error: invalid filter "${filter}". Must be "pending", "in_progress", "completed", or "all".`, isError: true };
      }
      items = items.filter((t) => t.status === filter);
    }

    if (items.length === 0) {
      return { content: `Task List: 0 item(s) (filter: ${filter}).` };
    }

    const lines: string[] = [`Task List: ${items.length} item(s) (filter: ${filter})`];
    for (const item of items) {
      const blocked = isBlocked(item, state.tasks);
      const marker = item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[~]' : blocked ? '[B]' : '[ ]';
      const ownerTag = item.owner ? ` [O:${item.owner}]` : '';
      lines.push(`[${item.id}] ${marker} ${item.subject}${ownerTag}`);
      if (blocked && item.blockedBy?.length) {
        const blockerNames = item.blockedBy.map(bid => {
          const blocker = state.tasks.find(t => t.id === bid);
          return blocker ? blocker.subject : bid;
        });
        lines.push(`      blocked by: ${blockerNames.join(', ')}`);
      }
      if (item.description) {
        lines.push(`      ${item.description}`);
      }
    }

    return { content: lines.join('\n') };
  };

  return { definition, executor };
}

// ---------------------------------------------------------------------------
// task_get
// ---------------------------------------------------------------------------

function createTaskGetTool(accessor: TaskStateAccessor): ToolEntry {
  const definition: ToolDefinition = {
    name: 'task_get',
    description: TOOL_DESC.task_get,
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: TOOL_DESC.task_get_task_id,
        },
      },
      required: ['task_id'],
    },
  };

  const executor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
    const id = args.task_id as string;
    const state = accessor.getState();
    const task = state.tasks.find(t => t.id === id);

    if (!task) {
      return { content: `Error: task "${id}" not found.`, isError: true };
    }

    const blocked = isBlocked(task, state.tasks);
    const lines: string[] = [
      `Task: ${task.subject}`,
      `ID: ${task.id}`,
      `Status: ${task.status}${blocked ? ' (blocked)' : ''}`,
    ];
    if (task.description) lines.push(`Description: ${task.description}`);
    if (task.owner) lines.push(`Owner: ${task.owner}`);
    if (task.blockedBy?.length) {
      const blockerNames = task.blockedBy.map(bid => {
        const blocker = state.tasks.find(t => t.id === bid);
        return blocker ? `${blocker.subject} (${bid})` : bid;
      });
      lines.push(`Blocked by: ${blockerNames.join(', ')}`);
    }
    if (task.blocks?.length) {
      const blockNames = task.blocks.map(bid => {
        const blocked = state.tasks.find(t => t.id === bid);
        return blocked ? `${blocked.subject} (${bid})` : bid;
      });
      lines.push(`Blocks: ${blockNames.join(', ')}`);
    }
    if (task.metadata && Object.keys(task.metadata).length > 0) {
      lines.push(`Metadata: ${JSON.stringify(task.metadata)}`);
    }
    lines.push(`Created: ${new Date(task.createdAt).toISOString()}`);
    lines.push(`Updated: ${new Date(task.updatedAt).toISOString()}`);

    return { content: lines.join('\n') };
  };

  return { definition, executor };
}

// ---------------------------------------------------------------------------
// task_delete
// ---------------------------------------------------------------------------

function createTaskDeleteTool(accessor: TaskStateAccessor): ToolEntry {
  const definition: ToolDefinition = {
    name: 'task_delete',
    description: TOOL_DESC.task_delete,
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: TOOL_DESC.task_delete_task_id,
        },
        all: {
          type: 'boolean',
          description: TOOL_DESC.task_delete_all,
        },
      },
      required: [],
    },
  };

  const executor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
    const id = args.task_id as string | undefined;
    const clearAll = args.all as boolean | undefined;

    if (!id && !clearAll) {
      return { content: 'Error: provide either "task_id" to delete a specific task, or "all": true to clear the entire list.', isError: true };
    }

    let state = accessor.getState();

    if (clearAll) {
      state = { ...state, tasks: [] };
      // Remove the pinned block
      const blocks = state.canvas.blocks.filter((b) => b.id !== TASK_BLOCK_ID);
      state = { ...state, canvas: { blocks } };
      accessor.setState(state);
      return { content: 'Deleted all tasks. Task list cleared.' };
    }

    // Delete single task by ID
    const idx = state.tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      return { content: `Error: task "${id}" not found.`, isError: true };
    }

    let newTasks = state.tasks.filter(t => t.id !== id);
    // Clean up blockedBy references
    newTasks = newTasks.map(t => {
      if (t.blockedBy?.includes(id!)) {
        return { ...t, blockedBy: t.blockedBy.filter(bid => bid !== id) };
      }
      return t;
    });
    newTasks = recomputeBlocks(newTasks);
    state = { ...state, tasks: newTasks };
    state = syncTaskPin(state);
    accessor.setState(state);

    return { content: `Deleted task "${id}". ${state.tasks.length} remaining.` };
  };

  return { definition, executor };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create all 5 task tools with the given state accessor.
 */
export function createTaskTools(accessor: TaskStateAccessor): ToolEntry[] {
  return [
    createTaskCreateTool(accessor),
    createTaskUpdateTool(accessor),
    createTaskListTool(accessor),
    createTaskGetTool(accessor),
    createTaskDeleteTool(accessor),
  ];
}
