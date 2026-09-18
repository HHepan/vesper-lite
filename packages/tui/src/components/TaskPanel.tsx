// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — TaskPanel (persistent task list in dynamic zone)
//
// Auto-updates via task_snapshot events. Only visible when tasks are
// present and not all completed. Uses TreeContent left-border pattern
// consistent with ToolPanel and ThinkingPanel.
//
// Layout:
//   * Tasks (2/4)                         ← yellow bold
//   │ ✓ Setup project structure          ← green + strikethrough
//   │ ■ Implement task panel              ← yellow/orange bold
//   │   Implementing task panel           ← dim activeForm subtext
//   │ □ Write tests                       ← white
//   │ □ Update documentation
//   └─
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Box, Text } from 'ink';
import type { TaskItem } from '@vesper/shared';
import { TreeContent } from './TreeContent.js';
import { theme } from '../theme.js';

interface Props {
  tasks: TaskItem[];
}

export const TaskPanel = React.memo(function TaskPanel({ tasks }: Props): React.JSX.Element | null {
  // Hide when empty or when all tasks are done
  if (tasks.length === 0) return null;
  const allDone = tasks.every(t => t.status === 'completed');
  if (allDone) return null;

  const doneCount = tasks.filter(t => t.status === 'completed').length;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header: * Tasks (done/total) — entire line colored */}
      <Box>
        <Text color={theme.taskTitleStar} bold>{`* Tasks (${doneCount}/${tasks.length})`}</Text>
      </Box>

      {/* Task items inside left-border tree */}
      <TreeContent color={theme.taskPanelTree}>
        <Box flexDirection="column">
          {tasks.map((task) => {
            const marker = task.status === 'completed' ? '✓'
              : task.status === 'in_progress' ? '■'
              : '□';
            const markerColor = task.status === 'completed' ? theme.taskDone
              : task.status === 'in_progress' ? theme.taskInProgress
              : theme.taskPending;

            return (
              <Box key={task.id} flexDirection="column">
                <Box>
                  <Text color={markerColor}>{marker}</Text>
                  <Text
                    bold={task.status === 'in_progress'}
                    strikethrough={task.status === 'completed'}
                    dimColor={task.status === 'completed'}
                  >{` ${task.subject}`}</Text>
                </Box>
                {task.status === 'in_progress' && task.metadata?.activeForm != null && (
                  <Box paddingLeft={2}>
                    <Text color={theme.taskActiveForm} dimColor>
                      {`${task.metadata.activeForm}`}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </TreeContent>
    </Box>
  );
});
