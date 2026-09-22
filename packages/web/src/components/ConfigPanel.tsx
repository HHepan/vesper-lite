// =============================================================================
// Vesper WebUI -- ConfigPanel (Tab-based config.json Editor)
//
// Full-screen overlay with top tab bar: Common | Profiles | MCP
// Reads/writes ~/.vesper-lite/config.json directly via server WS commands.
// =============================================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { theme } from '../theme.js';
import type { Bridge } from '../bridge.js';
import { CollapsibleSection } from './config/CollapsibleSection.js';
import { TagListInput } from './config/TagListInput.js';
import { LabeledTagList } from './config/LabeledTagList.js';
import type { LabeledTag } from './config/LabeledTagList.js';
import { KeyValueEditor } from './config/KeyValueEditor.js';
import { MapEditor } from './config/MapEditor.js';
import { ProviderPicker, type ProviderTemplate } from './config/ProviderPicker.js';
import { PromptManager } from './PromptManager.js';
import { QRScanner } from './QRScanner.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useModalAnimation } from '../hooks/useModalAnimation.js';
import { Select } from './Select.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VesperConfig {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  providerType?: string;
  proxy?: string;
  maxIterations?: number;
  maxTokens?: number;
  defaultProfile?: string;
  profiles?: Record<string, ProfileConfig>;
  mcpServers?: Record<string, McpServerConfig>;
  mcp?: any[];
  defaultSupervisorRules?: string;
  // Auto-save dataset settings
  autoSaveOnClose?: boolean;
  autoSaveDir?: string;
  datasetDir?: string;
  // Team Role management
  roles?: Record<string, RoleConfig>;
  assignments?: RoleAssignmentConfig[];
  // Subagent ego assignments
  subagentAssignments?: SubagentAssignmentConfig[];
  // Personas
  personas?: PersonaConfig[];
  // Date precision for prompt caching (affects env block stability)
  datePrecision?: 'day' | 'hour';
  // pass-through: preserve unknown keys on save
  [key: string]: any;
}

interface ProfileConfig {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  providerType?: string;
  proxy?: string;
  maxIterations?: number;
  maxCanvasTokens?: number;
  thinking?: ThinkingConfig;
  maxConcurrentSubagents?: number;
  supportsVision?: boolean;
  supportsAudio?: boolean;
  supportsGif?: boolean;
  injectAsUser?: boolean;
}

interface RoleConfig {
  toolset: string;
  description?: string;
}

interface RoleAssignmentConfig {
  roleName: string;
  personaName: string;
  isActive: boolean;
  customDescription?: string;
  customPrompt?: string;
}

interface SubagentAssignmentConfig {
  subagentName: string;
  personaName?: string;
}

interface PersonaConfig {
  name: string;
  ego: string;
  description?: string;
  model?: string;
  profile?: string;
  privateWorkspace?: {
    enabled: boolean;
    path: string;
    maxSizeMB: number;
  };
  saveThinkingToDataset?: boolean;
}

/**
 * Normalize `personas` to array format.
 * The backend accepts both array [{name, ...}] and object {"name": {...}} forms,
 * but the UI (ListEditor etc.) only supports arrays — object form would crash
 * `.map()` during render. Always normalize before it enters React state.
 */
function normalizePersonas(config: any): void {
  if (config && config.personas && !Array.isArray(config.personas) && typeof config.personas === 'object') {
    config.personas = Object.entries(config.personas).map(([name, p]) => ({
      name,
      ...(p && typeof p === 'object' ? p : {}),
    }));
  }
}

interface ThinkingConfig {
  enabled?: boolean;
  echo?: boolean;
  echoField?: string;
  persist?: boolean;
  deepseekStylized?: boolean;
  effort?: string;
}

