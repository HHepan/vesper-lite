// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Permission Dialog Component
//
// Renders a permission prompt when a tool requires 'ask' authorization.
// Shortcuts:
//   y = allow_once, a = allow_always, n/Esc = deny_once (quick),
//   d = deny detail → type optional reason → [n] deny_once / [d] deny_always
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { PendingPermission } from '../store.js';
import type { PermissionDecision } from '@vesper/shared';
import { theme } from '../theme.js';

interface PermissionDialogProps {
  permission: PendingPermission;
  onRespond: (decision: PermissionDecision, denyReason?: string) => void;
}

type Mode = 'choose' | 'reason_input' | 'deny_confirm';

export const PermissionDialog = memo(function PermissionDialog({
  permission,
  onRespond,
}: PermissionDialogProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('choose');
  const [reason, setReason] = useState('');

  useInput((input, key) => {
    if (mode === 'choose') {
      if (input === 'y' || input === 'Y') {
        onRespond('allow_once');
      } else if (input === 'a' || input === 'A') {
        onRespond('allow_always');
      } else if (input === 'n' || input === 'N' || key.escape) {
        onRespond('deny_once');
      } else if (input === 'd' || input === 'D') {
        setMode('reason_input');
      }
    } else if (mode === 'deny_confirm') {
      if (input === 'n' || input === 'N') {
        onRespond('deny_once', reason.trim() || undefined);
      } else if (input === 'd' || input === 'D' || key.return) {
        onRespond('deny_always', reason.trim() || undefined);
      } else if (key.escape) {
        setMode('reason_input');
      }
    }
    // reason_input mode: keys handled by TextInput (useInput won't intercept)
  });

  // ── Deny detail: reason input ──
  if (mode === 'reason_input') {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.permissionBorder}
        paddingLeft={1}
        paddingRight={1}
      >
        <Text color={theme.permissionHeader} bold>{' ⚠ Deny — Enter reason (optional) '}</Text>
        <Box marginTop={0}>
          <Text color={theme.permissionTool} bold>{permission.toolName}</Text>
          <Text color={theme.toolArgs}>{' '}{permission.argsPreview}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.permissionDeny}>Reason: </Text>
        </Box>
        <Box>
          <TextInput
            value={reason}
            onChange={setReason}
            onSubmit={() => setMode('deny_confirm')}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[Enter] Confirm   [Esc] Back</Text>
        </Box>
      </Box>
    );
  }

  // ── Deny confirm: choose once or always ──
  if (mode === 'deny_confirm') {
    const reasonDisplay = reason.trim() || '(none)';
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.permissionBorder}
        paddingLeft={1.5}
        paddingRight={1.5}
        paddingTop={0.5}
        paddingBottom={0.5}
      >
        <Text color={theme.permissionHeader} bold>{' ⚠ Confirm Deny '}</Text>
        <Box marginTop={0}>
          <Text color={theme.permissionTool} bold>{permission.toolName}</Text>
          <Text color={theme.toolArgs}>{' '}{permission.argsPreview}</Text>
        </Box>
        <Box marginTop={0}>
          <Text dimColor>Reason: {reasonDisplay}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.permissionDeny} bold>[n]</Text>
          <Text> Deny once   </Text>
          <Text color={theme.permissionDeny} bold>[d]</Text>
          <Text>/</Text>
          <Text color={theme.permissionDeny} bold>[Enter]</Text>
          <Text> Deny always   </Text>
          <Text dimColor bold>[Esc]</Text>
          <Text dimColor> Edit reason</Text>
        </Box>
      </Box>
    );
  }

  // ── Main: choose action ──
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.permissionBorder}
      paddingLeft={1.5}
      paddingRight={1.5}
      paddingTop={0.5}
      paddingBottom={0.5}
    >
      <Text color={theme.permissionHeader} bold>{' ⚠ Permission Required '}</Text>
      <Box marginTop={0}>
        <Text color={theme.permissionTool} bold>{permission.toolName}</Text>
        <Text color={theme.toolArgs}>{' '}{permission.argsPreview}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.permissionAllowOnce} bold>[y]</Text>
        <Text> Allow once   </Text>
        <Text color={theme.permissionAllowAlways} bold>[a]</Text>
        <Text> Allow always   </Text>
        <Text color={theme.permissionDeny} bold>[n]</Text>
        <Text> Deny once   </Text>
        <Text color={theme.permissionDeny} bold>[d]</Text>
        <Text> Deny…</Text>
      </Box>
    </Box>
  );
});
