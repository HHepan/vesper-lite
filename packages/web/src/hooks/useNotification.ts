// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Browser Notification Hook
//
// Uses the Web Notifications API to alert the user when the tab is not
// in the foreground. Automatically requests permission on mount.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useCallback, useRef } from 'react';

/** Check if the Notification API is available. */
function hasNotificationSupport(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Hook that provides a `notify(title, body?)` function.
 * - Requests permission on mount (if not already granted/denied).
 * - Only fires when `document.hidden` is true (tab not in foreground).
 * - Clicking the notification focuses the tab.
 */
export function useNotification() {
  const permissionRef = useRef<NotificationPermission>(
    hasNotificationSupport() ? Notification.permission : 'denied',
  );

  useEffect(() => {
    if (!hasNotificationSupport()) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then((p) => {
        permissionRef.current = p;
      });
    }
  }, []);

  const notify = useCallback((title: string, body?: string) => {
    if (!hasNotificationSupport()) return;
    if (permissionRef.current !== 'granted') return;
    // Only notify when the tab is hidden (user is elsewhere)
    if (!document.hidden) return;

    const n = new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'lux-agent', // collapse duplicate notifications
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }, []);

  return notify;
}