interface McpServerConfig {
  type?: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

interface RelayConfig {
  url?: string;
  user?: string;
  password?: string;
}

// ---------------------------------------------------------------------------
// Tab IDs
// ---------------------------------------------------------------------------

type ConfigScope = 'global' | 'project';

type TabId = 'common' | 'team' | 'scenes' | 'history' | 'prompts' | 'profiles' | 'toolsets' | 'skills';

// Tabs available per scope — both global and project support the same tabs
// since personas, assignments, roles, and profiles can exist at either level.
const GLOBAL_TABS: { id: TabId; label: string }[] = [
  { id: 'common', label: '常规 (Common)' },
  { id: 'team', label: '团队 (Team)' },
  { id: 'profiles', label: '配置方案 (Profiles)' },
  { id: 'scenes', label: '场景 (Scene)' },
  { id: 'history', label: '历史视角 (History)' },
  { id: 'toolsets', label: '工具集 (Toolsets)' },
  { id: 'skills', label: '技能 (Skills)' },
];

const PROJECT_TABS: { id: TabId; label: string }[] = [
  { id: 'common', label: '常规 (Common)' },
  { id: 'team', label: '团队 (Team)' },
  { id: 'profiles', label: '配置方案 (Profiles)' },
  { id: 'scenes', label: '场景 (Scene)' },
  { id: 'history', label: '历史视角 (History)' },
  { id: 'toolsets', label: '工具集 (Toolsets)' },
  { id: 'skills', label: '技能 (Skills)' },
];

// Keys that belong to project-level config (stored in .vesper-lite/config.json)
// Managed exclusively by ConfigPanel (Settings)
const PROJECT_CONFIG_KEYS = new Set([
  'profiles', 'personas', 'assignments', 'roles', 'subagentAssignments',
  'defaultSupervisorRules', 'prependSystemToEgo', 'injectCanvasHistory', 'autoSaveOnClose', 'autoSaveDir',
  'datasetDir', 'dataset_dir', // both camelCase and snake_case
  'defaultProfile',
  'maxIterations', 'maxTokens', // also project-level (per-project iteration/budget limits)
  'saveCuratorHistory', 'autoSavePerTurns', 'autoSaveTurnInterval',
  'datePrecision', // prompt caching optimization
]);

// Keys that belong to global config (stored in ~/.vesper-lite/config.json)
// Note: mcpServers, link, proxy, qqbot, cronDataCollection are managed by ConnectionPanel
const GLOBAL_CONFIG_KEYS = new Set([
  'user_name', 'thinking', 'supportsVision', 'supportsAudio', 'supportsGif', 'defaultToolset',
  'canvas',
]);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConfigPanelProps {
  onClose: () => void;
  bridge: Bridge;
  /** Ref to the active session store for reading scene state. */
  storeRef?: { current: { getSnapshot: () => any; subscribe: (fn: () => void) => () => void } | null };
}

// ---------------------------------------------------------------------------
// ConfigPanel
// ---------------------------------------------------------------------------

export function ConfigPanel({
  onClose,
  bridge,
  storeRef,
}: ConfigPanelProps) {
  const isMobile = useIsMobile();
  const { isClosing, handleClose, handleOverlayClick, overlayAnimation, panelAnimation } = useModalAnimation(onClose);
  
  const [configScope, setConfigScope] = useState<ConfigScope>('project');
  const [config, setConfig] = useState<VesperConfig>({});
  const [originalJson, setOriginalJson] = useState<string>('__loading__');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('common');
  const [showCopyConfirm, setShowCopyConfirm] = useState(false);
  const [copying, setCopying] = useState(false);

  // Tabs available for the current scope
  const TABS = configScope === 'global' ? GLOBAL_TABS : PROJECT_TABS;

  const currentJson = JSON.stringify(config, null, 2);
  const dirty = originalJson === '__loading__' ? false : currentJson !== originalJson;

  // Clear the brief "saved" confirmation as soon as the user makes new changes
  useEffect(() => {
    if (dirty) setSaveSuccess(false);
  }, [dirty]);

  // ── Load config on mount or scope change ──────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    setOriginalJson('__loading__');
    bridge.readConfigFile(configScope);
  }, [bridge, configScope]);

  useEffect(() => {
    const unsub = bridge.onMetaEvent((event) => {
      if (event.type === 'config_file_content') {
        // Only process events matching our current scope
        const eventScope = (event as any).scope ?? 'global';
        if (eventScope !== configScope) return;
        setConfigPath(event.path ?? '');
        if (event.error) {
          setError(event.error);
          setLoading(false);
          return;
        }
        try {
          // Strip UTF-8 BOM (U+FEFF) that some editors add
          let raw = event.content ?? '';
          if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
          const parsed = raw ? JSON.parse(raw) : {};
          normalizePersonas(parsed);
          setConfig(parsed);
          setOriginalJson(JSON.stringify(parsed, null, 2));
        } catch (e: any) {
          setError(`解析失败: ${e.message}`);
        }
        setLoading(false);
      }
      if (event.type === 'config_file_saved') {
        const eventScope = (event as any).scope ?? 'global';
        if (eventScope !== configScope) return;
        // Clear safety timeout
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        setSaving(false);
        if (event.success) {
          setOriginalJson(JSON.stringify(config, null, 2));
          setError(null);
          // Flash a success confirmation on the save button, then auto-revert
          setSaveSuccess(true);
          if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
          saveSuccessTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 2000);
        } else {
          setError(`保存失败: ${event.error}`);
          setSaveSuccess(false);
        }
      }
      // 当 Scene 加载后，配置已更新，重新读取
      if (event.type === 'config_updated') {
        // Debounce: avoid rapid re-reads when multiple sessions emit config_updated
        if (configReloadTimerRef.current) clearTimeout(configReloadTimerRef.current);
        configReloadTimerRef.current = setTimeout(() => {
          bridge.readConfigFile(configScope);
        }, 100);
      }
    });
    return () => {
      if (configReloadTimerRef.current) clearTimeout(configReloadTimerRef.current);
      if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
      unsub();
    };
  }, [bridge, configScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Copy global config to project ────────────────────────────
  const handleCopyFromGlobal = useCallback(async () => {
    setCopying(true);
    setError(null);
    try {
      // Read global config
      const globalConfig = await new Promise<VesperConfig>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const unsub = bridge.onMetaEvent((event) => {
          if (event.type === 'config_file_content') {
            const eventScope = (event as any).scope ?? 'global';
            if (eventScope !== 'global') return;
            clearTimeout(timer);
            unsub();
            if (event.error) { reject(new Error(event.error)); return; }
            try {
              let raw = event.content ?? '';
              if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
              const g = raw ? JSON.parse(raw) : {};
              normalizePersonas(g);
              resolve(g);
            } catch (e: any) { reject(e); }
          }
        });
        bridge.readConfigFile('global');
        // Timeout after 5s
        timer = setTimeout(() => { unsub(); reject(new Error('读取全局配置超时')); }, 5000);
      });

      // Extract project-level keys from global config
      const projectConfig: VesperConfig = {};
      for (const key of PROJECT_CONFIG_KEYS) {
        if ((globalConfig as any)[key] !== undefined) {
          (projectConfig as any)[key] = (globalConfig as any)[key];
        }
      }

      // Merge into current project config
      const merged = { ...config, ...projectConfig };
      setConfig(merged);
      setOriginalJson(JSON.stringify(merged, null, 2));
      setShowCopyConfirm(false);

      // Auto-save
      const cleaned = stripEmpty(structuredClone(merged));
      bridge.writeConfigFile(JSON.stringify(cleaned, null, 2), 'project');
    } catch (e: any) {
      setError(`拷贝失败: ${e.message}`);
    }
    setCopying(false);
  }, [bridge, config]);

  // ── Escape to close ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  // ── Save ────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    // Guard: don't attempt save if bridge is not connected (messages would be silently dropped)
    if (bridge.state !== 'connected') {
      setError('保存失败：未连接到服务器，请稍后重试');
      return;
    }
    
    // Get the original config as baseline (to preserve keys managed by other panels)
    let baseline: any = {};
    if (originalJson !== '__loading__') {
      try {
        baseline = JSON.parse(originalJson);
      } catch { /* ignore parse errors */ }
    }
    
    // Merge: start with baseline, then overlay our managed keys
    let toSave = { ...baseline };
    
    // In project scope, only write project-level keys (managed by ConfigPanel)
    // In global scope, only write global-level keys (managed by ConfigPanel)
    if (configScope === 'project') {
      for (const key of PROJECT_CONFIG_KEYS) {
        // Skip profiles/personas if they were merged from global config for UI display
        // — they belong in global config, not project.
        if (key === 'profiles' && config._mergedGlobalProfiles) continue;
        if (key === 'personas' && config._mergedGlobalPersonas) continue;
        
        if ((config as any)[key] !== undefined) {
          (toSave as any)[key] = (config as any)[key];
        } else {
          delete (toSave as any)[key];
        }
      }
    } else if (configScope === 'global') {
      // For global scope, we only manage a few keys (user_name, thinking, etc.)
      // Keys like mcpServers, link, proxy, qqbot are managed by ConnectionPanel
      for (const key of GLOBAL_CONFIG_KEYS) {
        if ((config as any)[key] !== undefined) {
          (toSave as any)[key] = (config as any)[key];
        } else {
          delete (toSave as any)[key];
        }
      }
    }
    
    // Remove merge hints (they're UI-only, not persisted)
    delete toSave._mergedGlobalProfiles;
    delete toSave._mergedGlobalPersonas;
    
    // Strip empty objects/arrays
    toSave = stripEmpty(toSave);
    
    setSaving(true);
    setError(null);
    bridge.writeConfigFile(JSON.stringify(toSave, null, 2), configScope);
    // Safety timeout: clear saving state after 10s if no response
    const saveTimeout = setTimeout(() => {
      setSaving(false);
      setSaveSuccess(false);
      setError('保存超时（服务器未响应）');
    }, 10000);
    // Store timeout ref so config_file_saved handler can clear it
    saveTimeoutRef.current = saveTimeout;
  }, [config, bridge, configScope, originalJson]);

  // ── Config setter helpers ───────────────────────────────────────
  const set = <K extends keyof VesperConfig>(key: K, value: VesperConfig[K]) => {
    setConfig(prev => {
      const next = { ...prev, [key]: value };
      // Clear merge hints when user edits merged fields (so they can be saved)
      if (key === 'personas') delete (next as any)._mergedGlobalPersonas;
      if (key === 'profiles') delete (next as any)._mergedGlobalProfiles;
      return next;
    });
  };

  const setNum = (key: keyof VesperConfig, raw: string) => {
    const n = parseInt(raw, 10);
    setConfig(prev => {
      const next = { ...prev };
      if (isNaN(n) || raw === '') {
        delete next[key];
      } else {
        (next as any)[key] = n;
      }
      return next;
    });
  };

  // ── Tab badges ──────────────────────────────────────────────────
  const profileCount = Object.keys(config.profiles ?? {}).length;
  

  function tabBadge(id: TabId): string | undefined {
    if (id === 'profiles' && profileCount > 0) return String(profileCount);
    return undefined;
  }

  // ── Render ──────────────────────────────────────────────────────

  // Reset active tab if it's not available in current scope
  const availableTabIds = TABS.map(t => t.id);
  useEffect(() => {
    if (!availableTabIds.includes(activeTab)) {
      setActiveTab(availableTabIds[0]);
    }
  }, [configScope]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        ...styles.overlay,
        ...(isMobile ? { padding: '0.5em' } : {}),
        animation: overlayAnimation,
      }}
      onClick={handleOverlayClick}
    >
      <div
        style={{
          ...styles.panel,
          ...(isMobile ? { maxWidth: '100%', maxHeight: '95vh' } : {}),
          animation: panelAnimation,
        }}
      >
        {/* Header */}
        <div style={styles.header}>
          <span style={{ color: theme.bannerTitle, fontWeight: 'bold' }}>设置 (Settings)</span>
          {/* Scope switcher */}
          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            {(['project', 'global'] as ConfigScope[]).map(s => (
              <button
                key={s}
                onClick={() => { if (s !== configScope) setConfigScope(s); }}
                style={{
                  padding: '2px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: `1px solid ${configScope === s ? theme.bannerTitle : 'var(--text-muted)'}`,
                  background: configScope === s ? theme.bannerTitle : 'transparent',
                  color: configScope === s ? 'var(--bg-primary)' : theme.dimText,
                  cursor: 'pointer',
                }}
                title={s === 'project' ? '项目级配置 (.vesper-lite/config.json)' : '全局配置 (~/.vesper-lite/config.json)'}
              >
                {s === 'project' ? '项目' : '全局'}
              </button>
            ))}
          </div>
          {/* Copy from global button (only in project scope) */}
          {configScope === 'project' && (
            <div style={{ marginLeft: 8, position: 'relative' }}>
              {!showCopyConfirm ? (
                <button
                  onClick={() => setShowCopyConfirm(true)}
                  style={{
                    padding: '2px 8px',
                    fontSize: 11,
                    borderRadius: 4,
                    border: '1px solid var(--text-muted)',
                    background: 'transparent',
                    color: theme.dimText,
                    cursor: 'pointer',
                  }}
                  title="从全局配置拷贝项目级字段（profiles, personas, assignments, roles 等）到当前项目"
                >
                  ↓ 拷贝全局
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: theme.dimText }}>覆盖当前项目配置？</span>
                  <button
                    onClick={handleCopyFromGlobal}
                    disabled={copying}
                    style={{
                      padding: '1px 6px',
                      fontSize: 11,
                      borderRadius: 3,
                      border: '1px solid var(--status-success)',
                      background: 'var(--status-success)',
                      color: 'var(--text-primary)',
                      cursor: copying ? 'wait' : 'pointer',
                    }}
                  >
                    {copying ? '拷贝中...' : '是'}
                  </button>
                  <button
                    onClick={() => setShowCopyConfirm(false)}
                    style={{
                      padding: '1px 6px',
                      fontSize: 11,
                      borderRadius: 3,
                      border: '1px solid var(--text-muted)',
                      background: 'transparent',
                      color: theme.dimText,
                      cursor: 'pointer',
                    }}
                  >
                    否
                  </button>
                </div>
              )}
            </div>
          )}
          <span style={styles.pathHint}>{configPath}</span>
          <button style={styles.closeBtn} onClick={handleClose}>x</button>
        </div>

        {/* Tab bar */}
        <div style={styles.tabBar}>
          {TABS.map(t => {
            const isActive = t.id === activeTab;
            const badge = tabBadge(t.id);
            return (
              <button
                key={t.id}
                style={{ ...styles.tab, ...(isActive ? styles.tabActive : {}) }}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
                {badge && <span style={styles.tabBadge}>{badge}</span>}
              </button>
            );
          })}
        </div>

        {/* Body */}
        {loading ? (
          <div style={styles.loading}>正在加载配置...</div>
        ) : (
          <div style={styles.body}>
            {/* Empty state hint for project config */}
            {configScope === 'project' && Object.keys(config).length === 0 && !dirty && (
              <div style={{
                padding: '2em 1em',
                textAlign: 'center',
                color: theme.dimText,
                fontSize: 13,
                lineHeight: 1.8,
              }}>
                <div style={{ marginBottom: 8 }}>当前项目还没有项目级配置。</div>
                <div>项目级配置独立于全局配置，不会与其他 Vesper 实例冲突。</div>
                <div>点击上方 <strong>↓ 拷贝全局</strong> 按钮，可从全局配置中拷贝项目级字段。</div>
              </div>
            )}
            {activeTab === 'common' && (
              <CommonTab config={config} set={set} setNum={setNum} />
            )}
            {activeTab === 'team' && (
              <TeamTab
                config={config}
                set={set}
                bridge={bridge}
              />
            )}
            {activeTab === 'prompts' && (
              <PromptManager bridge={bridge} config={config} />
            )}
            {activeTab === 'profiles' && (
              <ProfilesTab
                profiles={config.profiles ?? {}}
                onChange={(v) => set('profiles', v)}
              />
            )}
            {activeTab === 'scenes' && (
              <ScenesTab bridge={bridge} storeRef={storeRef!} />
            )}
            {activeTab === 'history' && (
              <HistoryViewTab bridge={bridge} storeRef={storeRef!} />
            )}
            {activeTab === 'toolsets' && (
              <ToolsetsTab bridge={bridge} />
            )}
            {activeTab === 'skills' && (
              <SkillsTab bridge={bridge} />
            )}
           </div>
        )}

        {/* Footer */}
        <div style={styles.footer}>
          {error && <span style={styles.errorText}>{error}</span>}
          <div style={{ flex: 1 }} />
          <button style={styles.cancelBtn} onClick={handleClose}>取消</button>
          <button
            style={{ ...styles.saveBtn, opacity: dirty && !saving ? 1 : 0.5 }}
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? '正在保存...' : '保存修改'}
          </button>
          {/* Status indicator: red dot = unsaved changes, green ✓ = just saved */}
          {saveSuccess ? (
            <span style={{ color: 'var(--status-success)', fontWeight: 'bold', fontSize: '1.05em' }}>✓</span>
          ) : dirty && !saving ? (
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--status-error)' }} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Tab: Common
// ===========================================================================

function CommonTab({ config, set, setNum }: {
  config: VesperConfig;
  set: <K extends keyof VesperConfig>(key: K, value: VesperConfig[K]) => void;
  setNum: (key: keyof VesperConfig, raw: string) => void;
}) {
  const profileNames = Object.keys(config.profiles ?? {});

  return (
    <div style={styles.tabContent}>
      <Field label="默认配置方案 (Default Profile)">
        <Select
          value={config.defaultProfile ?? ''}
          onChange={(v) => set('defaultProfile', v || undefined)}
          placeholder="(未设置)"
          options={profileNames.map(name => ({ label: name, value: name }))}
        />
      </Field>

      <div style={styles.row}>
        <Field label="最大迭代次数">
          <input
            style={styles.input}
            type="number"
            value={config.maxIterations ?? ''}
            onChange={(e) => setNum('maxIterations', e.target.value)}
            placeholder="200"
            min={-1} max={500}
          />
        </Field>

        <Field label="全局最大 Tokens">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
            <input
              style={styles.input}
              type="number"
              value={config.maxTokens ?? ''}
              onChange={(e) => setNum('maxTokens', e.target.value)}
              placeholder="200000"
              min={1000}
            />
            <span style={{ fontSize: '0.85em', color: theme.dimText, whiteSpace: 'nowrap' }}>
              时间显示精度：
            </span>
            <Select
              value={config.datePrecision ?? 'hour'}
              onChange={(v) => set('datePrecision', v as 'day' | 'hour')}
              options={[
                { label: '小时', value: 'hour' },
                { label: '天', value: 'day' },
              ]}
              style={{ width: 'auto', minWidth: '5em' }}
            />
          </div>
        </Field>
      </div>

      <Field label="按轮次自动保存 Session">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <input
            type="checkbox"
            checked={!!config.autoSavePerTurns}
            onChange={(e) => set('autoSavePerTurns', e.target.checked || undefined)}
            style={{ accentColor: 'var(--status-success)' }}
          />
          <span style={{ fontSize: '0.85em', color: theme.dimText }}>启用</span>
          {config.autoSavePerTurns && (
            <>
              <span style={{ fontSize: '0.85em', color: theme.dimText }}>，每</span>
              <input
                style={{ ...styles.input, width: '4em', textAlign: 'center' }}
                type="number"
                min={1}
                value={config.autoSaveTurnInterval ?? ''}
                onChange={(e) => setNum('autoSaveTurnInterval', e.target.value)}
                placeholder="5"
              />
              <span style={{ fontSize: '0.85em', color: theme.dimText }}>轮保存一次</span>
            </>
          )}
        </div>
      </Field>

      <Field label="自动保存数据目录">
        <input
          style={styles.input}
          value={config.autoSaveDir ?? ''}
          onChange={(e) => set('autoSaveDir', e.target.value || undefined)}
          placeholder="留空使用默认 ~/.vesper-lite/datasets"
          spellCheck={false}
        />
      </Field>

      <Field label="关闭 Session 时自动保存数据集">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <input
            type="checkbox"
            checked={!!config.autoSaveOnClose}
            onChange={(e) => set('autoSaveOnClose', e.target.checked || undefined)}
            style={{ accentColor: 'var(--status-success)' }}
          />
          <span style={{ fontSize: '0.85em', color: theme.dimText }}>
            {config.autoSaveOnClose ? '已启用' : '未启用'}
          </span>
        </div>
      </Field>

      <Field label="命令行保存数据目录 (/save_dataset)">
        <input
          style={styles.input}
          value={config.datasetDir ?? ''}
          onChange={(e) => set('datasetDir', e.target.value || undefined)}
          placeholder="留空使用默认 ~/.vesper-lite/datasets"
          spellCheck={false}
        />
      </Field>

      <Field label="保存策展人历史数据">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <input
            type="checkbox"
            checked={!!config.saveCuratorHistory}
            onChange={(e) => set('saveCuratorHistory', e.target.checked || undefined)}
            style={{ accentColor: 'var(--status-success)' }}
          />
          <span style={{ fontSize: '0.85em', color: theme.dimText }}>
            {config.saveCuratorHistory
              ? `启用 — 保存至 ${config.autoSaveDir || '~/.vesper-lite/datasets'}/curator/`
              : '未启用'}
          </span>
        </div>
      </Field>

      <Field label="默认监督规则 (Supervisor Rules)">
        <textarea
          style={{ ...styles.input, minHeight: '6em', resize: 'vertical', fontFamily: 'inherit' }}
          value={config.defaultSupervisorRules ?? ''}
          onChange={(e) => set('defaultSupervisorRules', e.target.value || undefined)}
          placeholder="/supervise 默认加载的规则。例如：允许所有文件读取，禁止任何 rm/delete 操作..."
          spellCheck={false}
        />
      </Field>

      <Field label="拼接 System Prompt 到人格前">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <input
            type="checkbox"
            checked={!!config.prependSystemToEgo}
            onChange={(e) => set('prependSystemToEgo', e.target.checked || undefined)}
            style={{ accentColor: 'var(--status-success)' }}
          />
          <span style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>启用后，System 常量（Vesper 叙事）会拼在每个 ego 身份之前</span>
        </div>
      </Field>

      <Field label="拼接近期对话历史到 System Prompt">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <input
            type="checkbox"
            checked={!!config.injectCanvasHistory}
            onChange={(e) => set('injectCanvasHistory', e.target.checked || undefined)}
            style={{ accentColor: 'var(--status-success)' }}
          />
          <span style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>将折叠块的摘要加载到 System Prompt。关闭时，仅注入当前活跃的（未折叠的）对话内容</span>
        </div>
      </Field>

      <SectionDivider label="人格档案 (Egos)" />
      <PersonasEditor
        personas={config.personas ?? []}
        onChange={(v) => set('personas', v)}
        profileNames={profileNames}
      />
    </div>
  );
}

// ===========================================================================
// Tab: Profiles (list ↔ inline edit)
// ===========================================================================

function ProfilesTab({ profiles, onChange }: {
  profiles: Record<string, ProfileConfig>;
  onChange: (v: Record<string, ProfileConfig>) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [addName, setAddName] = useState('');

  const entries = Object.entries(profiles);

  const handleAdd = () => {
    const name = addName.trim();
    if (!name || name in profiles) return;
    onChange({ ...profiles, [name]: {} });
    setAddName('');
    setEditing(name);
  };

  const handleDelete = (name: string) => {
    const copy = { ...profiles };
    delete copy[name];
    onChange(copy);
    if (editing === name) setEditing(null);
  };

  const handleUpdate = (name: string, value: ProfileConfig) => {
    onChange({ ...profiles, [name]: value });
  };

  // ── Editing mode ──
  if (editing !== null) {
    const profile = profiles[editing];
    if (!profile) { setEditing(null); return null; }

    return (
      <div style={styles.tabContent}>
        <button style={styles.backBtn} onClick={() => setEditing(null)}>
          &larr; 返回列表
        </button>
        <div style={styles.editingHeader}>正在编辑方案: {editing}</div>
        <ProfileEditor
          value={profile}
          onChange={(v) => handleUpdate(editing, v)}
        />
      </div>
    );
  }

  // ── List mode ──
  return (
    <div style={styles.tabContent}>
      {entries.length === 0 && (
        <div style={styles.emptyHint}>尚未定义配置方案。请在下方添加。</div>
      )}
      {entries.map(([name, p]) => (
        <div key={name} style={styles.profileRow}>
          <div style={styles.profileInfo}>
            <span style={styles.profileName}>{name}</span>
            <span style={styles.profileMeta}>
              {p.model ?? '(未指定模型)'}
              {p.baseURL ? ` @ ${hostOf(p.baseURL)}` : ''}
            </span>
          </div>
          <button style={styles.editBtn} onClick={() => setEditing(name)}>编辑</button>
          <button style={styles.deleteBtn} onClick={() => handleDelete(name)}>&times;</button>
        </div>
      ))}

      <div style={styles.addRow}>
        <input
          style={styles.addInput}
          value={addName}
          onChange={(e) => setAddName(e.target.value)}
          placeholder="方案名称 (如: DeepSeek, Local-Ollama)"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAdd(); }}
        />
        <button style={styles.addBtn} onClick={handleAdd}>+ 添加方案</button>
      </div>
    </div>
  );
}

