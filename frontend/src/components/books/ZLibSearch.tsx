/**
 * ZLibSearch Component
 * Modal for searching and downloading books from Z-Library.
 * Shows download limit status and supports pagination.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Search, X, Download, Loader2, BookOpen, AlertCircle, Info } from 'lucide-react';
import { api } from '@/api/client';
import type { ZLibSearchResult, ZLibDownloadStatus } from '@/types/api';
import { useBooksStore } from '@/stores/books';

interface ZLibSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ZLibSearch({ isOpen, onClose }: ZLibSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ZLibSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<ZLibDownloadStatus | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const downloadFromZLib = useBooksStore(s => s.downloadFromZLib);

  // Fetch download status when modal opens
  useEffect(() => {
    if (isOpen) {
      api.getZLibStatus().then(setDownloadStatus).catch(() => {});
      // Focus search input
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSearch = useCallback(async (newSearch = true) => {
    const q = query.trim();
    if (!q) return;

    setIsSearching(true);
    setError(null);
    const searchPage = newSearch ? 1 : page + 1;

    try {
      const response = await api.searchZLib(q, searchPage);
      if (newSearch) {
        setResults(response.results);
      } else {
        setResults(prev => [...prev, ...response.results]);
      }
      setPage(searchPage);
      setHasMore(response.hasMore);
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [query, page]);

  const handleDownload = useCallback(async (result: ZLibSearchResult) => {
    if (downloadingId) return;

    // Check limit before attempting
    if (downloadStatus && !downloadStatus.canDownload) {
      setError(`Daily download limit reached (${downloadStatus.dailyLimit}/day). Resets at midnight.`);
      return;
    }

    setDownloadingId(result.id);
    setError(null);
    try {
      await downloadFromZLib(result);
      setResults(prev => prev.filter(r => r.id !== result.id));
      // Update download status
      api.getZLibStatus().then(setDownloadStatus).catch(() => {});
    } catch (err: any) {
      setError(`Download failed: ${err.message}`);
    } finally {
      setDownloadingId(null);
    }
  }, [downloadingId, downloadFromZLib, downloadStatus]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch(true);
    if (e.key === 'Escape') onClose();
  }, [handleSearch, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm eink-modal-backdrop" onClick={onClose} />
      <div className={cn(
        'relative w-full max-w-2xl max-h-[75vh] mx-4',
        'bg-[var(--color-surface-primary)] rounded-xl shadow-2xl eink-shell-surface eink-modal-surface',
        'border border-[var(--color-border-default)]',
        'flex flex-col overflow-hidden', 'animate-fade-in'
      )}>
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <Search size={18} className="text-[var(--color-text-tertiary)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search Z-Library for books..."
            className={cn(
              'flex-1 bg-transparent outline-none',
              'text-sm text-[var(--color-text-primary)]',
              'placeholder:text-[var(--color-text-disabled)]'
            )}
            autoFocus
          />
          {isSearching && <Loader2 size={16} className="animate-spin text-[var(--color-text-tertiary)]" />}
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Download limit banner */}
        {downloadStatus && (
          <div className={cn(
            'flex items-center gap-2 px-4 py-2 text-xs border-b border-[var(--color-border-subtle)]',
            downloadStatus.remaining <= 1
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]'
          )}>
            <Info size={12} />
            <span>
              {downloadStatus.remaining > 0
                ? `${downloadStatus.remaining} of ${downloadStatus.dailyLimit} downloads remaining today`
                : 'Daily download limit reached — resets at midnight'}
            </span>
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 text-red-500 text-sm bg-red-500/10">
              <AlertCircle size={14} />{error}
            </div>
          )}

          {results.length === 0 && !isSearching && !error && (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-tertiary)]">
              <BookOpen size={40} className="mb-3 opacity-30" />
              <p className="text-sm">Search for books to download</p>
              <p className="text-xs mt-1 opacity-60">Results from Z-Library</p>
            </div>
          )}

          {results.map(result => (
            <ZLibResultRow
              key={result.id}
              result={result}
              isDownloading={downloadingId === result.id}
              canDownload={downloadStatus?.canDownload !== false}
              onDownload={() => handleDownload(result)}
            />
          ))}

          {hasMore && !isSearching && (
            <button
              onClick={() => handleSearch(false)}
              className={cn(
                'w-full py-3 text-sm text-[var(--color-accent-fg)]',
                'hover:bg-[var(--color-surface-hover)] transition-colors'
              )}
            >
              Load more results
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ZLibResultRow({
  result,
  isDownloading,
  canDownload,
  onDownload,
}: {
  result: ZLibSearchResult;
  isDownloading: boolean;
  canDownload: boolean;
  onDownload: () => void;
}) {
  const isEpub = result.extension?.toLowerCase() === 'epub';
  const downloadable = isEpub && canDownload && !!result.downloadUrl;

  return (
    <div className={cn(
      'flex items-start gap-3 px-4 py-3',
      'border-b border-[var(--color-border-subtle)]',
      'hover:bg-[var(--color-surface-hover)] transition-colors'
    )}>
      {result.coverUrl ? (
        <img
          src={api.getZLibCoverProxyUrl(result.coverUrl)}
          alt=""
          className="w-10 h-14 object-cover rounded flex-shrink-0 bg-[var(--color-surface-tertiary)]"
          loading="lazy"
        />
      ) : (
        <div className="w-10 h-14 rounded flex-shrink-0 bg-[var(--color-surface-tertiary)] flex items-center justify-center">
          <BookOpen size={16} className="text-[var(--color-text-disabled)]" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-1">
          {result.title}
        </h4>
        <p className="text-xs text-[var(--color-text-secondary)] line-clamp-1 mt-0.5">
          {result.author}
        </p>
        <div className="flex items-center gap-2 mt-1 text-xs text-[var(--color-text-tertiary)]">
          {result.year && <span>{result.year}</span>}
          {result.language && <span>{result.language}</span>}
          {result.extension && (
            <span className={cn(
              'uppercase font-medium px-1.5 py-0.5 rounded',
              isEpub
                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                : 'bg-[var(--color-surface-tertiary)]'
            )}>
              {result.extension}
            </span>
          )}
          {result.fileSize && <span>{result.fileSize}</span>}
          {result.rating && result.rating !== '0' && result.rating !== '0.0' && (
            <span className="text-yellow-500">★ {result.rating}</span>
          )}
        </div>
      </div>

      <button
        onClick={onDownload}
        disabled={isDownloading || !downloadable}
        title={
          !isEpub
            ? `Only EPUB files supported (this is ${result.extension})`
            : !canDownload
            ? 'Daily download limit reached'
            : !result.downloadUrl
            ? 'No download link available'
            : 'Download to library'
        }
        className={cn(
          'flex-shrink-0 p-2 rounded-lg transition-colors',
          downloadable
            ? 'text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-fg)]/10'
            : 'text-[var(--color-text-disabled)] cursor-not-allowed',
          isDownloading && 'opacity-50'
        )}
      >
        {isDownloading ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Download size={18} />
        )}
      </button>
    </div>
  );
}
