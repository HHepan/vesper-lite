// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Modal Animation Hook
//
// Provides enter/exit animations for modal dialogs.
// Returns animation styles and a close handler that plays exit animation
// before actually closing.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useCallback, useRef, useEffect } from 'react';
import { useIsMobile } from './useIsMobile.js';

const ANIMATION_DURATION = 200; // ms, should match CSS transition-base

export function useModalAnimation(onClose: () => void) {
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isClosingRef = useRef(false);
  const isMobile = useIsMobile();

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return; // Prevent double close
    
    // Start closing animation
    isClosingRef.current = true;
    setIsClosing(true);
    
    // Clear any existing timer
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    
    // Wait for animation to complete before actually closing
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, ANIMATION_DURATION);
  }, [onClose]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const overlayAnimation = isClosing ? 'fade-out 0.2s ease-out forwards' : 'fade-in 0.2s ease-out';
  const panelAnimation = isClosing ? 'scale-out 0.2s ease-out forwards' : 'scale-in 0.2s ease-out';

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (isMobile && e.target === e.currentTarget) {
      handleClose();
    }
  }, [isMobile, handleClose]);

  return {
    isClosing,
    handleClose,
    handleOverlayClick,
    overlayAnimation,
    panelAnimation,
  };
}
