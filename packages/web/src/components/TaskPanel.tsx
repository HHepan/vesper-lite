// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — TaskPanel (TUI style task list)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { theme } from '../theme.js';
import { TreeContent } from './TreeContent.js';
import type { TaskItem } from '../store.js';

// ---------------------------------------------------------------------------
// Progress bar constants
// ---------------------------------------------------------------------------
const BAR_WIDTH = 10;
const CHAR_FILLED = '█';
const CHAR_EMPTY = '░';

// ---------------------------------------------------------------------------
// TaskHeader — ● Tasks  ██░░░░  2/5
// ---------------------------------------------------------------------------

const TaskHeader = memo(function TaskHeader({ tasks }: { tasks: TaskItem[] }) {
  const done = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;
  const filled = total > 0 ? Math.round((done / total) * BAR_WIDTH) : 0;

  const bar = CHAR_FILLED.repeat(filled) + CHAR_EMPTY.repeat(BAR_WIDTH - filled);

  return (
    <div style={{ color: theme.taskHeader, display: 'flex', gap: '1ch', alignItems: 'baseline' }}>
      <span style={{ color: theme.taskTitleStar }}>● </span>
      <span>Tasks</span>
      <span style={{ color: theme.taskDone, letterSpacing: '0.05ch' }}>{bar}</span>
      <span>{done}/{total}</span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// TaskPanel
// ---------------------------------------------------------------------------

interface TaskPanelProps {
  tasks: TaskItem[];
}

export const TaskPanel = memo(function TaskPanel({ tasks }: TaskPanelProps) {
  if (tasks.length === 0) return null;

  return (
    <div style={styles.container}>
      <TaskHeader tasks={tasks} />
      <TreeContent color={theme.taskPanelTree}>
        {tasks.map((task) => {
          let icon: string;
          let color: string;
          switch (task.status) {
            case 'completed':
              icon = 'x';
              color = theme.taskDone;
              break;
            case 'in_progress':
              icon = '\u25A0';
              color = theme.taskInProgress;
              break;
            default:
              icon = '\u25A1';
              color = theme.taskPending;
              break;
          }

          return (
            <div key={task.id} style={{ display: 'flex', gap: '1ch' }}>
              <span style={{ color }}>{icon}</span>
              <span style={{
                color,
                textDecoration: task.status === 'completed' ? 'line-through' : undefined,
                opacity: task.status === 'completed' ? 0.6 : 1,
              }}>
                {task.subject}
              </span>
              {task.status === 'in_progress' && task.activeForm && (
                <span style={{ color: theme.taskActiveForm }}> {task.activeForm}</span>
              )}
            </div>
          );
        })}
      </TreeContent>
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '0 1ch',
  },
};
