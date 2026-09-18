// =============================================================================
// Vesper WebUI — useDimensions hook (replaces Ink's useStdout().columns)
//
// Uses ResizeObserver to track container dimensions.
// Returns { width, height } in pixels.
// =============================================================================

import { useState, useEffect, useRef, type RefObject } from 'react';

export interface Dimensions {
  width: number;
  height: number;
}

export function useDimensions(ref: RefObject<HTMLElement | null>): Dimensions {
  const [dims, setDims] = useState<Dimensions>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDims({ width: Math.floor(width), height: Math.floor(height) });
      }
    });

    observer.observe(el);

    // Initial measurement
    const rect = el.getBoundingClientRect();
    setDims({ width: Math.floor(rect.width), height: Math.floor(rect.height) });

    return () => observer.disconnect();
  }, [ref]);

  return dims;
}
