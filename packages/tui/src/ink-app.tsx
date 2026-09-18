// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Root Ink Application (CC-style layout)
//
// Layout:
//   ╭ Vesper Agent Runtime ──────╮    ← Static: welcome banner (rendered once)
//   ╰─────────────────────────╯
//   > User message                  ← Static: completed turns
//   ✓ tool_name args
//   assistant text...
//   ─────────────────────────────
//   > Current user message          ← Dynamic: current turn
//   ⠋ tool_name args
//   streaming text█
//   ─────────────────────────────  ← separator above input
//   > input area█                   ← input box
//   ─────────────────────────────  ← separator below input
//   model_name       ↕ Nk tokens   ← status bar
// ═══════════════════════════════════════════════════════════════════════════

import React, { useSyncExternalStore, useCallback, useRef, memo } from 'react';
import { Box, Text, Static, useStdout, useInput } from 'ink';
import type { TuiStore } from './store.js';
import type { TimelineItem } from './store.js';
import { WelcomeBanner } from './components/WelcomeBanner.js';
import { FrozenTimelineItemView } from './components/FrozenTimelineItemView.js';
import { CurrentTurnView } from './components/CurrentTurnView.js';
import { StatusBar } from './components/StatusBar.js';
import { InputBox } from './components/InputBox.js';
import { PermissionDialog } from './components/PermissionDialog.js';
import { AskUserDialog } from './components/AskUserDialog.js';
import { CanvasBrowser, type CanvasBrowserAction } from './components/CanvasBrowser.js';
import { SessionBrowser, type SessionBrowserAction } from './components/SessionBrowser.js';
import { AgentSpinner } from './components/AgentSpinner.js';
import { TaskPanel } from './components/TaskPanel.js';
import { SubagentPanel } from './components/SubagentPanel.js';
import { theme } from './theme.js';

interface AppProps {
  store: TuiStore;
  onSubmit: (input: string) => void;
  onExit: () => void;
  onEscape?: () => void;
  onCanvasBrowserAction?: (action: CanvasBrowserAction) => void;
  onSessionBrowserAction?: (action: SessionBrowserAction) => void;
  onCycleProvider?: () => void;
  onCyclePersona?: () => void;
  onToggleSupervisor?: () => void;
  singleShot?: boolean;
}

/** Thin horizontal rule. */
function HRule({ width }: { width: number }): React.JSX.Element {
  return (
    <Box>
      <Text color={theme.separator} dimColor>{'─'.repeat(Math.min(width, 200))}</Text>
    </Box>
  );
}

/**
 * Static items can be:
 * - welcome banner sentinel
 * - a frozen timeline item (prompt, thinking, tool, text — rendered incrementally)
 * - a separator between turns
 *
 * Completed turns are NOT pushed here — their content was already rendered
 * incrementally as frozen items. The TurnEntry in state.turns exists only
 * for data retention, not for re-rendering.
 */
const WELCOME_SENTINEL = { __tag: 'welcome' as const, id: '__welcome__' };
const SEPARATOR_PREFIX = '__sep__';
type StaticItem =
  | typeof WELCOME_SENTINEL
  | { __tag: 'separator'; id: string }
  | { __tag: 'frozen'; id: string; item: TimelineItem };

