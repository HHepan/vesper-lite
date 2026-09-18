// =============================================================================
// Vesper TUI — Slash Command Autocomplete Menu
//
// Renders a vertical list of matching slash commands above the input box.
// Highlighted row uses VSCode-style selection background.
// =============================================================================

import React from 'react';
import { Box, Text } from 'ink';
import type { SlashCommandDef } from '../slash-commands.js';
import { theme } from '../theme.js';

interface Props {
  commands: SlashCommandDef[];
  highlightIndex: number;
}

export const SlashCommandMenu = React.memo(function SlashCommandMenu({ commands, highlightIndex }: Props): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {commands.map((cmd, i) => {
        const isActive = i === highlightIndex;
        return (
          <Box key={cmd.name}>
            <Text
              backgroundColor={isActive ? theme.autocompleteHighlight : undefined}
              color={theme.autocompleteCommand}
              bold={isActive}
            >
              {'/' + cmd.name}
            </Text>
            {cmd.argHint && (
              <Text
                backgroundColor={isActive ? theme.autocompleteHighlight : undefined}
                color={theme.autocompleteDescription}
              >
                {' ' + cmd.argHint}
              </Text>
            )}
            <Text
              backgroundColor={isActive ? theme.autocompleteHighlight : undefined}
              color={theme.autocompleteDescription}
            >
              {'  ' + cmd.description}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
});
