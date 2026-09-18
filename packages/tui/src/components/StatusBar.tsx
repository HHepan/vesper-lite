// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Status Bar Component (CC-style, enhanced)
//
// One-line status below the input separator:
//   Left:  [persona] ⚑ SUPERVISOR ✦ skills
//   Right: Σ$cost  ↕ Nk/Mk tokens  [provider]
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Box, Text } from 'ink';
import type { TokenBudgetSnapshot, DiagnosticsReport } from '@vesper/shared';
import { theme } from '../theme.js';

interface Props {
  tokenBudget: TokenBudgetSnapshot | null;
  diagnostics: DiagnosticsReport | null;
  status: 'idle' | 'streaming' | 'done' | 'error';
  modelName?: string;
  providerUsage?: { promptTokens: number; completionTokens: number; cachedTokens?: number; cost?: number } | null;
  cumulativeUsage?: { promptTokens: number; completionTokens: number; cachedTokens: number; cost: number };
  currentPersona?: string | null | undefined;
  loadedSkills?: string[];
  supervisorMode?: boolean;
  currentProvider?: { model: string; baseURL: string; providerType: string; profile?: string } | null;
  /** Show hotkey hints (only when idle + no modal). */
  showHotkeys?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatCost(n: number): string {
  if (n < 0.001) return `$${n.toFixed(5)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function budgetColor(pct: number): string {
  if (pct > 90) return theme.statusBudgetCritical;
  if (pct > 70) return theme.statusBudgetWarn;
  return theme.statusBudgetNormal;
}

export const StatusBar = React.memo(function StatusBar({
  tokenBudget, diagnostics, status, modelName, providerUsage,
  cumulativeUsage, currentPersona, loadedSkills, supervisorMode, currentProvider,
  showHotkeys,
}: Props): React.JSX.Element {
  // Provider label for right side
  const providerLabel = currentProvider?.profile ?? currentProvider?.model ?? modelName;

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        {/* Left: persona + supervisor + skills */}
        <Box>
          {/* Persona */}
          {currentPersona !== undefined && (
            <Text color={theme.statusStack}>{`[${currentPersona ?? 'default'}] `}</Text>
          )}

          {/* Supervisor badge */}
          {supervisorMode && (
            <Text color="#f5a623" bold>{'⚑ SUPERVISOR '}</Text>
          )}

          {/* Loaded skills */}
          {loadedSkills && loadedSkills.length > 0 && (
            <Text color={theme.dimText}>{`✦ ${loadedSkills.join(', ')} `}</Text>
          )}
        </Box>

        {/* Right: cumulative cost + token budget + provider */}
        <Box>
          {/* Cumulative cost */}
          {cumulativeUsage && cumulativeUsage.cost > 0 && (
            <Text color={theme.dimText}>
              {`Σ${formatCost(cumulativeUsage.cost)} `}
            </Text>
          )}

          {/* Token budget: totalTokens (API real value or estimation) / budget */}
          {tokenBudget ? (
            <Text color={budgetColor(tokenBudget.utilizationPercent)}>
              {`↕ ${formatTokens(tokenBudget.totalTokens)}/${formatTokens(tokenBudget.budgetTokens)}`}
              {tokenBudget.utilizationPercent > 70 ? ` (${tokenBudget.utilizationPercent}%)` : ''}
            </Text>
          ) : (
            <Text color={theme.statusBudgetNormal} dimColor>{'↕ --'}</Text>
          )}

          {/* Provider label */}
          {providerLabel && (
            <Text color="#4EC9B0">{` [${providerLabel}]`}</Text>
          )}
        </Box>
      </Box>

    </Box>
  );
});
