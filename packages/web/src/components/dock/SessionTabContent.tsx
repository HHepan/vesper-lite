// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — SessionTabContent (dock tab wrapper for SessionPanel)
// ═══════════════════════════════════════════════════════════════════════════

import type { WebStore } from '../../store.js';
import type { CanvasBrowserAction } from '../CanvasBrowser.js';
import type { SessionBrowserAction } from '../SessionBrowser.js';
import type { RequestAction } from '../AgentSpinner.js';
import { SessionPanel } from '../SessionPanel.js';

interface SessionTabContentProps {
  store: WebStore;
  onSendPrompt: (text: string, images?: import('../InputBox.js').PendingImage[], regenerate?: boolean) => void;
  onAbort: () => void;
  onCanvasBrowserAction: (action: CanvasBrowserAction) => void;
  onSessionBrowserAction?: (action: SessionBrowserAction) => void;
  onRequestAction?: (action: RequestAction) => void;
  onSwitchPersona?: (name: string) => void;
  onSwitchMember?: (personaName: string, roleName: string) => void;
  onSwitchProvider?: (profile: string) => void;
  onDisableSupervisor?: () => void;
  onUpdateSupervisorRules?: (rules: string) => void;
  onTogglePublicMode?: () => void;
  onSetPermissionMode?: (mode: 'manual' | 'auto' | 'supervisor') => void;
  onSetMultiChatMode?: (enabled: boolean, members: string[]) => void;
  onFileSearch?: import('../InputBox.js').FileSearchFn;
}

export function SessionTabContent({ store, onSendPrompt, onAbort, onCanvasBrowserAction, onSessionBrowserAction, onRequestAction, onSwitchPersona, onSwitchMember, onSwitchProvider, onDisableSupervisor, onUpdateSupervisorRules, onTogglePublicMode, onSetPermissionMode, onSetMultiChatMode, onFileSearch }: SessionTabContentProps) {
  const sessionId = store.getSnapshot().sessionId;
  return (
    <div
      data-session-id={sessionId}
      style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <SessionPanel
        store={store}
        onSendPrompt={onSendPrompt}
        onAbort={onAbort}
        onCanvasBrowserAction={onCanvasBrowserAction}
        onSessionBrowserAction={onSessionBrowserAction}
        onRequestAction={onRequestAction}
        onSwitchPersona={onSwitchPersona}
        onSwitchMember={onSwitchMember}
        onSwitchProvider={onSwitchProvider}
        onDisableSupervisor={onDisableSupervisor}
        onUpdateSupervisorRules={onUpdateSupervisorRules}
        onTogglePublicMode={onTogglePublicMode}
        onSetPermissionMode={onSetPermissionMode}
        onSetMultiChatMode={onSetMultiChatMode}
        onFileSearch={onFileSearch}
      />
    </div>
  );
}
