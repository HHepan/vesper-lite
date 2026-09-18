// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — StatusBar (TUI style)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext.js';
import type { ThemeConfig } from '../theme.js';
import { formatTokens } from '../lib/format-utils.js';
import type { TokenBudgetSnapshot } from '../store.js';
import type { Persona, RoleAssignment } from '@vesper/shared';
import { useIsMobile } from '../hooks/useIsMobile.js';

// Flash duration for turn-level usage display (ms)
const FLASH_DURATION_MS = 2000;

interface StatusBarProps {
  modelName: string;
  tokenBudget: TokenBudgetSnapshot | null;
  status: string;
  providerUsage?: { promptTokens: number; completionTokens: number; cachedTokens?: number; cost?: number } | null;
  cumulativeUsage: { promptTokens: number; completionTokens: number; cachedTokens: number; cost: number };
  currentToolset: string | null | undefined;
  currentPersona: string | null | undefined;
  activeRoleName?: string | null | undefined;
  loadedSkills: string[];
  availablePersonas?: Persona[];
  onSwitchPersona?: (name: string) => void;
  onSwitchMember?: (personaName: string, roleName: string) => void;
  /** Available LLM provider profiles for dynamic switching. */
  availableProfiles?: Array<{ name: string; model?: string }>;
  /** Current provider info (model, baseURL, providerType, profile). */
  currentProvider?: { model: string; baseURL: string; providerType: string; profile?: string } | null;
  /** Callback to switch LLM provider profile. */
  onSwitchProvider?: (profile: string) => void;
  /** Supervisor mode active indicator. */
  supervisorMode?: boolean;
  /** Current supervisor rules text. */
  supervisorRules?: string;
  /** Callback to disable supervisor mode. */
  onDisableSupervisor?: () => void;
  /** Callback to update supervisor rules (live edit). */
  onUpdateSupervisorRules?: (rules: string) => void;
  /** Team role assignments for grouping personas. */
  assignments?: RoleAssignment[];
  /** Public mode toggle state. */
  publicMode?: boolean;
  /** Callback to toggle public mode. */
  onTogglePublicMode?: () => void;
  /** Permission mode: how to handle 'ask'-level tool requests. */
  permissionMode?: 'manual' | 'auto' | 'supervisor';
  /** Callback to change permission mode. */
  onSetPermissionMode?: (mode: 'manual' | 'auto' | 'supervisor') => void;
  /** Multi-chat mode: multiple members selected for auto-rotation. */
  multiChatMode?: boolean;
  /** Selected members for multi-chat (persona-role keys like "Liuli-architect"). */
  selectedMembers?: string[];
  /** Callback when multi-chat member selection changes. */
  onMultiChatChange?: (enabled: boolean, members: string[]) => void;
}