// ===========================================================================
// Sub-editors
// ===========================================================================

function ProfileEditor({ value, onChange }: { value: ProfileConfig; onChange: (v: ProfileConfig) => void }) {
  const set = (k: keyof ProfileConfig, v: any) => {
    const next = { ...value };
    if (v === '' || v === undefined || v === null) {
      delete next[k];
    } else {
      (next as any)[k] = v;
    }
    onChange(next);
  };
  const setNum = (k: keyof ProfileConfig, raw: string) => {
    const n = parseInt(raw, 10);
    set(k, isNaN(n) ? undefined : n);
  };

  const handleProviderPick = (t: ProviderTemplate) => {
    const updates: Partial<ProfileConfig> = { providerType: t.providerType };
    if (!t.custom) {
      updates.baseURL = t.baseURL;
      if (t.models.length > 0 && !value.model) {
        updates.model = t.models[0];
      }
    }
    onChange({ ...value, ...updates });
  };

  return (
    <>
      <label style={styles.sectionLabel}>服务商 (Provider)</label>
      <ProviderPicker onSelect={handleProviderPick} selectedBaseURL={value.baseURL} />

      <Field label="模型 (Model)">
        <input style={styles.input} value={value.model ?? ''} onChange={(e) => set('model', e.target.value)} placeholder="模型名称" />
      </Field>
      <Field label="接口地址 (Base URL)">
        <input style={styles.input} value={value.baseURL ?? ''} onChange={(e) => set('baseURL', e.target.value)} placeholder="https://..." />
      </Field>
      <Field label="服务商类型">
        <Select value={value.providerType ?? 'openai'} onChange={(v) => set('providerType', v)} options={[
          { label: 'OpenAI 兼容', value: 'openai' },
          { label: 'Anthropic (Claude)', value: 'anthropic' },
        ]} />
      </Field>
      <Field label="API 密钥">
        <input style={styles.input} type="password" value={value.apiKey ?? ''} onChange={(e) => set('apiKey', e.target.value)} placeholder="sk-..." />
      </Field>
      <Field label="代理 (Proxy)">
        <input style={styles.input} value={value.proxy ?? ''} onChange={(e) => set('proxy', e.target.value)} placeholder="http://..." />
      </Field>
      <div style={styles.row}>
        <Field label="最大迭代次数">
          <input style={styles.input} type="number" value={value.maxIterations ?? ''} onChange={(e) => setNum('maxIterations', e.target.value)} placeholder="200" min={1} max={500} />
        </Field>
        <Field label="上下文容量 (Tokens)">
          <input style={styles.input} type="number" value={value.maxCanvasTokens ?? ''} onChange={(e) => setNum('maxCanvasTokens', e.target.value)} placeholder="128000" min={1000} />
        </Field>
      </div>

      <SectionDivider label="思维与推理 (Thinking)" />
      <ThinkingEditor
        value={value.thinking ?? {}}
        onChange={(v) => set('thinking', Object.keys(v).length ? v : undefined)}
      />

      <SectionDivider label="多模态支持 (Multimodal)" />
      <Checkbox label="图像 (Vision) — 模型支持接收图片输入" checked={value.supportsVision !== false} onChange={(v) => set('supportsVision', v ? undefined : false)} />
      <Checkbox label="GIF 动图 — 模型支持接收 GIF 图片（体积大，多数模型不支持，默认关闭）" checked={value.supportsGif === true} onChange={(v) => set('supportsGif', v ? true : undefined)} />
      <Checkbox label="音频 (Audio) — 模型支持接收音频输入" checked={value.supportsAudio !== false} onChange={(v) => set('supportsAudio', v ? undefined : false)} />
      <Checkbox label="使用 user 伪装代替 system 消息作为插入提示" checked={value.injectAsUser !== false} onChange={(v) => set('injectAsUser', v ? undefined : false)} />

      <SectionDivider label="并发与限制" />
      <Field label="Subagent 并发数">
        <input style={styles.input} type="number" value={value.maxConcurrentSubagents ?? ''} onChange={(e) => setNum('maxConcurrentSubagents', e.target.value)} placeholder="2" min={1} max={32} />
      </Field>
    </>
  );
}

function McpServerEditor({ value, onChange }: { value: McpServerConfig; onChange: (v: McpServerConfig) => void }) {
  const set = (k: keyof McpServerConfig, v: any) => {
    const next = { ...value };
    if (v === '' || v === undefined) {
      delete (next as any)[k];
    } else {
      (next as any)[k] = v;
    }
    onChange(next);
  };
  const mcpType = value.type ?? 'stdio';

  return (
    <>
      <Field label="连接类型">
        <Select value={mcpType} onChange={(v) => set('type', v)} options={[
          { label: 'Stdio (本地进程)', value: 'stdio' },
          { label: 'HTTP (流式接口)', value: 'http' },
          { label: 'SSE (传统接口)', value: 'sse' },
        ]} />
      </Field>
      {mcpType === 'stdio' ? (
        <>
          <Field label="执行命令">
            <input style={styles.input} value={value.command ?? ''} onChange={(e) => set('command', e.target.value)} placeholder="npx -y @some/mcp-server" />
          </Field>
          <Field label="启动参数">
            <input
              style={styles.input}
              value={(value.args ?? []).join(' ')}
              onChange={(e) => {
                const raw = e.target.value;
                if (!raw.trim()) { set('args', undefined); return; }
                set('args', raw.split(/\s+/).filter(Boolean));
              }}
              placeholder="e.g. --option value"
            />
          </Field>
        </>
      ) : (
        <Field label="服务器地址 (URL)">
          <input style={styles.input} value={value.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://mcp.example.com/mcp" />
        </Field>
      )}
      <Field label="环境变量 (Env)">
        <KeyValueEditor
          value={value.env ?? {}}
          onChange={(v) => set('env', Object.keys(v).length ? v : undefined)}
          keyPlaceholder="变量名"
          valuePlaceholder="变量值"
        />
      </Field>
    </>
  );
}

function ThinkingEditor({ value, onChange }: { value: ThinkingConfig; onChange: (v: ThinkingConfig) => void }) {
  const set = (k: keyof ThinkingConfig, v: any) => {
    const next = { ...value };
    if (v === undefined || v === '' || v === false) {
      delete (next as any)[k];
    } else {
      (next as any)[k] = v;
    }
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5em' }}>
      <Checkbox label="启用推理模式 (Enabled)" checked={value.enabled ?? false} onChange={(v) => set('enabled', v || undefined)} />
      <Field label="推理深度 (Effort) — OpenAI o系列模型">
        <Select value={value.effort ?? 'medium'} onChange={(v) => set('effort', v)} options={[
          { label: '低 (Low)', value: 'low' },
          { label: '中 (Medium)', value: 'medium' },
          { label: '高 (High)', value: 'high' },
          { label: '极高 (XHigh)', value: 'xhigh' },
          { label: '最大 (Max)', value: 'max' },
        ]} />
      </Field>
      <Checkbox label="思维回声 (Echo) - 将推理过程发送回模型" checked={value.echo ?? false} onChange={(v) => set('echo', v || undefined)} />
      <Field label="回声字段名 (Field Name)">
        <input style={styles.input} value={value.echoField ?? ''} onChange={(e) => set('echoField', e.target.value)} placeholder="reasoning_content" />
      </Field>
      <Checkbox label="持久化 (Persist) - 在会话记录中保存思维块" checked={value.persist ?? false} onChange={(v) => set('persist', v || undefined)} />
      <Checkbox
        label="DeepSeek风格化思维链 - 在系统提示词开头插入角色沉浸要求"
        checked={value.deepseekStylized ?? false}
        onChange={(v) => set('deepseekStylized', v || undefined)}
      />
    </div>
  );
}

// ===========================================================================
// Shared UI atoms
// ===========================================================================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.field}>
      <label style={{ color: theme.dimText, fontSize: '0.9em' }}>{label}:</label>
      {children}
    </div>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={styles.checkbox}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ color: theme.dimText, fontSize: '0.9em' }}>{label}</span>
    </label>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={styles.sectionDivider}>
      <span style={styles.sectionLabel}>{label}</span>
      <div style={styles.sectionLine} />
    </div>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

// ===========================================================================
// Tab: Team (Roles & Assignments)
// ===========================================================================

const CORE_ROLES = ['planner', 'architect', 'developer', 'reviewer', 'overseer'];
const PRESET_ROLES = [
  'explorer', 'reviewer', 'developer', 'architect', 'quick-fix', 
  'debugger', 'writer', 'daily', 'analyst', 'planner', 
  'skill-crafter', 'prompt-designer', 'overseer'
];
const BUILTIN_SUBAGENTS = [
  { name: 'curator', label: 'Curator（记忆整理）' },
  { name: 'memory_agent', label: 'Memory Agent（记忆巩固）' },
  { name: 'supervisor', label: 'Supervisor（监督者）' },
];