export function App({ store, onSubmit, onExit, onEscape, onCanvasBrowserAction, onSessionBrowserAction, onCycleProvider, onCyclePersona, onToggleSupervisor, singleShot }: AppProps): React.JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  const handleToggleTool = useCallback((id: string) => {
    store.toggleToolCollapse(id);
  }, [store]);

  const handleToggleThinking = useCallback((id: string) => {
    store.toggleThinkingCollapse(id);
  }, [store]);

  const handlePermissionRespond = useCallback((decision: import('@vesper/shared').PermissionDecision, denyReason?: string) => {
    store.respondPermission(decision, denyReason);
  }, [store]);

  const handleAskUserRespond = useCallback((answers: import('@vesper/shared').AskUserAnswers) => {
    store.respondAskUser(answers);
  }, [store]);

  const handleCanvasBrowserAction = useCallback((action: CanvasBrowserAction) => {
    // TUI-local state changes
    switch (action.type) {
      case 'close':
        store.closeCanvasBrowser();
        return;
      case 'navigate':
        store.canvasBrowserNavigate(action.delta);
        return;
      case 'back':
        store.canvasBrowserBackToList();
        return;
      case 'start_edit':
        store.canvasBrowserStartEdit(action.blockId, action.content);
        return;
      case 'edit_change':
        store.canvasBrowserSetEditContent(action.content);
        return;
    }
    // Actions that need core (delegated to parent via prop)
    onCanvasBrowserAction?.(action);
  }, [store, onCanvasBrowserAction]);

  const handleSessionBrowserAction = useCallback((action: SessionBrowserAction) => {
    // TUI-local state changes
    switch (action.type) {
      case 'close':
        store.closeSessionBrowser();
        return;
      case 'navigate':
        store.sessionBrowserNavigate(action.delta);
        return;
      case 'navigate_top':
        store.sessionBrowserNavigateTop();
        return;
      case 'navigate_bottom':
        store.sessionBrowserNavigateBottom();
        return;
    }
    // Actions that need core (delegated to parent via prop)
    onSessionBrowserAction?.(action);
  }, [store, onSessionBrowserAction]);

  // Top-level Ctrl+C handler — always active regardless of InputBox/PermissionDialog state.
  // On Windows with Ink raw mode, SIGINT isn't generated; Ctrl+C is parsed by Ink as
  // key.ctrl=true + input='c' (NOT raw '\x03'). This ensures handleInterrupt() is
  // ALWAYS reachable via Ctrl+C.
  useInput(useCallback((input: string, key: import('ink').Key) => {
    if (key.ctrl && input === 'c') {
      onEscape?.();
    }
  }, [onEscape]));

  // ── Hotkey handler — quick-switch shortcuts (idle only) ──────────────
  // Ctrl+P = cycle provider profile, Ctrl+R = cycle persona, Ctrl+S = toggle supervisor
  // Only active when idle (no dialog, no modal, no streaming).
  const isIdle = state.status === 'idle' || state.status === 'done';
  const noModal = !state.pendingPermission && !state.pendingAskUser && !state.canvasBrowser && !state.sessionBrowser;
  useInput(useCallback((input: string, key: import('ink').Key) => {
    if (!key.ctrl) return;
    if (!isIdle || !noModal) return;

    if (input === 'p') {
      onCycleProvider?.();
      return;
    }
    if (input === 'r') {
      onCyclePersona?.();
      return;
    }
    if (input === 's') {
      onToggleSupervisor?.();
      return;
    }
  }, [isIdle, noModal, onCycleProvider, onCyclePersona, onToggleSupervisor]));

  // Build the Static items list — APPEND-ONLY.
  //
  // Ink's <Static> uses a length-based high-water-mark (`index` state):
  //   itemsToRender = items.slice(index)
  //   useLayoutEffect(() => setIndex(items.length), [items.length])
  //
  // It also uses useMemo([items, index]) — so we need a NEW array reference
  // when items are added, but the array must be a strict superset of the
  // previous one (append-only, never reorder or remove).
  //
  // Strategy: accumulate into a backing array (ref), track seen IDs to avoid
  // duplicates, and produce a new array reference only when items are added.
  const backingRef = useRef<StaticItem[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const staticItemsRef = useRef<StaticItem[]>([]);
  const turnSepCountRef = useRef(0);

  let added = false;

  // Welcome banner — push once
  if (!seenIdsRef.current.has('__welcome__')) {
    seenIdsRef.current.add('__welcome__');
    backingRef.current.push(WELCOME_SENTINEL);
    added = true;
  }

  // When a new turn is archived, insert a separator before the new turn's
  // frozen items. We track this by counting turns — each new turn gets one separator.
  const expectedSeps = state.turns.length;
  while (turnSepCountRef.current < expectedSeps) {
    const sepId = `${SEPARATOR_PREFIX}${turnSepCountRef.current}`;
    backingRef.current.push({ __tag: 'separator', id: sepId });
    turnSepCountRef.current++;
    added = true;
  }

  // Frozen timeline items from the current turn (includes prompt as first item).
  // Guard: skip items whose ID still appears in the active timeline — they
  // haven't fully left the dynamic zone yet and would cause double rendering
  // (Static items are permanent, dynamic zone items are transient).
  const activeIds = new Set(state.timeline.map((t) => t.entry.id));
  for (const item of state.frozenTimeline) {
    const entryId = item.entry.id;
    if (seenIdsRef.current.has(entryId)) continue;
    if (activeIds.has(entryId)) continue; // Still in dynamic zone — defer
    seenIdsRef.current.add(entryId);
    backingRef.current.push({ __tag: 'frozen', id: entryId, item });
    added = true;
  }

  // New reference only when items were added — triggers useMemo in <Static>
  if (added) {
    staticItemsRef.current = [...backingRef.current];
  }

  return (
    <>
      {/* Static zone: welcome + completed turns + frozen items from current turn */}
      <Static items={staticItemsRef.current}>
        {(item) => {
          switch (item.__tag) {
            case 'welcome':
              return <WelcomeBanner key="__welcome__" />;
            case 'separator':
              return (
                <Box key={item.id}>
                  <Text color={theme.separator} dimColor>{'─'.repeat(Math.min(termWidth, 120))}</Text>
                </Box>
              );
            case 'frozen':
              return <FrozenTimelineItemView key={item.id} item={item.item} />;
          }
        }}
      </Static>

      {/* Dynamic zone */}
      <Box flexDirection="column" width={termWidth}>
        {/* Current turn content */}
        <CurrentTurnView
          timeline={state.timeline}
          lastError={state.lastError}
          status={state.status}
          hasFrozenContent={state.frozenTimeline.length > 0}
          onToggleTool={handleToggleTool}
          onToggleThinking={handleToggleThinking}
          hideAskUserPending={state.pendingAskUser !== null}
        />

        {/* Pending area — queued messages waiting to be processed */}
        {state.pendingSidebands.length > 0 && (
          <Box flexDirection="column">
            {state.pendingSidebands.map((msg, i) => (
              <Box key={i} paddingLeft={2}>
                <Text color={theme.pendingIcon}>{'⏳ '}</Text>
                <Text color={theme.pendingText}>{msg}</Text>
              </Box>
            ))}
          </Box>
        )}

        {/* Permission dialog — shown when a tool requires user authorization */}
        {state.pendingPermission && (
          <PermissionDialog
            permission={state.pendingPermission}
            onRespond={handlePermissionRespond}
          />
        )}

        {/* Ask user dialog — shown when agent asks user a question */}
        {state.pendingAskUser && (
          <AskUserDialog
            pending={state.pendingAskUser}
            onRespond={handleAskUserRespond}
          />
        )}

        {/* Canvas browser — interactive block management */}
        {state.canvasBrowser && (
          <CanvasBrowser
            state={state.canvasBrowser}
            onAction={handleCanvasBrowserAction}
          />
        )}

        {/* Session browser — interactive session management */}
        {state.sessionBrowser && (
          <SessionBrowser
            state={state.sessionBrowser}
            onAction={handleSessionBrowserAction}
          />
        )}

        {/* Persistent task list panel — visible when tasks are active */}
        <TaskPanel tasks={state.tasks} />

        {/* Subagent panel — visible when subagents are running or recently completed */}
        <SubagentPanel subagents={state.subagents} />

        {/* Agent spinner — always visible above input */}
        <AgentSpinner status={state.status} timeline={state.timeline} providerRequests={state.providerRequests} />

        {/* ── separator above input ── */}
        <HRule width={termWidth} />

        {/* Input box — disabled during permission dialog to prevent interference */}
        {!singleShot && (
          <InputBox
            onSubmit={onSubmit}
            onEscape={onEscape}
            disabled={state.pendingPermission !== null || state.pendingAskUser !== null || state.canvasBrowser !== null || state.sessionBrowser !== null}
            inputHistory={state.inputHistory}
          />
        )}

        {/* ── separator below input ── */}
        <HRule width={termWidth} />

        {/* Status bar at very bottom */}
        <StatusBar
          modelName={state.modelName}
          tokenBudget={state.tokenBudget}
          diagnostics={state.diagnostics}
          status={state.status}
          providerUsage={state.lastProviderUsage}
          cumulativeUsage={state.cumulativeUsage}
          currentPersona={state.currentPersona}
          loadedSkills={state.loadedSkills}
          supervisorMode={state.supervisorMode}
          currentProvider={state.currentProvider}
        />
      </Box>
    </>
  );
}
