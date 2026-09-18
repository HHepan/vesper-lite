// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Modal Wrapper
//
// Wraps modal dialogs to provide enter/exit animations with delayed unmount.
// The modal stays mounted during the exit animation, then triggers onClose.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from 'react';

const ANIMATION_DURATION = 200; // ms

interface ModalWrapperProps {
  visible: boolean;
  onClose: () => void;
  children: (props: { 
    isClosing: boolean;
    handleClose: () => void;
    overlayStyle: React.CSSProperties;
    panelStyle: React.CSSProperties;
  }) => React.ReactNode;
}

export function ModalWrapper({ visible, onClose, children }: ModalWrapperProps) {
  const [shouldRender, setShouldRender] = useState(visible);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When visible becomes true, start rendering immediately
  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      setIsClosing(false);
    }
  }, [visible]);

  // When visible becomes false, start closing animation
  useEffect(() => {
    if (!visible && shouldRender) {
      setIsClosing(true);
      
      // Clear any existing timer
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
      
      // Wait for animation then stop rendering
      closeTimerRef.current = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
        onClose();
      }, ANIMATION_DURATION);
    }
  }, [visible, shouldRender, onClose]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    // This is called by the modal's close button
    // The parent will set visible=false, which triggers the closing animation
    setIsClosing(true);
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => {
      setShouldRender(false);
      setIsClosing(false);
      onClose();
    }, ANIMATION_DURATION);
  }, [onClose]);

  if (!shouldRender) {
    return null;
  }

  const overlayStyle: React.CSSProperties = {
    animation: isClosing ? 'fade-out 0.2s ease-out forwards' : 'fade-in 0.2s ease-out',
  };

  const panelStyle: React.CSSProperties = {
    animation: isClosing ? 'scale-out 0.2s ease-out forwards' : 'scale-in 0.2s ease-out',
  };

  return children({ isClosing, handleClose, overlayStyle, panelStyle });
}