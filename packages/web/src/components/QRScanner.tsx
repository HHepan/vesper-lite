// =============================================================================
// Vesper WebUI — QR Code Scanner (Camera-based)
//
// Strategy:
//   1. Try native BarcodeDetector API (Chrome Android 83+, Safari 15.4+)
//      → hardware-accelerated, reliable, supports long data QR codes
//   2. Fall back to jsQR (pure JS) on desktop/older browsers
//
// Key robustness measures:
//   - abortedRef prevents race conditions from React StrictMode double-mount
//   - Waits for 'loadedmetadata' before calling play() to avoid interruption
//   - Stable refs for callbacks avoid effect re-triggering
// =============================================================================

import React, { useRef, useEffect, useState, memo } from 'react';
import jsQR from 'jsqr';
import { theme } from '../theme.js';

// Type declaration for BarcodeDetector (not in default TS lib)
interface BarcodeDetectorResult {
  rawValue: string;
  format: string;
  boundingBox: DOMRectReadOnly;
  cornerPoints: { x: number; y: number }[];
}

interface BarcodeDetectorClass {
  new(opts?: { formats: string[] }): {
    detect(source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | ImageData): Promise<BarcodeDetectorResult[]>;
  };
  getSupportedFormats(): Promise<string[]>;
}

declare const BarcodeDetector: BarcodeDetectorClass | undefined;

interface QRScannerProps {
  /** Called when a QR code is successfully scanned. */
  onScan: (data: string) => void;
  /** Called when the user closes the scanner. */
  onClose: () => void;
}

