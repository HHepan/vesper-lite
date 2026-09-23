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

type TabId = 'common' | 'profiles';

// Tabs available per scope — Lite keeps only Common and Profiles; the
// personas/scenes/history/toolsets/skills/prompts tabs all depend on commands
// the Lite server does not implement.
const GLOBAL_TABS: { id: TabId; label: string }[] = [
  { id: 'common', label: '常规 (Common)' },
  { id: 'profiles', label: '配置方案 (Profiles)' },
];

const PROJECT_TABS: { id: TabId; label: string }[] = [
  { id: 'common', label: '常规 (Common)' },
  { id: 'profiles', label: '配置方案 (Profiles)' },
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
            {activeTab === 'profiles' && (
              <ProfilesTab
                profiles={config.profiles ?? {}}
                onChange={(v) => set('profiles', v)}
              />
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