export const StatusBar = memo(function StatusBar({
  modelName,
  tokenBudget,
  status,
  providerUsage,
  cumulativeUsage,
  currentToolset,
  currentPersona,
  activeRoleName,
  loadedSkills,
  availablePersonas,
  onSwitchPersona,
  onSwitchMember,
  availableProfiles,
  currentProvider,
  onSwitchProvider,
  supervisorMode,
  supervisorRules,
  onDisableSupervisor,
  onUpdateSupervisorRules,
  assignments,
  publicMode,
  onTogglePublicMode,
  permissionMode,
  onSetPermissionMode,
  multiChatMode,
  selectedMembers,
  onMultiChatChange,
}: StatusBarProps) {
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [supervisorEditorOpen, setSupervisorEditorOpen] = useState(false);
  const [permPopoverOpen, setPermPopoverOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const providerAnchorRef = useRef<HTMLSpanElement>(null);
  const supervisorAnchorRef = useRef<HTMLSpanElement>(null);
  const permAnchorRef = useRef<HTMLSpanElement>(null);

  // ── Flash state: show turn-level usage for 2s after data update ──
  const [showFlash, setShowFlash] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the providerUsage reference to detect actual data changes
  const prevUsageRef = useRef<typeof providerUsage>(null);

  useEffect(() => {
    // Trigger flash only when providerUsage actually changes to a new non-null value
    if (providerUsage && providerUsage !== prevUsageRef.current) {
      prevUsageRef.current = providerUsage;
      setShowFlash(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setShowFlash(false), FLASH_DURATION_MS);
    }
    // When providerUsage is cleared (new turn starts), reset
    if (!providerUsage && prevUsageRef.current) {
      prevUsageRef.current = null;
      setShowFlash(false);
      if (flashTimerRef.current) { clearTimeout(flashTimerRef.current); flashTimerRef.current = null; }
    }
    return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); };
  }, [providerUsage]);

  // Close on outside click
  useEffect(() => {
    if (!pickerOpen && !providerPickerOpen && !supervisorEditorOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerOpen && anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
      if (providerPickerOpen && providerAnchorRef.current && !providerAnchorRef.current.contains(e.target as Node)) {
        setProviderPickerOpen(false);
      }
      if (supervisorEditorOpen && supervisorAnchorRef.current && !supervisorAnchorRef.current.contains(e.target as Node)) {
        setSupervisorEditorOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen, providerPickerOpen, supervisorEditorOpen]);

  const handlePickPersona = useCallback((name: string) => {
    setPickerOpen(false);
    onSwitchPersona?.(name);
  }, [onSwitchPersona]);

  const handlePickMember = useCallback((personaName: string, roleName: string) => {
    setPickerOpen(false);
    if (onSwitchMember) {
      onSwitchMember(personaName, roleName);
    } else {
      onSwitchPersona?.(personaName);
    }
  }, [onSwitchMember, onSwitchPersona]);

  const handlePickProvider = useCallback((profile: string) => {
    setProviderPickerOpen(false);
    onSwitchProvider?.(profile);
  }, [onSwitchProvider]);

  // Budget color based on percentage
  let budgetColor = theme.statusBudgetNormal;
  let budgetStr = '';
  if (tokenBudget) {
    const pct = tokenBudget.utilizationPercent;
    if (pct > 90) budgetColor = theme.statusBudgetCritical;
    else if (pct > 70) budgetColor = theme.statusBudgetWarn;
    // totalTokens: API real value (preferred) or estimation
    const totalTokens = tokenBudget.totalTokens;
    const budget = tokenBudget.budgetTokens;
    const cumulativeContext = tokenBudget.cumulativeTokens;
    // Display: "↕ xk/yk · zk总计"
    //   x = totalTokens (API real value or estimation)
    //   y = budgetTokens (canvas budget limit)
    //   z = cumulativeTokens (total conversation footprint, statistics only)
    if (cumulativeContext !== undefined && cumulativeContext > totalTokens) {
      budgetStr = `↕ ${formatTokens(totalTokens)}/${formatTokens(budget)} · ${formatTokens(cumulativeContext)}总计`;
    } else if (tokenBudget.foldedTokens > 0) {
      budgetStr = `↕ ${formatTokens(totalTokens)}/${formatTokens(budget)} · ${formatTokens(totalTokens)}总计`;
    } else {
      budgetStr = `↕ ${formatTokens(totalTokens)}/${formatTokens(budget)}`;
    }
  }

  // Persona display: show persona name (left-most in status bar)
  // Use "Persona-Role" if a role is active (prefer activeRoleName from state, fall back to assignments)
  const activeAssignment = assignments?.find(a => a.personaName === currentPersona && a.isActive);
  const effectiveRole = activeRoleName || activeAssignment?.roleName;
  const personaLabel = currentPersona !== undefined
    ? (effectiveRole ? `${currentPersona}-${effectiveRole}` : (currentPersona ?? 'default'))
    : null;
  const multiChatLabel = multiChatMode && selectedMembers && selectedMembers.length >= 2
    ? `👥 ${selectedMembers.length}人`
    : null;

  // Provider label for right side
  const providerLabel = currentProvider?.profile
    ? (currentProvider.model ? `${currentProvider.profile}/${currentProvider.model}` : currentProvider.profile)
    : (currentProvider?.model ?? modelName);

  const barStyle: React.CSSProperties = {
    ...styles.bar,
    ...(isMobile ? { flexDirection: 'column' as const, alignItems: 'stretch', padding: '0.3em 1ch' } : {}),
  };

  if (isMobile) {
    // ── Mobile layout ──────────────────────────────────────────────
    // Row 1: controls — persona + public mode + permission + provider
    // Row 2: info — token budget
    return (
      <div style={barStyle}>
        {/* Row 1: persona + provider */}
        <div style={mobileStyles.controlsRow}>
          <span ref={anchorRef} style={{ position: 'relative' }}>
            <span
              style={{ color: multiChatMode ? 'var(--status-success)' : theme.statusStack, cursor: onSwitchPersona ? 'pointer' : 'default' }}
              onClick={() => onSwitchPersona && setPickerOpen(v => !v)}
              title={multiChatMode ? '多人聊天模式 — 点击管理成员' : 'Click to switch persona'}
            >
              {multiChatMode ? `[👥 ${selectedMembers?.length ?? 1}人]` : `[${personaLabel ?? 'default'}]`}
            </span>
            {pickerOpen && availablePersonas && availablePersonas.length > 0 && (
              <PersonaPicker
                personas={availablePersonas}
                assignments={assignments || []}
                current={currentPersona ?? null}
                onPick={handlePickPersona}
                onPickMember={handlePickMember}
                multiChatMode={multiChatMode}
                selectedMembers={selectedMembers}
                onMultiChatChange={onMultiChatChange}
              />
            )}
          </span>
          <span style={{ flex: 1 }} />
          <span ref={providerAnchorRef} style={{ position: 'relative' }}>
            <span
              style={{
                color: theme.statusProvider,
                cursor: availableProfiles && availableProfiles.length > 0 && onSwitchProvider ? 'pointer' : 'default',
              }}
              onClick={() => availableProfiles && availableProfiles.length > 0 && onSwitchProvider && setProviderPickerOpen(v => !v)}
              title={currentProvider
                ? `${currentProvider.model} @ ${currentProvider.baseURL}${currentProvider.profile ? ` (profile: ${currentProvider.profile})` : ''}${availableProfiles && availableProfiles.length > 0 ? ' — click to switch' : ''}`
                : modelName}
            >
              [{providerLabel}]
            </span>
            {providerPickerOpen && availableProfiles && availableProfiles.length > 0 && (
              <ProviderPicker
                profiles={availableProfiles}
                currentProfile={currentProvider?.profile ?? null}
                onPick={handlePickProvider}
              />
            )}
          </span>
        </div>
        {/* Row 2: token budget (left) + public mode + permission (right) */}
        <div style={mobileStyles.infoRow}>
          {budgetStr && (
            <span style={{ color: budgetColor }}>
              {budgetStr}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {onTogglePublicMode && (
            <label style={mobileStyles.publicLabel}>
              <input
                type="checkbox"
                checked={multiChatMode ? true : (publicMode ?? false)}
                onChange={multiChatMode ? undefined : onTogglePublicMode}
                disabled={multiChatMode}
                style={{ accentColor: 'var(--status-success)', margin: 0 }}
              />
              <span style={{ color: (multiChatMode || publicMode) ? 'var(--status-success-light)' : theme.dimText }}>
                {multiChatMode ? '🔒 公共聊天' : '公共聊天'}
              </span>
            </label>
          )}
          {onSetPermissionMode && (
            <span ref={permAnchorRef} style={{ position: 'relative' }}>
              <span
                style={{
                  color: permissionMode === 'auto' ? 'var(--status-success-light)' : permissionMode === 'supervisor' ? theme.statusSupervisor : theme.dimText,
                  cursor: 'pointer',
                }}
                onClick={() => setPermPopoverOpen(v => !v)}
              >
                【权限】:{permissionMode === 'manual' ? '手动处理' : permissionMode === 'auto' ? '自动批准' : 'AI审核'}
              </span>
              {permPopoverOpen && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: '4px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  padding: '4px 0',
                  minWidth: '15ch',
                  zIndex: 100,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 -4px 12px rgba(0,0,0,0.5)',
                }}>
                  {(['manual', 'auto', 'supervisor'] as const).map(mode => (
                    <div
                      key={mode}
                      style={{
                        padding: '3px 1ch',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'baseline',
                        whiteSpace: 'nowrap',
                        background: permissionMode === mode ? 'var(--border-color)' : 'transparent',
                      }}
                      onClick={() => { onSetPermissionMode(mode); setPermPopoverOpen(false); }}
                    >
                      <span style={{ color: permissionMode === mode ? theme.statusStack : theme.promptText }}>
                        {permissionMode === mode ? '● ' : '  '}{mode === 'manual' ? '手动处理' : mode === 'auto' ? '自动批准' : 'AI审核'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Desktop layout ──────────────────────────────────────────────
  return (
    <div style={barStyle}>
      {/* ── Left: persona + supervisor + skills + stack ── */}
      {personaLabel !== null && (
        <span ref={anchorRef} style={{ position: 'relative', marginRight: '1ch' }}>
          <span
            style={{ color: multiChatMode ? 'var(--status-success)' : theme.statusStack, cursor: onSwitchPersona ? 'pointer' : 'default' }}
            onClick={() => onSwitchPersona && setPickerOpen(v => !v)}
            title={multiChatMode ? '多人聊天模式 — 点击管理成员' : 'Click to switch persona'}
          >
            {multiChatMode ? `[👥 ${selectedMembers?.length ?? 1}人]` : `[${personaLabel}]`}
          </span>
          {pickerOpen && availablePersonas && availablePersonas.length > 0 && (
            <PersonaPicker
              personas={availablePersonas}
              assignments={assignments || []}
              current={currentPersona ?? null}
              onPick={handlePickPersona}
              onPickMember={handlePickMember}
              multiChatMode={multiChatMode}
              selectedMembers={selectedMembers}
              onMultiChatChange={onMultiChatChange}
            />
          )}
        </span>
      )}
      {supervisorMode && (
        <span ref={supervisorAnchorRef} style={{ position: 'relative', marginRight: '1ch' }}>
          <span
            style={{ color: theme.statusSupervisor, fontWeight: 'bold', cursor: 'pointer' }}
            title="Supervisor mode active — click to edit rules"
            onClick={() => setSupervisorEditorOpen(v => !v)}
          >
            ⚑ SUPERVISOR
          </span>
          {supervisorEditorOpen && (
            <SupervisorEditor
              rules={supervisorRules ?? ''}
              onUpdate={(rules) => { onUpdateSupervisorRules?.(rules); setSupervisorEditorOpen(false); }}
              onDisable={() => { onDisableSupervisor?.(); setSupervisorEditorOpen(false); }}
              onClose={() => setSupervisorEditorOpen(false)}
            />
          )}
        </span>
      )}
      {loadedSkills.length > 0 && (
        <span style={{ color: theme.dimText, marginRight: '1ch' }}>
          ✦ {loadedSkills.join(', ')}
        </span>
      )}

      {/* ── Spacer ── */}
      <span style={{ flex: 1 }} />

      {/* ── Right: alternating flash (turn usage) vs default (total cost + budget) ── */}
      {showFlash && providerUsage ? (
        /* Flash mode: show turn-level usage for 2s */
        <span style={{ marginRight: '2ch', transition: 'opacity 0.15s', opacity: 1 }}>
          <span style={{ color: theme.dimText }}>
            {providerUsage.promptTokens > 0
              ? `${formatTokens(providerUsage.promptTokens)}${
                  typeof providerUsage.cachedTokens === 'number' && providerUsage.cachedTokens > 0
                    ? `(${Math.round((providerUsage.cachedTokens / providerUsage.promptTokens) * 100)}%)`
                    : ''
                }→${formatTokens(providerUsage.completionTokens)}`
              : `→${formatTokens(providerUsage.completionTokens)}`}
            {typeof providerUsage.cost === 'number' && (
              ` ${providerUsage.cost < 0.01 ? providerUsage.cost.toFixed(4) : providerUsage.cost.toFixed(3)}`
            )}
          </span>
          {cumulativeUsage.promptTokens > 0 && (
            <>
              <span style={{ color: 'var(--text-muted)', margin: '0 0.8ch' }}>│</span>
              <span style={{ color: 'var(--status-success-light)' }}>
                Σ{formatTokens(cumulativeUsage.promptTokens)}
                {cumulativeUsage.cachedTokens > 0 && cumulativeUsage.promptTokens > 0
                  ? `(${Math.round((cumulativeUsage.cachedTokens / cumulativeUsage.promptTokens) * 100)}%)`
                  : ''}
              </span>
            </>
          )}
        </span>
      ) : (
        /* Default mode: total cost + budget */
        <>
          {cumulativeUsage.cost > 0 && (
            <span style={{ color: theme.dimText, marginRight: '2ch' }}>
              Σ${cumulativeUsage.cost < 0.01 ? cumulativeUsage.cost.toFixed(4) : cumulativeUsage.cost.toFixed(3)}
            </span>
          )}
          {budgetStr && (
            <span style={{ color: budgetColor, marginRight: '2ch' }}>
              {budgetStr}
            </span>
          )}
        </>
      )}
      {/* Public mode toggle — locked to ON when multi-chat mode is active */}
      {onTogglePublicMode && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3ch', marginRight: '1ch', cursor: multiChatMode ? 'not-allowed' : 'pointer', userSelect: 'none', opacity: multiChatMode ? 0.7 : 1 }}>
          <input
            type="checkbox"
            checked={multiChatMode ? true : (publicMode ?? false)}
            onChange={multiChatMode ? undefined : onTogglePublicMode}
            disabled={multiChatMode}
            style={{ accentColor: 'var(--status-success)' }}
          />
          <span style={{ fontSize: '0.85em', color: (multiChatMode || publicMode) ? 'var(--status-success-light)' : theme.dimText }}>
            {multiChatMode ? '🔒 公共聊天' : '公共聊天'}
          </span>
        </label>
      )}
      {/* Permission mode dropdown */}
      {onSetPermissionMode && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4ch', marginRight: '1ch', cursor: 'pointer', userSelect: 'none' }}>
          <span style={{ fontSize: '0.85em', color: theme.dimText }}>权限:</span>
          <select
            value={permissionMode ?? 'manual'}
            onChange={(e) => onSetPermissionMode(e.target.value as 'manual' | 'auto' | 'supervisor')}
            style={{
              fontSize: '0.85em',
              background: 'var(--bg-primary)',
              color: permissionMode === 'auto' ? 'var(--status-success-light)' : permissionMode === 'supervisor' ? theme.statusSupervisor : theme.dimText,
              border: `1px solid ${permissionMode === 'auto' ? '#4A9D4A' : permissionMode === 'supervisor' ? theme.statusSupervisor : 'var(--text-muted)'}`,
              borderRadius: '3px',
              padding: '0 0.3ch',
              cursor: 'pointer',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          >
            <option value="manual">手动处理</option>
            <option value="auto">自动批准</option>
            <option value="supervisor">AI审核</option>
          </select>
        </label>
      )}
      <span ref={providerAnchorRef} style={{ position: 'relative' }}>
        <span
          style={{
            color: theme.statusProvider,
            cursor: availableProfiles && availableProfiles.length > 0 && onSwitchProvider ? 'pointer' : 'default',
          }}
          onClick={() => availableProfiles && availableProfiles.length > 0 && onSwitchProvider && setProviderPickerOpen(v => !v)}
          title={currentProvider
            ? `${currentProvider.model} @ ${currentProvider.baseURL}${currentProvider.profile ? ` (profile: ${currentProvider.profile})` : ''}${availableProfiles && availableProfiles.length > 0 ? ' — click to switch' : ''}`
            : modelName}
        >
          [{providerLabel}]
        </span>
        {providerPickerOpen && availableProfiles && availableProfiles.length > 0 && (
          <ProviderPicker
            profiles={availableProfiles}
            currentProfile={currentProvider?.profile ?? null}
            onPick={handlePickProvider}
          />
        )}
      </span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// PersonaPicker — upward popover from the persona label
// ---------------------------------------------------------------------------

function PersonaPicker({ personas, assignments, current, onPick, onPickMember, multiChatMode, selectedMembers, onMultiChatChange }: {
  personas: Persona[];
  assignments: RoleAssignment[];
  current: string | null;
  onPick: (name: string) => void;
  onPickMember: (personaName: string, roleName: string) => void;
  /** Multi-chat mode: when true, checkboxes shown instead of single-select. */
  multiChatMode?: boolean;
  /** Selected member keys for multi-chat (e.g. "Liuli-architect"). */
  selectedMembers?: string[];
  /** Callback when multi-chat member selection changes. */
  onMultiChatChange?: (enabled: boolean, members: string[]) => void;
}) {
  const { theme } = useTheme();
  // Group 1: Ego-Role pairs from assignments (e.g. "绮梦-调试者", "琉璃-planner")
  // Only show assignments that have an ego (personaName) bound — bare roles without an ego
  // are not selectable because a role is meaningless without an ego to play it.
  const boundAssignments = assignments.filter(a => a.personaName);
  
  // Helper to check if a persona is currently playing ANY active role
  const isPersonaPlayingAnyRole = (name: string) => assignments.some(a => a.personaName === name && a.isActive);

  // Group 2: Standalone egos — user-defined personas (source='user') and the default persona.
  // These can be selected directly to enter pure ego mode (no role assignment).
  const allEgos = personas.filter(p => p.source === 'user' || p.name === 'default');
  
  // Note: Built-in personas (source='builtin') are role templates, NOT egos.
  // They should NOT appear in the picker — you select an ego-role pair or a pure ego,
  // never a bare role.

  // Build a flat list of all selectable member keys for multi-chat
  // Key format: "personaName:roleName" for core assignments, "personaName" for egos/builtins
  const memberKey = (personaName: string, roleName?: string) =>
    roleName ? `${personaName}:${roleName}` : personaName;

  const toggleMember = (key: string) => {
    if (!onMultiChatChange) return;
    const current = selectedMembers ?? [];
    const next = current.includes(key)
      ? current.filter(k => k !== key)
      : [...current, key];
    // Stay in multi-chat mode while toggling members;
    // only exit via the explicit toggle checkbox above.
    onMultiChatChange(true, next);
  };

  // In multi-chat mode, clicking a member toggles its checkbox.
  // In single mode, clicking switches to that persona/role.

  return (
    <div style={pickerStyles.container}>
      {/* Multi-chat toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.3em 0.6em', borderBottom: '1px solid var(--border-color)', marginBottom: '0.3em',
      }}>
        <span style={{ fontSize: '0.85em', color: multiChatMode ? 'var(--status-success)' : theme.dimText }}>
          {multiChatMode ? '✦ 多人聊天模式' : '多人聊天'}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3ch', cursor: 'pointer' }}>
          <input type="checkbox"
            checked={!!multiChatMode}
            onChange={() => {
              if (!onMultiChatChange) return;
              if (multiChatMode) {
                // Exit multi-chat: deselect all, switch back to single mode
                onMultiChatChange(false, []);
              } else {
                // Enter multi-chat: pre-select current persona, enable mode immediately
                const currentKey = current ? memberKey(current) : '';
                onMultiChatChange(true, currentKey ? [currentKey] : []);
              }
            }}
            style={{ accentColor: 'var(--status-success)' }}
          />
        </label>
      </div>
      {multiChatMode && (
        <div style={{ padding: '0 0.6em 0.3em', color: theme.dimText, fontSize: '0.8em' }}>
          勾选参与成员，至少2人
        </div>
      )}
      <div style={pickerStyles.sectionLabel}>岗位分工 (Ego-Role)</div>
      {boundAssignments.map(a => {
        const persona = personas.find(p => p.name === a.personaName);
        const label = persona ? `${persona.displayName || persona.name}-${a.roleName}` : a.roleName;
        const key = memberKey(a.personaName, a.roleName);

        if (multiChatMode) {
          const checked = (selectedMembers ?? []).includes(key);
          return (
            <div
              key={key}
              style={{ ...pickerStyles.item, background: checked ? 'var(--status-success-bg)' : 'transparent', cursor: 'pointer' }}
              onClick={() => toggleMember(key)}
            >
              <input type="checkbox" checked={checked} onChange={() => {}} style={{ accentColor: 'var(--status-success)', marginRight: '0.5ch' }} />
              <span style={{ color: checked ? 'var(--status-success-light)' : theme.promptText }}>{label}</span>
              <span style={{ color: theme.dimText, marginLeft: '1ch', fontSize: '0.85em' }}>
                {a.customDescription || `担任 ${a.roleName}`}
              </span>
            </div>
          );
        }

        // Single-select mode
        const active = a.personaName === current && a.isActive;
        return (
          <div
            key={key}
            style={{
              ...pickerStyles.item,
              background: active ? 'var(--border-color)' : 'transparent',
            }}
            onClick={() => onPickMember(a.personaName, a.roleName)}
          >
            <span style={{ color: active ? theme.statusStack : theme.promptText }}>
              {active ? '● ' : '  '}{label}
            </span>
            <span style={{ color: theme.dimText, marginLeft: '1ch', fontSize: '0.85em' }}>
              {a.customDescription || `担任 ${a.roleName}`}
            </span>
          </div>
        );
      })}

      <div style={pickerStyles.sectionDivider} />
      <div style={pickerStyles.sectionLabel}>本体身份 (Egos)</div>
      {allEgos.map(p => {
        const key = memberKey(p.name);

        if (multiChatMode) {
          const checked = (selectedMembers ?? []).includes(key);
          return (
            <div
              key={key}
              style={{ ...pickerStyles.item, background: checked ? 'var(--status-success-bg)' : 'transparent', cursor: 'pointer' }}
              onClick={() => toggleMember(key)}
            >
              <input type="checkbox" checked={checked} onChange={() => {}} style={{ accentColor: 'var(--status-success)', marginRight: '0.5ch' }} />
              <span style={{ color: checked ? 'var(--status-success-light)' : theme.promptText }}>{p.displayName || p.name}</span>
              <span style={{ color: theme.dimText, marginLeft: '1ch', fontSize: '0.85em' }}>{p.description}</span>
            </div>
          );
        }

        // Single-select mode
        const active = p.name === current && !isPersonaPlayingAnyRole(p.name);
        return (
          <div
            key={key}
            style={{
              ...pickerStyles.item,
              background: active ? 'var(--border-color)' : 'transparent',
            }}
            onClick={() => onPick(p.name)}
          >
            <span style={{ color: active ? theme.statusStack : theme.promptText }}>
              {active ? '● ' : '  '}{p.displayName || p.name}
            </span>
            <span style={{ color: theme.dimText, marginLeft: '1ch', fontSize: '0.85em' }}>
              {p.description}
            </span>
          </div>
        );
      })}

      {/* Built-in personas are role templates, not egos — hidden from the picker.
          Users select ego-role pairs (above) or pure egos (below), never bare roles. */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProviderPicker — upward popover from the model/provider label
// ---------------------------------------------------------------------------

function ProviderPicker({ profiles, currentProfile, onPick }: {
  profiles: Array<{ name: string; model?: string }>;
  currentProfile: string | null;
  onPick: (profile: string) => void;
}) {
  const { theme } = useTheme();
  return (
    <div style={providerPickerStyles.container}>
      {profiles.map(p => {
        const active = p.name === currentProfile;
        const label = p.model ? `${p.name}/${p.model}` : p.name;
        return (
          <div
            key={p.name}
            style={{
              ...pickerStyles.item,
              background: active ? 'var(--border-color)' : 'transparent',
            }}
            onClick={() => onPick(p.name)}
          >
            <span style={{ color: active ? theme.statusStack : theme.promptText }}>
              {active ? '● ' : '  '}{label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SupervisorEditor — upward popover for editing live supervisor rules
// ---------------------------------------------------------------------------

function SupervisorEditor({ rules, onUpdate, onDisable, onClose }: {
  rules: string;
  onUpdate: (rules: string) => void;
  onDisable: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(rules);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); e.stopPropagation(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (draft.trim()) onUpdate(draft.trim());
    }
  };

  return (
    <div style={supervisorEditorStyles.container} onMouseDown={(e) => e.stopPropagation()}>
      <div style={supervisorEditorStyles.header}>
        <span style={{ color: 'var(--status-warning)', fontWeight: 'bold' }}>Supervisor Rules</span>
      </div>
      <textarea
        ref={textareaRef}
        style={supervisorEditorStyles.textarea}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        placeholder="Enter supervisor rules..."
      />
      <div style={supervisorEditorStyles.footer}>
        <button style={supervisorEditorStyles.disableBtn} onClick={onDisable}>
          Disable
        </button>
        <span style={{ flex: 1 }} />
        <span style={supervisorEditorStyles.hint}>Ctrl+Enter to apply</span>
        <button
          style={{ ...supervisorEditorStyles.applyBtn, opacity: draft.trim() ? 1 : 0.5 }}
          onClick={() => draft.trim() && onUpdate(draft.trim())}
          disabled={!draft.trim()}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

const supervisorEditorStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: '4px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--status-warning)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px',
    minWidth: '40ch',
    maxWidth: '60ch',
    zIndex: 100,
    boxShadow: 'var(--shadow-md)',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '1ch',
  },
  textarea: {
    width: '100%',
    minHeight: '8em',
    maxHeight: '20em',
    resize: 'vertical',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    padding: '4px 6px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '1ch',
  },
  hint: {
    color: 'var(--text-muted)',
    fontSize: '0.8em',
  },
  disableBtn: {
    padding: '2px 8px',
    background: 'transparent',
    border: '1px solid var(--status-error-dark)',
    borderRadius: '2px',
    color: 'var(--status-error-dark)',
    fontFamily: 'inherit',
    fontSize: '0.85em',
    cursor: 'pointer',
  },
  applyBtn: {
    padding: '2px 10px',
    background: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '2px',
    color: 'var(--btn-primary-text, #FFFFFF)',
    fontFamily: 'inherit',
    fontSize: '0.85em',
    cursor: 'pointer',
  },
};

const providerPickerStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: '100%',
    right: 0,
    marginBottom: '4px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    padding: '4px 0',
    minWidth: '28ch',
    maxHeight: '300px',
    overflowY: 'auto',
    zIndex: 100,
    whiteSpace: 'normal',
    boxShadow: 'var(--shadow-md)',
  },
};

const pickerStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: '4px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '4px 0',
    minWidth: '28ch',
    maxHeight: '300px',
    overflowY: 'auto',
    zIndex: 100,
    whiteSpace: 'normal',
    boxShadow: '0 -4px 12px rgba(0,0,0,0.5)',
  },
  item: {
    padding: '3px 1ch',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'baseline',
    whiteSpace: 'nowrap',
  },
  sectionLabel: {
    padding: '4px 1ch',
    fontSize: '0.75em',
    fontWeight: 'bold',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  sectionDivider: {
    height: '1px',
    background: 'var(--border-color)',
    margin: '4px 0',
  },
};

const mobileStyles: Record<string, React.CSSProperties> = {
  controlsRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.5ch 1ch',
    width: '100%',
    lineHeight: '1.6em',
  },
  infoRow: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    lineHeight: '1.6em',
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    marginTop: '0.1em',
  },
  publicLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.2ch',
    cursor: 'pointer',
    userSelect: 'none',
    opacity: 1,
  },
  permLabel: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    userSelect: 'none',
  },
  permSelect: {
    fontSize: '0.85em',
    background: 'var(--bg-primary)',
    border: '1px solid var(--text-muted)',
    borderRadius: '3px',
    padding: '0 0.3ch',
    cursor: 'pointer',
    outline: 'none',
    fontFamily: 'inherit',
  },
};

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 1ch',
    minHeight: '1.5em',
    whiteSpace: 'nowrap',
    overflow: 'visible',
  },
};