function TeamTab({ config, set, bridge }: {
  config: VesperConfig;
  set: <K extends keyof VesperConfig>(key: K, value: VesperConfig[K]) => void;
  bridge: Bridge;
}) {
  const roles = config.roles ?? {};
  const assignments = config.assignments ?? [];
  const personas = (config.personas ?? []).map(p => p.name);

  // ⚡ 修复逻辑：主动补全缺失的核心岗位 (Optimized)
  const handleRepairAll = useCallback(() => {
    console.log('[Debug] RepairAll clicked. assignments in memory:', assignments);
    
    // Calculate all preset roles that SHOULD be present or fixed
    const existingNames = assignments.map(a => a.roleName);
    const uniqueTargets = Array.from(new Set([...CORE_ROLES, ...existingNames])).filter(name => PRESET_ROLES.includes(name));
    
    const targetsToFetch = uniqueTargets.filter(name => {
      const a = assignments.find(item => item.roleName === name);
      // Fix if missing, or prompt is very short/placeholder
      return !a || !a.customPrompt || a.customPrompt.length < 30;
    });

    console.log('[Debug] Targets identified for repair:', targetsToFetch);
    
    if (targetsToFetch.length === 0) {
      alert('所有核心及内置岗位指令已齐全。');
      return;
    }

    // Capture the absolute latest assignments from config before starting batch fetch
    let workingAssignments = [...(config.assignments || [])];

    targetsToFetch.forEach(roleName => {
      const filename = `roles/role-${roleName}.md`;
      console.log(`[Debug] Requesting: ${filename}`);
      
      const unsub = bridge.onMetaEvent((ev) => {
        if (ev.type === 'prompt_content' && ev.filename && ev.filename.includes(roleName)) {
          console.log(`[Debug] Content back for: ${roleName}`);
          
          // Use functional-like update: always base on the latest state we have
          let idx = workingAssignments.findIndex(item => item.roleName === roleName);
          
          const updatedItem: RoleAssignmentConfig = {
            roleName,
            personaName: (idx >= 0 ? workingAssignments[idx].personaName : ''),
            isActive: (idx >= 0 ? workingAssignments[idx].isActive : true),
            customPrompt: ev.content || '',
            customDescription: (idx >= 0 && workingAssignments[idx].customDescription && !workingAssignments[idx].customDescription.includes('例如：'))
              ? workingAssignments[idx].customDescription 
              : `担任系统内置的 ${roleName} 岗位。`
          };

          if (idx >= 0) workingAssignments[idx] = updatedItem;
          else workingAssignments.push(updatedItem);
          
          // Final sync to state
          set('assignments', [...workingAssignments]);
          unsub();
        }
      });
      bridge.readPrompt(filename);
    });
  }, [assignments, bridge, set, config.assignments]);

  const coreAssignments = CORE_ROLES.map(roleName => {
    return assignments.find(a => a.roleName === roleName) || { roleName, personaName: '', isActive: true };
  });

  const extensionAssignments = assignments.filter(a => !CORE_ROLES.includes(a.roleName));

  const handleUpdateCore = (updated: RoleAssignmentConfig) => {
    const next = [...assignments];
    const existingIdx = next.findIndex(a => a.roleName === updated.roleName);
    if (existingIdx >= 0) {
      next[existingIdx] = updated;
    } else {
      next.push(updated);
    }
    set('assignments', next);
  };

  const handleUpdateExtensions = (v: RoleAssignmentConfig[]) => {
    const next = [...coreAssignments, ...v];
    set('assignments', next);
  };

  return (
    <div style={styles.tabContent}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionDivider label="岗位分工定义 (Role Definitions)" />
        <button style={{ ...styles.addBtn, fontSize: '0.85em', padding: '6px 16px', background: 'var(--status-success-dark)', color: 'var(--btn-primary-text, #FFFFFF)' }} onClick={handleRepairAll}>
          ⚡ 修复/同步内置岗位指令
        </button>
      </div>
      
      <MapEditor<RoleConfig>
        value={roles}
        onChange={(v) => set('roles', Object.keys(v).length ? v : undefined)}
        createDefault={() => ({ toolset: 'default' })}
        addLabel="添加自定义岗位"
        renderItem={(_key, item, onChange) => (
          <RoleEditor value={item} onChange={onChange} />
        )}
      />

      <div style={{ marginTop: '1em' }}>
        <SectionDivider label="核心基座分工 (Core Base)" />
        <div style={styles.emptyHint}>这些岗位由系统核心逻辑驱动，必须指派人格担任。</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em' }}>
          {coreAssignments.map((item) => (
            <div key={item.roleName} style={{ ...styles.profileRow, alignItems: 'flex-start' }}>
              <MemberEditor 
                value={item} 
                onChange={handleUpdateCore} 
                roles={Object.keys(roles)} 
                personas={personas}
                isCore={true}
                bridge={bridge}
              />
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: '1.5em' }}>
        <SectionDivider label="额外成员分工 (Extensions)" />
        <ListEditor<RoleAssignmentConfig>
          value={extensionAssignments}
          onChange={handleUpdateExtensions}
          createDefault={() => ({ personaName: '', roleName: '', isActive: true })}
          addLabel="添加成员分工"
          renderItem={(item, onChange) => (
            <MemberEditor 
              value={item} 
              onChange={onChange} 
              roles={Object.keys(roles)} 
              personas={personas}
              bridge={bridge}
            />
          )}
        />
      </div>

      {/* ── Subagent Ego Assignments ── */}
      <div style={{ marginTop: '1.5em' }}>
        <SectionDivider label="子智能体分工 (Subagent Assignments)" />
        <div style={styles.emptyHint}>为内嵌子智能体分配人格。分配后，子智能体运行时会注入该人格的 ego 提示词。</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em', marginTop: '0.5em' }}>
          {BUILTIN_SUBAGENTS.map(({ name, label }) => {
            const current = (config.subagentAssignments ?? []).find((a: any) => a.subagentName === name);
            return (
              <div key={name} style={{ ...styles.profileRow, alignItems: 'center' }}>
                <span style={{ ...styles.fieldLabel, minWidth: '8em' }}>{label}</span>
                <Select
                  value={current?.personaName ?? ''}
                  onChange={(v) => {
                    const currentAssignments = [...(config.subagentAssignments ?? [])];
                    const idx = currentAssignments.findIndex((a: any) => a.subagentName === name);
                    const newAssignment: SubagentAssignmentConfig = { subagentName: name, personaName: v || undefined };
                    if (idx >= 0) currentAssignments[idx] = newAssignment;
                    else currentAssignments.push(newAssignment);
                    set('subagentAssignments' as any, currentAssignments);
                  }}
                  placeholder="（不注入 ego）"
                  options={personas.map((p: string) => ({ label: p, value: p }))}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Multi-chat Configuration ── */}
      <div style={{ marginTop: '1.5em' }}>
        <SectionDivider label="多人聊天配置 (Multi-Chat)" />
        <div style={styles.emptyHint}>多人聊天模式下的预测轮数和发言控制。</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em', marginTop: '0.5em' }}>
          <Field label="预测上下文轮数">
            <input
              type="number"
              style={{ ...styles.input, width: '6em' }}
              value={config.multiChatRounds ?? 0}
              min={0}
              onChange={(e) => set('multiChatRounds' as any, parseInt(e.target.value, 10) || 0)}
              placeholder="0"
            />
            <span style={{ marginLeft: '0.5em', color: theme.dimText, fontSize: '0.85em' }}>
              0 = 完整画布
            </span>
          </Field>
          <Field label="主人未发言提示轮数">
            <input
              type="number"
              style={{ ...styles.input, width: '6em' }}
              value={config.multiChatOwnerHintRounds ?? 5}
              min={1}
              onChange={(e) => set('multiChatOwnerHintRounds' as any, parseInt(e.target.value, 10) || 5)}
              placeholder="5"
            />
            <span style={{ marginLeft: '0.5em', color: theme.dimText, fontSize: '0.85em' }}>
              N轮未选主人后注入提升概率提示
            </span>
          </Field>
          <Field label="强制切换主人轮数">
            <input
              type="number"
              style={{ ...styles.input, width: '6em' }}
              value={config.multiChatOwnerForceRounds ?? 20}
              min={1}
              onChange={(e) => set('multiChatOwnerForceRounds' as any, parseInt(e.target.value, 10) || 20)}
              placeholder="20"
            />
            <span style={{ marginLeft: '0.5em', color: theme.dimText, fontSize: '0.85em' }}>
              超过此数强制交还主人发言
            </span>
          </Field>
        </div>
      </div>
    </div>
  );
}

function RoleEditor({ value, onChange }: { value: RoleConfig; onChange: (v: RoleConfig) => void }) {
  const set = (k: keyof RoleConfig, v: any) => {
    const next = { ...value };
    if (v === '' || v === undefined) {
      delete (next as any)[k];
    } else {
      (next as any)[k] = v;
    }
    onChange(next);
  };

  return (
    <>
      <Field label="工具集 (Toolset)">
        <Select value={value.toolset ?? 'default'} onChange={(v) => set('toolset', v)} options={[
          { label: '默认 (Default)', value: 'default' },
          { label: '最小化 (Minimal)', value: 'minimal' },
          { label: '最小只读 (Minimal RO)', value: 'minimal_read_only' },
          { label: '只读 (Read Only)', value: 'read_only' },
          { label: '读写 (Read Write)', value: 'read_write' },
          { label: '编程 (Coding)', value: 'coding' },
          { label: '受限 (Guarded)', value: 'guarded' },
          { label: '全功能 (Full)', value: 'full' },
        ]} />
      </Field>
      <Field label="职责描述 (Description)">
        <input style={styles.input} value={value.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="该角色负责做什么..." />
      </Field>
    </>
  );
}

function MemberEditor({ value, onChange, roles, personas, isCore, bridge }: {
  value: RoleAssignmentConfig;
  onChange: (v: RoleAssignmentConfig) => void;
  roles: string[];
  personas: string[];
  isCore?: boolean;
  bridge: Bridge;
}) {
  const requestedRef = useRef<string | null>(null);

  // Auto-fill logic
  useEffect(() => {
    const isPreset = PRESET_ROLES.includes(value.roleName);
    if (!isPreset || !value.roleName) return;

    // Check if we need content
    const needsPrompt = !value.customPrompt || value.customPrompt.length < 10;
    const needsDesc = !value.customDescription || value.customDescription.includes('例如：');

    if (needsPrompt || needsDesc) {
      const cacheKey = `${value.roleName}:${needsPrompt}:${needsDesc}`;
      if (requestedRef.current === cacheKey) return;
      requestedRef.current = cacheKey;

      const filename = `roles/role-${value.roleName}.md`;
      const unsub = bridge.onMetaEvent((ev) => {
        if (ev.type === 'prompt_content' && ev.filename && ev.filename.includes(value.roleName)) {
          const updates: Partial<RoleAssignmentConfig> = {};
          if (needsPrompt) updates.customPrompt = ev.content || '';
          if (needsDesc) updates.customDescription = `担任系统内置的 ${value.roleName} 岗位。`;
          
          if (Object.keys(updates).length > 0) {
            onChange({ ...value, ...updates });
          }
          unsub();
        }
      });
      bridge.readPrompt(filename);
      return unsub;
    }
  }, [value.roleName, value.customPrompt, value.customDescription, bridge, onChange]);

  const set = (k: keyof RoleAssignmentConfig, v: any) => {
    if (k === 'roleName') requestedRef.current = null;
    onChange({ ...value, [k]: v });
  };

  const allRoleOptions = Array.from(new Set([...PRESET_ROLES, ...roles]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5em', width: '100%' }}>
      <div style={{ display: 'flex', gap: '1ch', alignItems: 'center' }}>
        {isCore ? (
          <>
            <span style={{ color: theme.toolName, fontWeight: 'bold', minWidth: '80px' }}>{value.roleName}</span>
            <span style={{ color: theme.dimText }}>由</span>
            <Select
              value={value.personaName}
              onChange={(v) => set('personaName', v)}
              placeholder="不分配成员"
              options={personas.map(p => ({ label: p, value: p }))}
              style={{ flex: 1 }}
            />
            <span style={{ color: theme.dimText }}>担任</span>
          </>
        ) : (
          <>
            <Select
              value={value.personaName}
              onChange={(v) => set('personaName', v)}
              placeholder="(选择人格)"
              options={personas.map(p => ({ label: p, value: p }))}
              style={{ flex: 1 }}
            />
            <span style={{ color: theme.dimText }}>担任</span>
            <Select
              value={value.roleName}
              onChange={(v) => set('roleName', v)}
              placeholder="(选择角色)"
              options={allRoleOptions.map(r => ({ label: r, value: r }))}
              style={{ flex: 1 }}
            />
            <Checkbox label="启用" checked={value.isActive} onChange={(v) => set('isActive', v)} />
          </>
        )}
      </div>
      <Field label="分工描述 (Description)">
        <input
          style={styles.input}
          value={value.customDescription ?? ''}
          onChange={(e) => set('customDescription', e.target.value || undefined)}
          placeholder="例如：她是长女..."
        />
      </Field>
      <Field label="分工特定指令 (Prompt)">
        <textarea
          style={{ ...styles.input, minHeight: '4em', resize: 'vertical', fontFamily: 'inherit' }}
          value={value.customPrompt ?? ''}
          onChange={(e) => set('customPrompt', e.target.value || undefined)}
          placeholder="针对该任务的特定指令..."
          spellCheck={false}
        />
      </Field>
    </div>
  );
}

function PersonasEditor({ personas, onChange, profileNames }: {
  personas: PersonaConfig[];
  onChange: (v: PersonaConfig[]) => void;
  profileNames: string[];
}) {
  return (
    <ListEditor<PersonaConfig>
      value={personas}
      onChange={onChange}
      createDefault={() => ({ name: '新的人格', ego: 'default' })}
      addLabel="添加人格"
      renderItem={(item, onChange) => (
        <PersonaItemEditor value={item} onChange={onChange} profileNames={profileNames} />
      )}
    />
  );
}

function PersonaItemEditor({ value, onChange, profileNames }: { value: PersonaConfig; onChange: (v: PersonaConfig) => void; profileNames: string[] }) {
  const set = (k: keyof PersonaConfig, v: any) => {
    const next = { ...value };
    if (v === '' || v === undefined) {
      delete (next as any)[k];
    } else {
      (next as any)[k] = v;
    }
    onChange(next);
  };

  const privateWs = value.privateWorkspace;
  const setPrivateWs = (updates: Partial<NonNullable<PersonaConfig['privateWorkspace']>>) => {
    const current = privateWs ?? { enabled: false, path: '', maxSizeMB: 100 };
    const next = { ...current, ...updates };
    set('privateWorkspace', next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5em', width: '100%' }}>
      <Field label="名称 (Name)">
        <input style={styles.input} value={value.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="人格唯一标识" />
      </Field>
      <Field label="描述 (Description)">
        <input style={styles.input} value={value.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="人格职责描述..." />
      </Field>
      <Field label="人格提示词 (Ego Prompt)">
        <textarea
          style={{ ...styles.input, minHeight: '6em', resize: 'vertical', fontFamily: 'inherit' }}
          value={value.ego ?? ''}
          onChange={(e) => set('ego', e.target.value)}
          placeholder="该人格的自我认同和核心指令..."
          spellCheck={false}
        />
      </Field>
      <CollapsibleSection title="模型与后端设置 (Model & Profile)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5em', marginTop: '0.5em' }}>
          <Field label="关联配置方案 (Profile)">
            <Select value={value.profile ?? ''} onChange={(v) => set('profile', v)} placeholder="(使用当前默认方案)" options={profileNames.map(name => ({ label: name, value: name }))} />
          </Field>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', marginTop: '0.25em' }}>
            <input
              type="checkbox"
              checked={value.saveThinkingToDataset ?? false}
              onChange={(e) => set('saveThinkingToDataset', e.target.checked)}
              style={{ accentColor: 'var(--status-success)' }}
            />
            <span style={{ fontSize: '0.9em' }}>保存模型思维链到数据集</span>
          </div>
          <div style={{ fontSize: '0.8em', color: 'var(--text-muted)', marginLeft: '1.5em' }}>
            启用后，该人格的对话数据保存时会包含模型的思考过程（think块）
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="私有目录 (Private Workspace)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5em', marginTop: '0.5em' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
            <input
              type="checkbox"
              checked={privateWs?.enabled ?? false}
              onChange={(e) => setPrivateWs({ enabled: e.target.checked })}
              style={{ accentColor: 'var(--status-success)' }}
            />
            <span style={{ fontSize: '0.9em' }}>启用私有目录</span>
          </div>
          {privateWs?.enabled && (
            <>
              <Field label="目录路径">
                <input
                  style={styles.input}
                  value={privateWs.path ?? ''}
                  onChange={(e) => setPrivateWs({ path: e.target.value })}
                  placeholder="例如: /home/user/.vesper-lite/private/绮梦"
                />
              </Field>
              <Field label="空间限制 (MB)">
                <input
                  type="number"
                  style={{ ...styles.input, width: '8em' }}
                  value={privateWs.maxSizeMB ?? 100}
                  onChange={(e) => setPrivateWs({ maxSizeMB: parseInt(e.target.value) || 100 })}
                  min={1}
                />
              </Field>
            </>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}

function ListEditor<T>({ value, onChange, createDefault, addLabel, renderItem }: {
  value: T[];
  onChange: (v: T[]) => void;
  createDefault: () => T;
  addLabel: string;
  renderItem: (item: T, onChange: (v: T) => void) => React.ReactNode;
}) {
  const handleAdd = () => onChange([...value, createDefault()]);
  const handleRemove = (idx: number) => {
    const next = [...value];
    next.splice(idx, 1);
    onChange(next);
  };
  const handleUpdate = (idx: number, item: T) => {
    const next = [...value];
    next[idx] = item;
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em' }}>
      {value.map((item, idx) => (
        <div key={idx} style={{ ...styles.profileRow, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>{renderItem(item, (v) => handleUpdate(idx, v))}</div>
          <button style={styles.deleteBtn} onClick={() => handleRemove(idx)}>&times;</button>
        </div>
      ))}
      <button style={styles.addBtn} onClick={handleAdd}>+ {addLabel}</button>
    </div>
  );
}

function stripEmpty(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stripEmpty);
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      // Preserve empty string for personaName (means "no member assigned")
      if (v === '' && k !== 'personaName') continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        const cleaned = stripEmpty(v);
        if (Object.keys(cleaned).length > 0) out[k] = cleaned;
      } else if (Array.isArray(v)) {
        if (v.length > 0) out[k] = stripEmpty(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return obj;
}

// ===========================================================================
// Styles
// ===========================================================================

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
    padding: '1em',
    animation: 'fade-in 0.2s ease-out',
  },
  panel: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    width: '100%',
    maxWidth: '120ch',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    animation: 'scale-in 0.2s ease-out',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '1ch',
    padding: '0.5em 1ch',
    borderBottom: '1px solid var(--border-color)',
    flexShrink: 0,
  },
  pathHint: {
    flex: 1,
    color: theme.dimText,
    fontSize: '0.8em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: '0 0.5ch',
  },

  // Tab bar
  tabBar: {
    display: 'flex',
    gap: 0,
    borderBottom: '1px solid var(--border-color)',
    flexShrink: 0,
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollbarWidth: 'none',
  },
  tab: {
    padding: '0.4em 1.5ch',
    background: 'transparent',
    border: 'none',
    color: theme.dimText,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    outline: 'none',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  tabActive: {
    color: 'var(--text-primary)',
    background: 'var(--bg-secondary)',
  },
  tabBadge: {
    background: 'var(--accent-blue)',
    color: 'var(--btn-primary-text, #FFFFFF)',
    padding: '0 0.5ch',
    borderRadius: '2px',
    fontSize: '0.8em',
  },

  // Body
  loading: {
    padding: '2em',
    textAlign: 'center',
    color: theme.dimText,
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
  },
  tabContent: {
    padding: '1em 1.5ch',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75em',
  },

  // Footer
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '1ch',
    padding: '0.5em 1ch',
    borderTop: '1px solid var(--border-color)',
    flexShrink: 0,
  },
  errorText: {
    color: theme.errorText,
    fontSize: '0.85em',
    maxWidth: '40ch',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cancelBtn: {
    padding: '0.25em 1ch',
    background: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-secondary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
  },
  saveBtn: {
    padding: '0.25em 2ch',
    background: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '2px',
    color: 'var(--btn-primary-text, #FFFFFF)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'bold',
    cursor: 'pointer',
  },

  // Generic button style (used by QQ Bot controls)
  btn: {
    padding: '0.25em 1ch',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-color)',
    borderRadius: '3px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    transition: 'background 0.15s ease, opacity 0.15s ease',
  },

  // Section divider
  sectionDivider: {
    display: 'flex',
    alignItems: 'center',
    gap: '1ch',
    marginTop: '0.5em',
  },
  sectionLabel: {
    color: theme.dimText,
    fontSize: '0.85em',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  sectionLine: {
    flex: 1,
    height: '1px',
    background: 'var(--border-color)',
  },

  // Fields
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2em',
  },
  row: {
    display: 'flex',
    gap: '1ch',
  },
  input: {
    padding: '0.25em 1ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    cursor: 'pointer',
  },

  // Profiles list
  profileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    padding: '0.4em 0.8ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '3px',
  },
  profileInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.1em',
    overflow: 'hidden',
  },
  profileName: {
    color: theme.toolName,
    fontWeight: 'bold',
  },
  profileMeta: {
    color: theme.dimText,
    fontSize: '0.85em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  editBtn: {
    padding: '0.15em 0.8ch',
    background: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '2px',
    color: 'var(--btn-primary-text, #FFFFFF)',
    fontFamily: 'inherit',
    fontSize: '0.85em',
    cursor: 'pointer',
  },
  deleteBtn: {
    padding: '0.15em 0.5ch',
    background: 'transparent',
    border: 'none',
    color: theme.errorText,
    fontFamily: 'inherit',
    fontSize: '1.1em',
    cursor: 'pointer',
  },
  addRow: {
    display: 'flex',
    gap: '0.5ch',
    marginTop: '0.25em',
  },
  addInput: {
    flex: 1,
    padding: '0.25em 0.5ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
  },
  addBtn: {
    padding: '0.25em 1ch',
    background: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '2px',
    color: 'var(--btn-primary-text, #FFFFFF)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
  backBtn: {
    padding: '0.25em 1ch',
    background: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: '2px',
    color: 'var(--text-secondary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  editingHeader: {
    color: theme.toolName,
    fontWeight: 'bold',
    fontSize: '1.1em',
  },
  emptyHint: {
    color: theme.dimText,
    padding: '0.5em 0',
  },
  warn: {
    padding: '0.5em 0.8ch',
    background: 'var(--status-error-dark)',
    border: '1px solid var(--status-warning)',
    borderRadius: '2px',
    color: 'var(--status-warning)',
    fontSize: '0.85em',
  },
  lanInfoBox: {
    padding: '0.6em 1ch',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--status-success-dark)',
    borderRadius: '3px',
    color: 'var(--status-success-light)',
    fontSize: '0.9em',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.2em',
  },
  lanInfoLabel: {
    color: 'var(--status-success)',
    fontWeight: 'bold' as const,
  },
};

// ---------------------------------------------------------------------------
// ScenesTab Component
// ---------------------------------------------------------------------------

interface ScenesTabProps {
  bridge: Bridge;
  storeRef: { current: { getSnapshot: () => any; subscribe: (fn: () => void) => () => void } | null };
}

export function ScenesTab({
  bridge,
  storeRef,
}: ScenesTabProps) {
  // Subscribe to store changes and always read latest snapshot
  // Debounce: scene/cron data changes infrequently, no need to re-render on every streaming token
  const [tick, setTick] = useState(0);
  const [requestedInitial, setRequestedInitial] = useState(false);

  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    return store.subscribe(() => {
      // Reset timer on each update — only fire after 300ms of silence (trailing-edge debounce)
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setTick(t => t + 1);
      }, 300);
    });
  }, [storeRef]);

  // Request scene list on first render only
  useEffect(() => {
    if (requestedInitial) return;
    const store = storeRef.current;
    if (!store) return;
    const sid = store.getSnapshot()?.sessionId ?? '';
    if (sid) {
      setRequestedInitial(true);
      bridge.sendSceneCommand(sid, { cmd: 'scene_list', id: 'scene-list-init' });
    }
  }, [bridge, storeRef, requestedInitial]);

  const snapshot = storeRef.current?.getSnapshot();
  const sessionId = snapshot?.sessionId ?? '';
  const scenes = snapshot?.scenes ?? [];
  const activeScene = snapshot?.activeScene ?? null;
  const sceneDetail = snapshot?.sceneDetail ?? null;
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
  const [selectedSceneName, setSelectedSceneName] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState<string | null>(null);
  const [confirmClosing, setConfirmClosing] = useState(false);

  const handleCloseConfirm = useCallback(() => {
    setConfirmClosing(true);
    setTimeout(() => {
      setConfirmDelete(null);
      setConfirmOverwrite(null);
      setConfirmClosing(false);
    }, 200);
  }, []);

  // Load scene detail when switching to detail view
  useEffect(() => {
    if (view === 'detail' && selectedSceneName && selectedSceneName !== sceneDetail?.name) {
      bridge.sendSceneCommand(sessionId, { cmd: 'scene_load', id: 'scene-load-detail', name: selectedSceneName });
    }
  }, [view, selectedSceneName, sceneDetail, bridge, sessionId]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    bridge.sendSceneCommand(sessionId, { cmd: 'scene_create', id: 'scene-create', name: newName.trim(), description: newDesc.trim() || undefined });
    setNewName('');
    setNewDesc('');
    setView('list');
    // Refresh list after create
    setTimeout(() => {
      bridge.sendSceneCommand(sessionId, { cmd: 'scene_list', id: 'scene-list-refresh' });
    }, 200);
  };

  const handleSaveAs = (name?: string) => {
    if (!name) return;
    const exists = scenes.find((s: { name: string }) => s.name === name);
    if (exists) {
      setConfirmOverwrite(name);
    } else {
      bridge.sendSceneCommand(sessionId, { cmd: 'scene_save', id: 'scene-save', scene: { name, description: undefined } });
      setTimeout(() => {
        bridge.sendSceneCommand(sessionId, { cmd: 'scene_list', id: 'scene-list-refresh' });
      }, 200);
    }
  };

  const handleLoad = (name: string) => {
    bridge.sendSceneCommand(sessionId, { cmd: 'scene_load', id: 'scene-load', name });
  };

  const handleDelete = (name: string) => {
    bridge.sendSceneCommand(sessionId, { cmd: 'scene_delete', id: 'scene-delete', name });
    setConfirmDelete(null);
    if (sceneDetail?.name === name) setView('list');
    setTimeout(() => {
      bridge.sendSceneCommand(sessionId, { cmd: 'scene_list', id: 'scene-list-refresh' });
    }, 200);
  };

  if (view === 'create') {
    return (
      <div style={sceneStyle.container}>
        <button style={sceneStyle.backBtn} onClick={() => { setView('list'); setNewName(''); setNewDesc(''); }}>
          ← 返回列表
        </button>
        <h3 style={sceneStyle.title}>创建新场景</h3>
        <div style={sceneStyle.field}>
          <label style={sceneStyle.label}>场景名称 <span style={{ color: 'var(--status-warning)' }}>*</span></label>
          <input
            style={sceneStyle.input}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="例如：全自动工作助手"
          />
        </div>
        <div style={sceneStyle.field}>
          <label style={sceneStyle.label}>描述（可选）</label>
          <textarea
            style={sceneStyle.textarea}
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="简要描述这个场景的用途..."
            rows={3}
          />
        </div>
        <div style={sceneStyle.actions}>
          <button style={sceneStyle.primaryBtn} onClick={handleCreate}>创建</button>
          <button style={sceneStyle.secondaryBtn} onClick={() => { setView('list'); setNewName(''); setNewDesc(''); }}>取消</button>
        </div>
      </div>
    );
  }

  // Scene detail view constants
  const SCENE_CORE_ROLES = ['planner', 'architect', 'developer', 'reviewer', 'overseer'];
  const SCENE_BUILTIN_SUBAGENTS = [
    { name: 'curator', label: 'Curator（记忆整理）' },
    { name: 'memory_agent', label: 'Memory Agent（记忆巩固）' },
    { name: 'supervisor', label: 'Supervisor（监督者）' },
  ];

  if (view === 'detail' && sceneDetail) {
    // Categorize assignments
    const sceneCoreAssignments = SCENE_CORE_ROLES.map(rn =>
      sceneDetail.assignments.find((a: any) => a.roleName === rn) || { roleName: rn, personaName: '', isActive: false }
    );
    const sceneExtAssignments = sceneDetail.assignments.filter((a: any) => !SCENE_CORE_ROLES.includes(a.roleName));
    // Egos only: personas that are assigned to roles in the team
    // (assigned personas are the "active egos", unassigned ones are just role templates)
    // Egos only: user-defined personas (source='user') are true egos.
    // Built-in role personas (source='builtin') are job descriptions, not egos.
    const sceneEgos = (sceneDetail.personas || []).filter((p: any) => p.source === 'user');

    return (
      <div style={sceneStyle.container}>
        <button style={sceneStyle.backBtn} onClick={() => { setView('list'); setSelectedSceneName(null); }}>
          ← 返回列表
        </button>

        <h3 style={sceneStyle.title}>{sceneDetail.name}</h3>
        {sceneDetail.description && <p style={sceneStyle.desc}>{sceneDetail.description}</p>}

        {/* Default Profile */}
        <div style={sceneStyle.section}>
          <h4 style={sceneStyle.sectionTitle}>默认配置方案</h4>
          <div style={sceneStyle.detailItem}>
            <span style={sceneStyle.detailValue}>{sceneDetail.defaultProfile || '(未设置)'}</span>
          </div>
        </div>

        {/* Profiles */}
        <div style={sceneStyle.section}>
          <h4 style={sceneStyle.sectionTitle}>配置方案 (Profiles)</h4>
          {sceneDetail.profiles.length === 0 ? (
            <p style={sceneStyle.emptyHint}>无</p>
          ) : sceneDetail.profiles.map((p: any) => (
            <div key={p.name} style={sceneStyle.detailItem}>
              <span style={sceneStyle.detailName}>{p.name}</span>
              <span style={sceneStyle.detailValue}>{p.model} @ {p.baseURL}</span>
            </div>
          ))}
        </div>

        {/* Default Supervisor Rules */}
        {sceneDetail.defaultSupervisorRules && (
          <div style={sceneStyle.section}>
            <h4 style={sceneStyle.sectionTitle}>默认监管规则</h4>
            <div style={sceneStyle.detailItem}>
              <span style={sceneStyle.detailValue}>
                {sceneDetail.defaultSupervisorRules.length > 40
                  ? sceneDetail.defaultSupervisorRules.slice(0, 40) + '…'
                  : sceneDetail.defaultSupervisorRules}
              </span>
            </div>
          </div>
        )}

        {/* Egos only */}
        <div style={sceneStyle.section}>
          <h4 style={sceneStyle.sectionTitle}>人格档案 (Egos)</h4>
          {sceneEgos.length === 0 ? (
            <p style={sceneStyle.emptyHint}>无</p>
          ) : sceneEgos.map((p: any) => (
            <div key={p.name} style={sceneStyle.detailItem}>
              <div>
                <span style={sceneStyle.detailName}>{p.displayName || p.name}</span>
                {p.name !== p.displayName && p.displayName && <span style={sceneStyle.detailNameDim}> ({p.name})</span>}
              </div>
              {p.description && <span style={sceneStyle.detailValue}>{p.description}</span>}
            </div>
          ))}
        </div>

        {/* Core Assignments */}
        <div style={sceneStyle.section}>
          <h4 style={sceneStyle.sectionTitle}>核心基座分工</h4>
          {sceneCoreAssignments.map((a: any) => (
            <div key={a.roleName} style={sceneStyle.detailItem}>
              <span style={sceneStyle.detailName}>{a.roleName}</span>
              <span style={sceneStyle.detailValue}>{a.personaName ? `→ ${a.personaName}` : '(未分配)'}</span>
            </div>
          ))}
        </div>

        {/* Extension Assignments */}
        {sceneExtAssignments.length > 0 && (
          <div style={sceneStyle.section}>
            <h4 style={sceneStyle.sectionTitle}>额外成员分工</h4>
            {sceneExtAssignments.map((a: any, i: number) => (
              <div key={i} style={sceneStyle.detailItem}>
                <span style={sceneStyle.detailName}>{a.roleName}</span>
                <span style={sceneStyle.detailValue}>{a.personaName ? `→ ${a.personaName}` : '(未分配)'}</span>
              </div>
            ))}
          </div>
        )}

        {/* Subagent Assignments */}
        <div style={sceneStyle.section}>
          <h4 style={sceneStyle.sectionTitle}>子智能体分工</h4>
          {SCENE_BUILTIN_SUBAGENTS.map(sa => {
            const assigned = (sceneDetail.subagentAssignments || []).find((a: any) => a.subagentName === sa.name);
            return (
              <div key={sa.name} style={sceneStyle.detailItem}>
                <span style={sceneStyle.detailName}>{sa.label}</span>
                <span style={sceneStyle.detailValue}>{assigned?.personaName || '(未分配)'}</span>
              </div>
            );
          })}
        </div>

        {/* Cron Entries */}
        <div style={sceneStyle.section}>
          <h4 style={sceneStyle.sectionTitle}>定时任务</h4>
          {(!sceneDetail.cronEntries || sceneDetail.cronEntries.length === 0) ? (
            <p style={sceneStyle.emptyHint}>无</p>
          ) : sceneDetail.cronEntries.map((c: any, i: number) => (
            <div key={i} style={sceneStyle.detailItem}>
              <span style={sceneStyle.detailName}>{c.tag || c.description || `任务 ${i + 1}`}</span>
              <span style={sceneStyle.detailValue}>{c.repeatMs ? `每 ${Math.round(c.repeatMs / 60000)} 分钟` : '一次性'}</span>
            </div>
          ))}
        </div>

        {/* Timestamps */}
        <div style={sceneStyle.section}>
          <p style={{ color: theme.dimText, fontSize: '0.85em', margin: 0 }}>
            创建于 {new Date(sceneDetail.createdAt).toLocaleString()}
          </p>
          <p style={{ color: theme.dimText, fontSize: '0.85em', margin: '0.3em 0 0' }}>
            更新于 {new Date(sceneDetail.updatedAt).toLocaleString()}
          </p>
        </div>

        {/* Actions */}
        <div style={sceneStyle.actions}>
          <button style={sceneStyle.primaryBtn} onClick={() => handleSaveAs(sceneDetail.name)}>
            💾 保存当前配置到此场景
          </button>
          <button
            style={{ ...sceneStyle.primaryBtn, background: 'var(--accent-blue)' }}
            onClick={() => handleLoad(sceneDetail.name)}
          >
            🔄 覆盖项目配置
          </button>
          <button
            style={sceneStyle.dangerBtn}
            onClick={() => setConfirmDelete(sceneDetail.name)}
          >
            🗑 删除
          </button>
        </div>

        {/* Confirm overwrite modal (save to scene) */}
        {confirmOverwrite && (
          <div
            style={{ ...sceneStyle.confirmOverlay, animation: confirmClosing ? 'fade-out 0.2s ease-out forwards' : 'fade-in 0.2s ease-out' }}
            onClick={handleCloseConfirm}
          >
            <div
              style={{ ...sceneStyle.confirmBox, animation: confirmClosing ? 'scale-out 0.2s ease-out forwards' : 'scale-in 0.2s ease-out' }}
              onClick={e => e.stopPropagation()}
            >
              <p style={{ color: 'var(--text-primary)', margin: '0 0 0.5em' }}>
                确认覆盖场景 <strong>"{confirmOverwrite}"</strong>？
              </p>
              <p style={{ color: 'var(--text-secondary)', margin: '0 0 1em', fontSize: '0.9em' }}>
                此操作将用当前运行时配置替换该场景的所有内容。
              </p>
              <div style={{ display: 'flex', gap: '0.5em' }}>
                <button style={sceneStyle.primaryBtn} onClick={() => {
                  // Direct save, bypass handleSaveAs check
                  bridge.sendSceneCommand(sessionId, { cmd: 'scene_save', id: 'scene-save-overwrite', scene: { name: confirmOverwrite } });
                  setConfirmOverwrite(null);
                  setTimeout(() => {
                    bridge.sendSceneCommand(sessionId, { cmd: 'scene_list', id: 'scene-list-refresh' });
                  }, 200);
                }}>
                  确认覆盖
                </button>
                <button style={sceneStyle.secondaryBtn} onClick={handleCloseConfirm}>取消</button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm delete modal */}
        {confirmDelete && (
          <div
            style={{ ...sceneStyle.confirmOverlay, animation: confirmClosing ? 'fade-out 0.2s ease-out forwards' : 'fade-in 0.2s ease-out' }}
            onClick={handleCloseConfirm}
          >
            <div
              style={{ ...sceneStyle.confirmBox, animation: confirmClosing ? 'scale-out 0.2s ease-out forwards' : 'scale-in 0.2s ease-out' }}
              onClick={e => e.stopPropagation()}
            >
              <p style={{ color: 'var(--text-primary)', margin: '0 0 0.5em' }}>
                确认删除场景 <strong>"{confirmDelete}"</strong>？
              </p>
              <div style={{ display: 'flex', gap: '0.5em' }}>
                <button style={sceneStyle.dangerBtn} onClick={() => handleDelete(confirmDelete)}>
                  确认删除
                </button>
                <button style={sceneStyle.secondaryBtn} onClick={handleCloseConfirm}>取消</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Default: list view
  return (
    <div style={sceneStyle.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1em' }}>
        <h3 style={{ margin: 0, color: theme.diffContent }}>场景管理</h3>
        <button style={sceneStyle.primaryBtn} onClick={() => setView('create')}>
          + 新建场景
        </button>
      </div>

      {scenes.length === 0 ? (
        <div style={sceneStyle.emptyState}>
          <p style={{ color: theme.dimText, margin: 0 }}>还没有保存的场景。</p>
          <p style={{ color: theme.dimText, margin: '0.5em 0 0', fontSize: '0.9em' }}>
            调整配置（配置方案/人格/角色）后点击「保存当前配置为场景」。
          </p>
        </div>
      ) : (
        <div style={sceneStyle.sceneList}>
          {scenes.map((scene: { name: string; description?: string; isActive: boolean }) => (
            <div
              key={scene.name}
              style={{
                ...sceneStyle.sceneCard,
                ...(scene.name === activeScene ? sceneStyle.sceneCardActive : {}),
              }}
              onClick={() => { setSelectedSceneName(scene.name); setView('detail'); }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={sceneStyle.sceneCardName}>{scene.name}</span>
                  {scene.name === activeScene && <span style={sceneStyle.activeBadge}> 当前</span>}
                </div>
                <span style={sceneStyle.sceneCardArrow}>›</span>
              </div>
              {scene.description && (
                <p style={sceneStyle.sceneCardDesc}>{scene.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Save current as scene quick-action */}
      <div style={sceneStyle.saveCurrent}>
        <p style={{ color: theme.dimText, margin: '0 0 0.5em', fontSize: '0.9em' }}>
          或者，将当前配置保存为新场景：
        </p>
        <button style={sceneStyle.secondaryBtn} onClick={() => { setView('create'); }}>
          💾 保存当前配置为场景
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryViewTab Component (历史视角)
// ---------------------------------------------------------------------------

interface HistoryViewTabProps {
  bridge: Bridge;
  storeRef: { current: { getSnapshot: () => any; subscribe: (fn: () => void) => () => void } | null };
}

export function HistoryViewTab({
  bridge,
  storeRef,
}: HistoryViewTabProps) {
  // Subscribe to store changes (trailing-edge debounce to avoid re-rendering on every streaming token)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    return store.subscribe(() => {
      // Reset timer on each update — only fire after 300ms of silence
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setTick(t => t + 1);
      }, 300);
    });
  }, [storeRef]);

  const snapshot = storeRef.current?.getSnapshot();
  const sessionId = snapshot?.sessionId ?? '';
  const availablePersonas = snapshot?.availablePersonas ?? [];
  const currentPersona = snapshot?.currentPersona ?? null;

  // Selected persona for preview
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Request preview from backend
  const handleSelectPersona = (personaName: string) => {
    console.log('[HistoryView] Selecting persona:', personaName, 'sessionId:', sessionId);
    setSelectedPersona(personaName);
    setLoadingPreview(true);
    bridge.sendSessionCommand(sessionId, { cmd: 'history_preview', id: `hp-${Date.now()}`, personaName });
    console.log('[HistoryView] Sent history_preview command');
  };

  // Listen for preview response (use onSessionEvent because response has sessionId)
  useEffect(() => {
    console.log('[HistoryView] Setting up onSessionEvent listener for selectedPersona:', selectedPersona);
    const unsub = bridge.onSessionEvent((_sid, event) => {
      console.log('[HistoryView] Received session event:', event.type, event);
      if (event.type === 'history_preview_result' && event.personaName === selectedPersona) {
        console.log('[HistoryView] Got matching history_preview_result, preview length:', event.preview?.length);
        setPreviewData(event.preview ?? '');
        setLoadingPreview(false);
      }
    });
    return unsub;
  }, [bridge, selectedPersona]);

  return (
    <div style={historyStyle.container}>
      <h3 style={historyStyle.title}>历史视角 (History View)</h3>
      <p style={historyStyle.desc}>
        选择一个人格，查看其在画布中看到的上下文。不同人格之间的对话会被折叠，切换时可以理解各自的视角。
      </p>

      {/* Persona list */}
      <div style={historyStyle.personaList}>
        {availablePersonas.length === 0 ? (
          <p style={historyStyle.emptyHint}>无可用人格</p>
        ) : availablePersonas.map((p: any) => (
          <div
            key={p.name}
            style={{
              ...historyStyle.personaCard,
              ...(p.name === currentPersona ? historyStyle.personaCardActive : {}),
              ...(p.name === selectedPersona ? historyStyle.personaCardSelected : {}),
            }}
            onClick={() => handleSelectPersona(p.name)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={historyStyle.personaName}>{p.displayName || p.name}</span>
                {p.name === currentPersona && <span style={historyStyle.activeBadge}> 当前</span>}
              </div>
              <span style={historyStyle.personaArrow}>›</span>
            </div>
            {p.description && <p style={historyStyle.personaDesc}>{p.description}</p>}
          </div>
        ))}
      </div>

      {/* Preview area */}
      {selectedPersona && (
        <div style={historyStyle.previewSection}>
          <h4 style={historyStyle.previewTitle}>
            {selectedPersona} 视角的上下文
          </h4>
          {loadingPreview ? (
            <div style={historyStyle.loading}>加载中...</div>
          ) : previewData ? (
            <pre style={historyStyle.previewContent}>{previewData}</pre>
          ) : (
            <div style={historyStyle.emptyHint}>无预览数据</div>
          )}
        </div>
      )}
    </div>
  );
}

const historyStyle: Record<string, React.CSSProperties> = {
  container: { padding: '1em 1.5ch' },
  title: { margin: '0 0 1em', color: theme.diffContent, fontSize: '1.2em' },
  desc: { color: 'var(--text-secondary)', margin: '0 0 1.5em', lineHeight: 1.6 },
  personaList: { marginBottom: '1.5em' },
  personaCard: {
    padding: '0.8em 1em',
    marginBottom: '0.5em',
    background: 'var(--bg-secondary)',
    borderRadius: '4px',
    cursor: 'pointer',
    border: '1px solid var(--border-color)',
    transition: 'border-color 0.15s',
  },
  personaCardActive: {
    borderLeft: '3px solid var(--status-success)',
  },
  personaCardSelected: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--accent-blue)',
  },
  personaName: { color: theme.diffContent, fontWeight: 'bold' },
  personaDesc: { color: theme.dimText, margin: '0.3em 0 0', fontSize: '0.85em' },
  personaArrow: { color: theme.dimText, fontSize: '1.2em' },
  activeBadge: {
    background: 'var(--status-success-dark)', color: 'var(--status-success-light)', padding: '0.1em 0.6ch',
    borderRadius: '2px', fontSize: '0.8em', fontWeight: 'bold', marginLeft: '0.5ch',
  },
  emptyHint: { color: theme.dimText, fontStyle: 'italic' },
  previewSection: {
    marginTop: '1.5em',
    padding: '1em',
    background: 'var(--bg-primary)',
    borderRadius: '4px',
    border: '1px solid var(--border-color)',
  },
  previewTitle: { margin: '0 0 0.8em', color: theme.toolName, fontSize: '1em' },
  previewContent: {
    margin: 0,
    padding: '0.8em',
    background: 'var(--bg-primary)',
    borderRadius: '3px',
    color: theme.diffContent,
    fontSize: '0.85em',
    lineHeight: 1.5,
    overflow: 'auto',
    maxHeight: '50vh',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  loading: { color: theme.dimText, fontStyle: 'italic' },
};

// ===========================================================================
// Tab: Toolsets (工具集查看)
// ===========================================================================

interface ToolsetInfo {
  name: string;
  description: string;
  allowedTools: string[];
  deniedTools?: string[];
  requireApproval?: string[];
  bashCommandRules?: Array<{ pattern: string; action: 'allow' | 'deny' | 'ask' }>;
}

interface ToolsetsInfoResponse {
  type: 'toolsets_info';
  toolsets: ToolsetInfo[];
  infrastructureTools: string[];
  curatorTools: string[];
  qqbotTools: string[];
}

function ToolsetsTab({ bridge }: { bridge: Bridge }) {
  const [data, setData] = useState<ToolsetsInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data on mount (tab is only rendered when active)
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    bridge.sendGlobalCommand({ cmd: 'get_toolsets' });
  }, [bridge]);

  useEffect(() => {
    const unsub = bridge.onMetaEvent((event) => {
      if (event.type === 'toolsets_info') {
        setData(event as ToolsetsInfoResponse);
        setLoading(false);
      }
    });
    return unsub;
  }, [bridge]);

  if (loading) {
    return <div style={toolsetStyle.loading}>加载中...</div>;
  }

  if (error) {
    return <div style={toolsetStyle.error}>{error}</div>;
  }

  if (!data) {
    return <div style={toolsetStyle.error}>未获取到工具集数据</div>;
  }

  // Group infrastructure tools by category
  const infraCategories = groupInfrastructureTools(data.infrastructureTools);

  return (
    <div style={toolsetStyle.container}>
      <h3 style={toolsetStyle.title}>工具集 (Toolsets)</h3>
      <p style={toolsetStyle.desc}>
        查看系统内所有工具集的权限配置。内置工具集不可修改，仅供参考。
      </p>

      {/* Builtin Toolsets */}
      <CollapsibleSection title="内置工具集 (Builtin)" defaultOpen={true}>
        {data.toolsets.map(toolset => (
          <ToolsetCard key={toolset.name} toolset={toolset} />
        ))}
      </CollapsibleSection>

      {/* Infrastructure Tools */}
      <CollapsibleSection title="基础设施工具 (Infrastructure)" defaultOpen={true}>
        <p style={toolsetStyle.hint}>
          这些工具始终可用，不受工具集限制。
        </p>
        {Object.entries(infraCategories).map(([cat, tools]) => (
          <div key={cat} style={toolsetStyle.categorySection}>
            <div style={toolsetStyle.categoryLabel}>{cat}</div>
            <div style={toolsetStyle.toolList}>
              {tools.map(tool => (
                <span key={tool} style={toolsetStyle.toolTag}>{tool}</span>
              ))}
            </div>
          </div>
        ))}
      </CollapsibleSection>

      {/* Special Subagent Tools */}
      <CollapsibleSection title="特殊子代理工具 (Special)" defaultOpen={true}>
        {/* Curator Tools */}
        <div style={toolsetStyle.subagentSection}>
          <div style={toolsetStyle.subagentTitle}>Curator (上下文策展人)</div>
          <p style={toolsetStyle.subagentDesc}>
            策展人子代理专用的画布管理工具，用于折叠、压缩上下文。
          </p>
          <div style={toolsetStyle.toolList}>
            {data.curatorTools.map(tool => (
              <span key={tool} style={toolsetStyle.toolTag}>{tool}</span>
            ))}
          </div>
        </div>

        {/* QQbot Tools */}
        <div style={toolsetStyle.subagentSection}>
          <div style={toolsetStyle.subagentTitle}>QQbot (QQ 机器人)</div>
          <p style={toolsetStyle.subagentDesc}>
            QQ 机器人子代理专用的聊天工具，用于发送消息、表情包等。
          </p>
          <div style={toolsetStyle.toolList}>
            {data.qqbotTools.map(tool => (
              <span key={tool} style={toolsetStyle.toolTag}>{tool}</span>
            ))}
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function ToolsetCard({ toolset }: { toolset: ToolsetInfo }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={toolsetStyle.card}>
      <div
        style={toolsetStyle.cardHeader}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={toolsetStyle.cardName}>{toolset.name}</span>
        <span style={toolsetStyle.cardDesc}>{toolset.description}</span>
        <span style={toolsetStyle.cardArrow}>{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div style={toolsetStyle.cardContent}>
          {/* Allowed Tools */}
          <div style={toolsetStyle.section}>
            <div style={toolsetStyle.sectionLabel}>允许的工具</div>
            <div style={toolsetStyle.toolList}>
              {toolset.allowedTools.map(tool => (
                <span key={tool} style={toolsetStyle.toolTag}>{tool}</span>
              ))}
            </div>
          </div>

          {/* Require Approval */}
          {toolset.requireApproval && toolset.requireApproval.length > 0 && (
            <div style={toolsetStyle.section}>
              <div style={toolsetStyle.sectionLabelWarn}>需审批</div>
              <div style={toolsetStyle.toolList}>
                {toolset.requireApproval.map(tool => (
                  <span key={tool} style={toolsetStyle.toolTagWarn}>{tool}</span>
                ))}
              </div>
            </div>
          )}

          {/* Denied Tools */}
          {toolset.deniedTools && toolset.deniedTools.length > 0 && (
            <div style={toolsetStyle.section}>
              <div style={toolsetStyle.sectionLabelDeny}>禁止</div>
              <div style={toolsetStyle.toolList}>
                {toolset.deniedTools.map(tool => (
                  <span key={tool} style={toolsetStyle.toolTagDeny}>{tool}</span>
                ))}
              </div>
            </div>
          )}

          {/* Bash Command Rules */}
          {toolset.bashCommandRules && toolset.bashCommandRules.length > 0 && (
            <div style={toolsetStyle.section}>
              <div style={toolsetStyle.sectionLabel}>Bash 命令规则</div>
              <div style={toolsetStyle.ruleList}>
                {toolset.bashCommandRules.map((rule, idx) => (
                  <div key={idx} style={toolsetStyle.ruleItem}>
                    <span style={toolsetStyle.rulePattern}>{rule.pattern}</span>
                    <span style={{
                      ...toolsetStyle.ruleAction,
                      ...(rule.action === 'allow' ? toolsetStyle.ruleAllow : {}),
                      ...(rule.action === 'deny' ? toolsetStyle.ruleDeny : {}),
                      ...(rule.action === 'ask' ? toolsetStyle.ruleAsk : {}),
                    }}>
                      {rule.action}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function groupInfrastructureTools(tools: string[]): Record<string, string[]> {
  const categories: Record<string, string[]> = {
    '任务系统': [],
    'Persona': [],
    'Link': [],
    'Cron': [],
    'Session': [],
    'Memory': [],
    '交互': [],
    '设备 (Android)': [],
    '浏览器': [],
    '文件': [],
    'Cookie': [],
    '其他': [],
  };

  for (const tool of tools) {
    if (tool.startsWith('task_')) categories['任务系统'].push(tool);
    else if (tool.startsWith('link_')) categories['Link'].push(tool);
    else if (tool.startsWith('cron_')) categories['Cron'].push(tool);
    else if (tool.startsWith('session_')) categories['Session'].push(tool);
    else if (['remember', 'recall', 'inspect', 'graph'].includes(tool)) categories['Memory'].push(tool);
    else if (['substitution', 'list_personas', 'current_persona', 'save_persona', 'find_personas'].includes(tool)) categories['Persona'].push(tool);
    else if (tool.startsWith('device_')) categories['设备 (Android)'].push(tool);
    else if (tool.startsWith('browser_')) categories['浏览器'].push(tool);
    else if (tool.startsWith('cookie_')) categories['Cookie'].push(tool);
    else if (['ask_user', 'fetch'].includes(tool)) categories['交互'].push(tool);
    else if (['send_file', 'peek_master_todo'].includes(tool)) categories['文件'].push(tool);
    else categories['其他'].push(tool);
  }

  // Remove empty categories
  for (const key of Object.keys(categories)) {
    if (categories[key].length === 0) delete categories[key];
  }

  return categories;
}

const toolsetStyle: Record<string, React.CSSProperties> = {
  container: { padding: '1em 1.5ch' },
  title: { margin: '0 0 1em', color: theme.diffContent, fontSize: '1.2em' },
  desc: { color: 'var(--text-secondary)', margin: '0 0 1.5em', lineHeight: 1.6 },
  hint: { color: theme.dimText, fontSize: '0.85em', marginBottom: '1em', fontStyle: 'italic' },
  loading: { color: theme.dimText, padding: '2em', textAlign: 'center' },
  error: { color: 'var(--status-error)', padding: '2em', textAlign: 'center' },
  card: {
    marginBottom: '0.8em',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '0.8em 1em',
    display: 'flex',
    alignItems: 'center',
    gap: '1em',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  cardName: { color: theme.toolName, fontWeight: 'bold', minWidth: '80px' },
  cardDesc: { color: theme.dimText, flex: 1, fontSize: '0.9em' },
  cardArrow: { color: theme.dimText, fontSize: '0.8em' },
  cardContent: {
    padding: '0 1em 1em',
    borderTop: '1px solid var(--border-color)',
  },
  section: { marginTop: '0.8em' },
  sectionLabel: { color: 'var(--status-success)', fontSize: '0.85em', marginBottom: '0.4em', fontWeight: 'bold' },
  sectionLabelWarn: { color: 'var(--status-warning-dark)', fontSize: '0.85em', marginBottom: '0.4em', fontWeight: 'bold' },
  sectionLabelDeny: { color: 'var(--status-error)', fontSize: '0.85em', marginBottom: '0.4em', fontWeight: 'bold' },
  toolList: { display: 'flex', flexWrap: 'wrap', gap: '0.4em' },
  toolTag: {
    padding: '0.2em 0.6ch',
    background: 'var(--bg-secondary)',
    borderRadius: '3px',
    fontSize: '0.8em',
    fontFamily: 'monospace',
    color: theme.diffContent,
  },
  toolTagWarn: {
    padding: '0.2em 0.6ch',
    background: 'var(--status-warning-bg)',
    borderRadius: '3px',
    fontSize: '0.8em',
    fontFamily: 'monospace',
    color: 'var(--status-warning-dark)',
  },
  toolTagDeny: {
    padding: '0.2em 0.6ch',
    background: 'var(--status-error-bg)',
    borderRadius: '3px',
    fontSize: '0.8em',
    fontFamily: 'monospace',
    color: 'var(--status-error)',
  },
  categorySection: { marginTop: '0.8em' },
  categoryLabel: { color: theme.toolName, fontSize: '0.85em', marginBottom: '0.4em', fontWeight: 'bold' },
  subagentSection: {
    marginTop: '1em',
    padding: '0.8em',
    background: 'var(--bg-primary)',
    borderRadius: '4px',
    border: '1px solid var(--border-color)',
  },
  subagentTitle: { color: theme.toolName, fontWeight: 'bold', marginBottom: '0.3em' },
  subagentDesc: { color: theme.dimText, fontSize: '0.85em', marginBottom: '0.6em' },
  ruleList: { display: 'flex', flexDirection: 'column', gap: '0.3em' },
  ruleItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '1em',
    padding: '0.3em 0.6ch',
    background: 'var(--bg-secondary)',
    borderRadius: '3px',
  },
  rulePattern: { fontFamily: 'monospace', fontSize: '0.8em', color: theme.diffContent },
  ruleAction: { fontSize: '0.75em', padding: '0.1em 0.5ch', borderRadius: '2px' },
  ruleAllow: { background: '#2A4A2A', color: 'var(--status-success-light)' },
  ruleDeny: { background: 'var(--status-error-bg)', color: 'var(--status-error-light)' },
  ruleAsk: { background: 'var(--status-warning-bg)', color: 'var(--status-warning)' },
};

// ===========================================================================
// Tab: Skills (技能查看)
// ===========================================================================

interface SkillInfo {
  name: string;
  description: string;
  /** Optional Chinese description for UI display. Falls back to `description` if absent. */
  descriptionZh?: string;
  requires?: string;
}

function translateSkillDesc(skill: SkillInfo): string {
  return skill.descriptionZh || skill.description || '';
}

interface SkillsInfoResponse {
  type: 'skills_info';
  skills: SkillInfo[];
}

function SkillsTab({ bridge }: { bridge: Bridge }) {
  const [data, setData] = useState<SkillsInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    bridge.sendGlobalCommand({ cmd: 'get_skills' });
  }, [bridge]);

  useEffect(() => {
    const unsub = bridge.onMetaEvent((event) => {
      if (event.type === 'skills_info') {
        setData(event as SkillsInfoResponse);
        setLoading(false);
      }
    });
    return unsub;
  }, [bridge]);

  if (loading) {
    return <div style={skillTabStyle.loading}>加载中...</div>;
  }

  if (error) {
    return <div style={skillTabStyle.error}>{error}</div>;
  }

  if (!data || !data.skills || data.skills.length === 0) {
    return (
      <div style={skillTabStyle.container}>
        <h3 style={skillTabStyle.title}>技能 (Skills)</h3>
        <p style={skillTabStyle.desc}>
          技能是提示词片段文件，存放在 skills 目录中。加载后，技能会注入到 AI 的系统提示词中，赋予其特定领域能力。
        </p>
        <div style={skillTabStyle.emptyHint}>暂无可用技能。在 skills 目录中放置 .md 文件即可。</div>
      </div>
    );
  }

  return (
    <div style={skillTabStyle.container}>
      <h3 style={skillTabStyle.title}>技能 (Skills)</h3>
      <p style={skillTabStyle.desc}>
        技能是提示词片段文件，存放在 skills 目录中。加载后，技能会注入到 AI 的系统提示词中，赋予其特定领域能力。
      </p>
      <div style={skillTabStyle.grid}>
        {data.skills.map(skill => (
          <div key={skill.name} style={skillTabStyle.card}>
            <div style={skillTabStyle.cardHeader}>
              <span style={skillTabStyle.cardName}>{skill.name}</span>
              {skill.requires && (
                <span style={skillTabStyle.requiresBadge} title={`需要环境变量: ${skill.requires}`}>
                  需 ENV
                </span>
              )}
            </div>
            {skill.description && (
              <div style={skillTabStyle.cardDesc}>{translateSkillDesc(skill)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const skillTabStyle: Record<string, React.CSSProperties> = {
  container: { padding: '1em 1.5ch' },
  title: { margin: '0 0 1em', color: theme.diffContent, fontSize: '1.2em' },
  desc: { color: 'var(--text-secondary)', margin: '0 0 1.5em', lineHeight: 1.6 },
  loading: { color: theme.dimText, padding: '2em', textAlign: 'center' },
  error: { color: 'var(--status-error)', padding: '2em', textAlign: 'center' },
  emptyHint: { color: theme.dimText, padding: '1em 0', fontSize: '0.9em', fontStyle: 'italic' },
  grid: { display: 'flex', flexDirection: 'column', gap: '0.6em' },
  card: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '0.8em 1em',
    transition: 'border-color 0.15s',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6em',
  },
  cardName: {
    color: theme.toolName,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    fontSize: '0.95em',
  },
  cardDesc: {
    color: theme.dimText,
    marginTop: '0.4em',
    fontSize: '0.85em',
    lineHeight: 1.5,
  },
  requiresBadge: {
    padding: '0.1em 0.5ch',
    background: 'var(--status-warning-bg)',
    color: 'var(--status-warning)',
    borderRadius: '2px',
    fontSize: '0.7em',
    fontWeight: 'bold',
  },
};


// ---------------------------------------------------------------------------
// ScenesTab Styles
// ---------------------------------------------------------------------------

const sceneStyle: Record<string, React.CSSProperties> = {
  container: { padding: '1em 1.5ch' },
  title: { margin: '0 0 1em', color: theme.diffContent, fontSize: '1.2em' },
  desc: { color: 'var(--text-secondary)', margin: '0 0 1.5em', lineHeight: 1.6 },
  field: { marginBottom: '1em' },
  label: { display: 'block', color: theme.toolName, fontWeight: 'bold', marginBottom: '0.3em', fontSize: '0.85em' },
  input: {
    width: '100%', boxSizing: 'border-box' as const, background: 'transparent',
    border: '1px solid var(--border-color)', borderRadius: '3px', color: theme.diffContent,
    padding: '0.5em', fontFamily: 'inherit', fontSize: 'inherit', outline: 'none',
  },
  backBtn: {
    background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '2px',
    color: 'var(--text-secondary)', padding: '0.3em 1ch', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 'inherit', marginBottom: '1em',
  },
  primaryBtn: {
    background: 'var(--accent-blue)', border: 'none', borderRadius: '3px', color: 'var(--btn-primary-text, #FFFFFF)',
    padding: '0.5em 1.5ch', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit',
    fontWeight: 'bold',
  },
  secondaryBtn: {
    background: 'transparent', border: '1px solid var(--text-muted)', borderRadius: '3px', color: 'var(--text-secondary)',
    padding: '0.5em 1.5ch', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit',
  },
  dangerBtn: {
    background: 'var(--status-error-bg)', border: 'none', borderRadius: '3px', color: 'var(--status-error-light)',
    padding: '0.5em 1.5ch', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit',
    fontWeight: 'bold',
  },
  activeBadge: {
    background: 'var(--status-success-dark)', color: 'var(--status-success-light)', padding: '0.1em 0.6ch',
    borderRadius: '2px', fontSize: '0.8em', fontWeight: 'bold',
  },
  defaultBadge: {
    background: '#4A3A1A', color: 'var(--status-warning)', padding: '0.1em 0.5ch',
    borderRadius: '2px', fontSize: '0.75em', marginLeft: '0.5ch',
  },
  section: { marginBottom: '1.5em' },
  sectionTitle: {
    margin: '0 0 0.5em', color: theme.toolName, fontSize: '0.95em', fontWeight: 'bold',
  },
  profileList: { display: 'flex', flexDirection: 'column' as const, gap: '0.3em' },
  profileItem: {
    padding: '0.4em 0.8ch', background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
    borderRadius: '3px', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', fontSize: '0.9em',
  },
  profileDefault: { borderColor: 'var(--status-success-dark)' },
  profileName: { color: theme.diffContent },
  profileModel: { color: theme.dimText, fontFamily: 'monospace' },
  personaItem: {
    padding: '0.3em 0.8ch', background: 'var(--bg-primary)', borderRadius: '2px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: '0.9em', marginBottom: '0.2em',
  },
  personaName: { color: theme.diffContent },
  personaProfile: { color: theme.dimText, fontFamily: 'monospace', fontSize: '0.85em' },
  assignmentItem: {
    padding: '0.3em 0.8ch', background: 'var(--bg-primary)', borderRadius: '2px',
    display: 'flex', alignItems: 'center', gap: '0.5ch', fontSize: '0.9em',
    marginBottom: '0.2em',
  },
  assignmentRole: { color: theme.toolName, fontWeight: 'bold' },
  assignmentArrow: { color: 'var(--text-muted)' },
  assignmentPersona: { color: theme.diffContent },
  emptyHint: { color: theme.dimText, padding: '0.5em 0', fontSize: '0.9em' },
  actions: { display: 'flex', gap: '0.5em', flexWrap: 'wrap' as const, marginTop: '1.5em' },
  confirmOverlay: {
    position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', zIndex: 1000,
    animation: 'fade-in 0.2s ease-out',
  },
  confirmBox: {
    background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px',
    padding: '1.5em', maxWidth: '400px', width: '90%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
    animation: 'scale-in 0.2s ease-out',
  },
  emptyState: {
    textAlign: 'center' as const, padding: '3em 1em',
    border: '1px dashed var(--border-color)', borderRadius: '6px', margin: '1em 0',
  },
  sceneList: { display: 'flex', flexDirection: 'column' as const, gap: '0.5em', margin: '1em 0' },
  sceneCard: {
    padding: '0.8em 1ch', background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
    borderRadius: '4px', cursor: 'pointer', transition: 'border-color 0.15s',
  },
  sceneCardActive: { borderColor: 'var(--status-success-dark)' },
  sceneCardName: { color: theme.diffContent, fontWeight: 'bold' },
  sceneCardDesc: { color: theme.dimText, margin: '0.3em 0 0', fontSize: '0.85em' },
  sceneCardArrow: { color: 'var(--text-muted)', fontSize: '1.2em' },
  saveCurrent: {
    marginTop: '1.5em', padding: '1em', background: 'var(--bg-secondary)',
    border: '1px solid var(--status-success-dark)', borderRadius: '4px',
  },
};
