// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite WebUI — Toolbar (desktop mode action strip)
//
// Sits above the DockLayout on desktop. Provides buttons for debug, settings,
// and connection status. Same visual style as TabBar action area.
// ═══════════════════════════════════════════════════════════════════════════

import type { BridgeState } from '../bridge.js';
import { theme } from '../theme.js';
import { useTheme } from '../contexts/ThemeContext.js';

interface ToolbarProps {
  onConfig: () => void;
  onDebug: () => void;
  onFiles: () => void;
  onTodo: () => void;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
  bridgeState: BridgeState;
  activeTabKind?: 'session';
}

export function Toolbar({ onConfig, onDebug, onFiles, onTodo, onToggleSidebar, sidebarVisible, bridgeState }: ToolbarProps) {
  const { themeName, toggleTheme } = useTheme();
  const dotColor = bridgeState === 'connected' ? theme.toolSuccess
    : bridgeState === 'connecting' ? theme.thinkingDot
    : theme.toolError;

  return (
    <div style={styles.bar}>
      <div style={styles.leftActions}>
        {!sidebarVisible && (
          <button
            style={styles.actionBtn}
            onClick={onToggleSidebar}
            title="显示侧边栏"
          >
            ▶
          </button>
        )}
        <button
          style={styles.actionBtn}
          onClick={onTodo}
          title="TODO"
        >
          📝
        </button>
        <button
          style={styles.actionBtn}
          onClick={toggleTheme}
          title={themeName === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {themeName === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
      <div style={styles.spacer} />
      <div style={styles.actions}>
        <button
          style={styles.actionBtn}
          onClick={onDebug}
          title="Debug wire log"
        >
          D
        </button>
        <button
          style={styles.actionBtn}
          onClick={onFiles}
          title="Delivered files"
        >
          📁
        </button>
        <button
          style={styles.actionBtn}
          onClick={onConfig}
          title="Settings"
        >
          ⚙
        </button>
        <div style={{
          ...styles.dot,
          backgroundColor: dotColor,
        }} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    height: '2.5em',
    minHeight: '2.5em',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    padding: '0 1.2ch',
    transition: 'background 0.2s ease, border-color 0.2s ease',
  },
  leftActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6ch',
    flexShrink: 0,
  },
  spacer: {
    flex: 1,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6ch',
    flexShrink: 0,
  },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: 0,
    transition: 'all 0.15s ease',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    marginLeft: '0.8ch',
    boxShadow: '0 0 6px currentColor',
  },
};