export const QRScanner = memo(function QRScanner({ onScan, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>('Initializing...');
  const lastScannedRef = useRef<string>('');
  const frameCountRef = useRef(0);
  const lastDebugUpdateRef = useRef(0);

  // Stable refs for callbacks
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let aborted = false;
    let localStream: MediaStream | null = null;
    let localAnimFrame = 0;
    let scanInterval: ReturnType<typeof setInterval> | null = null;

    const stopLocalCamera = () => {
      if (localAnimFrame) { cancelAnimationFrame(localAnimFrame); localAnimFrame = 0; }
      if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
      animFrameRef.current = 0;
      if (localStream) {
        for (const track of localStream.getTracks()) track.stop();
        localStream = null;
      }
      streamRef.current = null;
      const video = videoRef.current;
      if (video) { video.pause(); video.srcObject = null; }
    };

    const onFound = (data: string) => {
      if (data && data !== lastScannedRef.current) {
        console.log('[QRScanner] ✅ QR DECODED:', data);
        lastScannedRef.current = data;
        try { navigator.vibrate?.(100); } catch { /* ignore */ }
        stopLocalCamera();
        onScanRef.current(data);
      }
    };

    const startCamera = async () => {
      try {
        setError(null);
        setScanning(true);
        setDebugInfo('Requesting camera...');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });

        if (aborted) { for (const track of stream.getTracks()) track.stop(); return; }

        localStream = stream;
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video || aborted) { stopLocalCamera(); return; }

        video.srcObject = stream;
        setDebugInfo('Waiting for video metadata...');

        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => { cl(); resolve(); };
          const onErr = (e: Event) => { cl(); reject((e as ErrorEvent).error ?? new Error('Video load error')); };
          const cl = () => { video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('error', onErr); };
          if (video.readyState >= 1) { resolve(); return; }
          video.addEventListener('loadedmetadata', onLoaded, { once: true });
          video.addEventListener('error', onErr, { once: true });
        });

        if (aborted) { stopLocalCamera(); return; }

        await video.play();

        if (aborted) { stopLocalCamera(); return; }

        const vw = video.videoWidth;
        const vh = video.videoHeight;

        // ── Detect which scanner to use ──
        let useNative = false;
        try {
          if (typeof BarcodeDetector !== 'undefined') {
            const formats = await BarcodeDetector.getSupportedFormats();
            if (formats.includes('qr_code')) {
              useNative = true;
            }
          }
        } catch { /* BarcodeDetector not available */ }

        if (useNative) {
          // ═══ NATIVE BarcodeDetector (hardware-accelerated) ═══
          console.log('[QRScanner] Using native BarcodeDetector! Video: %d×%d', vw, vh);
          setDebugInfo(`Native BarcodeDetector | Video ${vw}×${vh} | Scanning...`);

          const detector = new BarcodeDetector!({ formats: ['qr_code'] });
          let detecting = false;
          let nativeFrames = 0;

          // Scan every 200ms (5 fps is plenty for native detector)
          scanInterval = setInterval(async () => {
            if (aborted || detecting) return;
            if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
            detecting = true;
            nativeFrames++;
            try {
              const results = await detector.detect(video);
              if (aborted) return;
              // Update debug
              const now = Date.now();
              if (now - lastDebugUpdateRef.current > 400) {
                lastDebugUpdateRef.current = now;
                setDebugInfo(`Native | ${vw}×${vh} | Frames: ${nativeFrames} | QR: ${results.length > 0 ? `FOUND "${results[0].rawValue.slice(0, 50)}..."` : 'none'}`);
              }
              if (results.length > 0 && results[0].rawValue) {
                onFound(results[0].rawValue);
              }
            } catch (e) {
              // detect() can throw on some frames, just skip
              console.warn('[QRScanner] detect() error:', e);
            } finally {
              detecting = false;
            }
          }, 200);

        } else {
          // ═══ FALLBACK: jsQR (pure JS) ═══
          console.log('[QRScanner] Using jsQR fallback. Video: %d×%d', vw, vh);

          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;

          const MAX_SCAN_WIDTH = 480;
          const scale = vw > MAX_SCAN_WIDTH ? MAX_SCAN_WIDTH / vw : 1;
          const sw = Math.round(vw * scale);
          const sh = Math.round(vh * scale);
          canvas.width = sw;
          canvas.height = sh;
          setDebugInfo(`jsQR fallback | Scanning ${sw}×${sh}...`);
          frameCountRef.current = 0;

          const scan = () => {
            if (aborted) return;
            if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
              localAnimFrame = requestAnimationFrame(scan);
              animFrameRef.current = localAnimFrame;
              return;
            }

            ctx.drawImage(video, 0, 0, sw, sh);
            const imageData = ctx.getImageData(0, 0, sw, sh);
            frameCountRef.current++;

            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth',
            });

            const now = Date.now();
            if (now - lastDebugUpdateRef.current > 500) {
              lastDebugUpdateRef.current = now;
              setDebugInfo(`jsQR | Frames: ${frameCountRef.current} | ${sw}×${sh} | QR: ${code ? `FOUND "${code.data.slice(0, 40)}..."` : 'none'}`);
            }

            if (code?.data) {
              onFound(code.data);
              return;
            }

            localAnimFrame = requestAnimationFrame(scan);
            animFrameRef.current = localAnimFrame;
          };

          localAnimFrame = requestAnimationFrame(scan);
          animFrameRef.current = localAnimFrame;
        }
      } catch (err: any) {
        if (aborted) return;
        setScanning(false);
        console.error('[QRScanner] Error:', err.name, err.message);
        setDebugInfo(`Error: ${err.name} — ${err.message}`);
        if (err.name === 'NotAllowedError') {
          setError('Camera access denied. Please allow camera access in your browser settings.');
        } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
          setError('No camera found on this device.');
        } else if (err.name === 'AbortError') {
          setError(null);
          setScanning(false);
        } else {
          setError(`Camera error: ${err.message}`);
        }
      }
    };

    startCamera();

    return () => {
      aborted = true;
      stopLocalCamera();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = 0; }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) { video.pause(); video.srcObject = null; }
    onCloseRef.current();
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.title}>📷 Scan QR Code</span>
          <button style={styles.closeBtn} onClick={handleClose}>✕</button>
        </div>

        {/* Camera viewport */}
        <div style={styles.viewport}>
          <video
            ref={videoRef}
            style={styles.video}
            playsInline
            muted
          />
          {/* Hidden canvas for jsQR fallback */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Scanning overlay with viewfinder */}
          {scanning && !error && (
            <div style={styles.viewfinder}>
              <div style={styles.viewfinderCorner('topLeft')} />
              <div style={styles.viewfinderCorner('topRight')} />
              <div style={styles.viewfinderCorner('bottomLeft')} />
              <div style={styles.viewfinderCorner('bottomRight')} />
              <div style={styles.scanHint}>Point camera at QR code</div>
            </div>
          )}
        </div>

        {/* Debug info — always visible below viewport */}
        <div style={styles.debugOverlay}>{debugInfo}</div>

        {/* Error */}
        {error && (
          <div style={styles.error}>
            {error}
            <button style={{ ...styles.closeBtn, marginTop: 8 }} onClick={handleClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

type CornerPos = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.85)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'var(--bg-primary)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: `1px solid ${theme.separator}`,
  },
  title: {
    color: theme.promptText,
    fontSize: '1em',
    fontWeight: 'bold' as const,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.dimText,
    fontSize: '1.2em',
    cursor: 'pointer',
    padding: '4px 8px',
  },
  viewport: {
    position: 'relative' as const,
    width: '100%',
    aspectRatio: '4/3',
    background: 'var(--bg-primary)',
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
  },
  viewfinder: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '65%',
    aspectRatio: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinderCorner: (pos: CornerPos) => {
    const size = 24;
    const border = `3px solid var(--accent-blue)`;
    const base: React.CSSProperties = {
      position: 'absolute',
      width: size,
      height: size,
    };
    switch (pos) {
      case 'topLeft':
        return { ...base, top: 0, left: 0, borderTop: border, borderLeft: border };
      case 'topRight':
        return { ...base, top: 0, right: 0, borderTop: border, borderRight: border };
      case 'bottomLeft':
        return { ...base, bottom: 0, left: 0, borderBottom: border, borderLeft: border };
      case 'bottomRight':
        return { ...base, bottom: 0, right: 0, borderBottom: border, borderRight: border };
    }
  },
  scanHint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: '0.85em',
    textAlign: 'center' as const,
    position: 'absolute' as const,
    bottom: -30,
    left: 0,
    right: 0,
  },
  debugOverlay: {
    color: 'var(--accent-blue)',
    fontSize: '0.7em',
    fontFamily: 'monospace',
    textAlign: 'center' as const,
    background: 'var(--bg-primary)',
    padding: '6px 8px',
    wordBreak: 'break-all' as const,
  },
  error: {
    padding: '16px',
    color: 'var(--status-error)',
    fontSize: '0.9em',
    textAlign: 'center' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 8,
  },
};
