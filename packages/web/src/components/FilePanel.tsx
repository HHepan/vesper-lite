// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — FilePanel (📁 delivered files browser)
//
// Displays files delivered via the send_file tool.
// Users can download or delete files from here.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useEffect, useCallback } from 'react';
import { theme } from '../theme.js';
import { useModalAnimation } from '../hooks/useModalAnimation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  token: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sessionId: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('word') || mimeType.includes('docx')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('xlsx')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('pptx')) return '📑';
  if (mimeType.startsWith('text/')) return '📃';
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gzip')) return '📦';
  return '📎';
}

function isImageType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isAudioType(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

function isPreviewable(mimeType: string): boolean {
  return isImageType(mimeType) || isAudioType(mimeType) || mimeType === 'application/pdf';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FilePanelProps {
  onClose: () => void;
}

export const FilePanel = memo(function FilePanel({ onClose }: FilePanelProps) {
  const { isClosing, handleClose, handleOverlayClick, overlayAnimation, panelAnimation } = useModalAnimation(onClose);

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState<string>('');

  const fetchFiles = useCallback(async () => {
    try {
      const resp = await fetch('/api/files');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setFiles(data.files ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleDownload = useCallback((token: string, filename: string) => {
    const url = `/api/files/${token}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }, []);

  const handlePreview = useCallback((token: string, filename: string) => {
    const url = `/api/files/${token}`;
    setPreviewUrl(url);
    setPreviewFilename(filename);
  }, []);

  const handleDelete = useCallback(async (token: string) => {
    try {
      const resp = await fetch(`/api/files/${token}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setFiles(prev => prev.filter(f => f.token !== token));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const handleDeleteAll = useCallback(async () => {
    try {
      await Promise.all(files.map(f => fetch(`/api/files/${f.token}`, { method: 'DELETE' })));
      setFiles([]);
    } catch (err: any) {
      setError(err.message);
    }
  }, [files]);

  return (
    <div style={{ ...styles.overlay, animation: overlayAnimation }} onClick={handleOverlayClick}>
      <div style={{ ...styles.panel, animation: panelAnimation }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.title}>📁 Delivered Files</span>
          <div style={styles.headerActions}>
            {files.length > 0 && (
              <button style={styles.headerBtn} onClick={handleDeleteAll} title="Delete all files">
                🗑️ Clear All
              </button>
            )}
            <button style={styles.headerBtn} onClick={fetchFiles} title="Refresh">
              🔄
            </button>
            <button style={styles.closeBtn} onClick={handleClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {loading ? (
            <div style={styles.empty}>Loading...</div>
          ) : error ? (
            <div style={styles.error}>{error}</div>
          ) : files.length === 0 ? (
            <div style={styles.empty}>No files delivered yet.</div>
          ) : (
            <div style={styles.fileList}>
              {files.map(file => (
                <div key={file.token} style={styles.fileItem}>
                  {/* Image thumbnail */}
                  {isImageType(file.mimeType) ? (
                    <div style={styles.thumbWrap} onClick={() => handlePreview(file.token, file.filename)} title="Click to view full size">
                      <img
                        src={`/api/files/${file.token}`}
                        alt={file.filename}
                        style={styles.thumbImg}
                      />
                    </div>
                  ) : isAudioType(file.mimeType) ? (
                    /* Audio inline player */
                    <div style={styles.audioWrap}>
                      <span style={{ fontSize: '1.2em' }}>🎵</span>
                      <audio
                        controls
                        src={`/api/files/${file.token}`}
                        style={styles.audioPlayer}
                        preload="metadata"
                      />
                    </div>
                  ) : (
                    /* Generic file icon */
                    <span style={styles.fileIcon}>{getFileIcon(file.mimeType)}</span>
                  )}
                  <div style={styles.fileInfo}>
                    <div style={styles.fileName}>{file.filename}</div>
                    <div style={styles.fileMeta}>
                      {formatSize(file.sizeBytes)} · {formatTime(file.createdAt)}
                    </div>
                  </div>
                  <div style={styles.fileActions}>
                    {isPreviewable(file.mimeType) && !isAudioType(file.mimeType) && (
                      <button
                        style={styles.actionBtn}
                        onClick={() => handlePreview(file.token, file.filename)}
                        title="Preview"
                      >
                        👁️
                      </button>
                    )}
                    <button
                      style={styles.actionBtn}
                      onClick={() => handleDownload(file.token, file.filename)}
                      title="Download"
                    >
                      ⬇️
                    </button>
                    <button
                      style={styles.actionBtn}
                      onClick={() => handleDelete(file.token)}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview Modal */}
        {previewUrl && (
          <div style={styles.previewOverlay} onClick={() => setPreviewUrl(null)}>
            <div style={styles.previewModal} onClick={e => e.stopPropagation()}>
              <div style={styles.previewHeader}>
                <span style={{ color: 'var(--text-secondary)' }}>{previewFilename}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <a
                    href={previewUrl}
                    download={previewFilename}
                    style={styles.previewDownload}
                  >
                    ⬇️ Download
                  </a>
                  <button style={styles.closeBtn} onClick={() => setPreviewUrl(null)}>✕</button>
                </div>
              </div>
              <div style={styles.previewContent}>
                {previewFilename.toLowerCase().endsWith('.pdf') ? (
                  <iframe
                    src={previewUrl}
                    style={styles.previewIframe}
                    title={previewFilename}
                  />
                ) : (
                  <img
                    src={previewUrl}
                    alt={previewFilename}
                    style={styles.previewImage}
                    onClick={e => e.stopPropagation()}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'fade-in 0.2s ease-out',
  },
  panel: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    width: '500px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    animation: 'scale-in 0.2s ease-out',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border-color)',
  },
  title: {
    color: 'var(--text-secondary)',
    fontWeight: 'bold',
    fontSize: '1.1em',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  headerBtn: {
    background: 'transparent',
    border: '1px solid var(--text-muted)',
    borderRadius: '4px',
    padding: '4px 8px',
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '1.2em',
    cursor: 'pointer',
    padding: '0 4px',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 16px',
  },
  empty: {
    color: 'var(--text-muted)',
    textAlign: 'center' as const,
    padding: '32px 0',
  },
  error: {
    color: theme.toolError,
    textAlign: 'center' as const,
    padding: '16px 0',
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: '6px',
    border: '1px solid var(--bg-tertiary)',
  },
  thumbWrap: {
    flexShrink: 0,
    cursor: 'pointer',
    borderRadius: '4px',
    overflow: 'hidden',
    border: '1px solid var(--border-color)',
  },
  thumbImg: {
    width: '64px',
    height: '48px',
    objectFit: 'cover' as const,
    display: 'block',
  },
  audioWrap: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    gap: '4px',
  },
  audioPlayer: {
    height: '32px',
    width: '180px',
    borderRadius: '4px',
  },
  fileIcon: {
    fontSize: '1.4em',
    flexShrink: 0,
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    color: 'var(--text-secondary)',
    fontSize: '0.95em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  fileMeta: {
    color: 'var(--text-muted)',
    fontSize: '0.8em',
    marginTop: '2px',
  },
  fileActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
  },
  actionBtn: {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '4px 6px',
    cursor: 'pointer',
    fontSize: '0.9em',
    lineHeight: 1,
  },
  previewOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.7)',
    zIndex: 1001,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewModal: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--text-muted)',
    borderRadius: '8px',
    maxWidth: '90vw',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
  },
  previewHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border-color)',
    color: 'var(--text-secondary)',
    gap: '8px',
  },
  previewDownload: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid var(--text-muted)',
    borderRadius: '4px',
    padding: '4px 10px',
    color: 'var(--text-secondary)',
    fontSize: '0.85em',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  previewContent: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
  },
  previewIframe: {
    width: '80vw',
    height: '75vh',
    border: 'none',
    borderRadius: '4px',
  },
  previewImage: {
    maxWidth: '85vw',
    maxHeight: '80vh',
    objectFit: 'contain' as const,
    borderRadius: '4px',
  },
};