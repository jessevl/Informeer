/**
 * TTSSettingsPanel Component
 * Voice and speed selection for TTS
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useTTSStore } from '@/stores/tts';
import { AlertTriangle, Headphones, Loader2, Pause, Play, RefreshCw, Trash2, Zap } from 'lucide-react';

interface TTSSettingsPanelProps {
  className?: string;
}

type VoiceCountryFilter = 'all' | 'us' | 'uk' | 'other';
type VoiceGenderFilter = 'all' | 'female' | 'male' | 'other';

interface VoiceMeta {
  id: string;
  label: string;
  country: VoiceCountryFilter;
  countryLabel: string;
  countryFlag: string;
  gender: VoiceGenderFilter;
  genderLabel: string;
}

function formatBytes(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'Unavailable';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseVoiceMeta(id: string): VoiceMeta {
  const parts = id.split('_');
  const prefix = parts[0] ?? '';
  const name = parts
    .slice(1)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  const country: VoiceCountryFilter =
    prefix[0] === 'a' ? 'us' : prefix[0] === 'b' ? 'uk' : 'other';
  const countryLabel = country === 'us' ? 'US' : country === 'uk' ? 'UK' : 'Other';
  const countryFlag = country === 'us' ? '🇺🇸' : country === 'uk' ? '🇬🇧' : '🌍';

  const gender: VoiceGenderFilter =
    prefix[1] === 'f' ? 'female' : prefix[1] === 'm' ? 'male' : 'other';
  const genderLabel = gender === 'female' ? 'Female' : gender === 'male' ? 'Male' : 'Other';

  return {
    id,
    label: name || id,
    country,
    countryLabel,
    countryFlag,
    gender,
    genderLabel,
  };
}

export function TTSSettingsPanel({ className }: TTSSettingsPanelProps) {
  const {
    modelStatus,
    device,
    voices,
    selectedVoice,
    speed,
    setSelectedVoice,
    setSpeed,
    initModel,
    resetModel,
  } = useTTSStore();

  const [countryFilter, setCountryFilter] = useState<VoiceCountryFilter>('all');
  const [genderFilter, setGenderFilter] = useState<VoiceGenderFilter>('all');
  const [storageUsage, setStorageUsage] = useState<number | null>(null);
  const [storageQuota, setStorageQuota] = useState<number | null>(null);
  const [modelCacheUsage, setModelCacheUsage] = useState<number | null>(null);
  const [isRefreshingUsage, setIsRefreshingUsage] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewListenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  // Popular voices to show first
  const popularVoices = ['af_heart', 'af_bella', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bm_george'];

  const voiceList = useMemo(() => {
    if (!voices) return [];
    return Object.keys(voices)
      .map(parseVoiceMeta)
      .sort((a, b) => {
        const aPopular = popularVoices.indexOf(a.id);
        const bPopular = popularVoices.indexOf(b.id);
        if (aPopular !== -1 && bPopular !== -1) return aPopular - bPopular;
        if (aPopular !== -1) return -1;
        if (bPopular !== -1) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [voices]);

  const filteredVoices = useMemo(() => {
    return voiceList.filter((voice) => {
      const matchesCountry = countryFilter === 'all' || voice.country === countryFilter;
      const matchesGender = genderFilter === 'all' || voice.gender === genderFilter;
      return matchesCountry && matchesGender;
    });
  }, [voiceList, countryFilter, genderFilter]);

  const isModelCacheUnavailable =
    typeof window !== 'undefined' && (!window.isSecureContext || !('caches' in window));

  const refreshStorageStats = async () => {
    setIsRefreshingUsage(true);
    try {
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        setStorageUsage(estimate.usage ?? null);
        setStorageQuota(estimate.quota ?? null);
      } else {
        setStorageUsage(null);
        setStorageQuota(null);
      }

      if (!('caches' in window)) {
        setModelCacheUsage(null);
        return;
      }

      const cacheKeys = await caches.keys();
      const modelCacheNames = cacheKeys.filter((key) =>
        /transformers|onnx|kokoro|huggingface/i.test(key)
      );

      let totalBytes = 0;
      for (const cacheName of modelCacheNames) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        for (const request of requests) {
          const response = await cache.match(request);
          const contentLength = response?.headers.get('content-length');
          if (contentLength) {
            totalBytes += Number.parseInt(contentLength, 10) || 0;
          }
        }
      }

      setModelCacheUsage(totalBytes);
    } finally {
      setIsRefreshingUsage(false);
    }
  };

  const clearModelCache = async () => {
    setIsClearingCache(true);
    try {
      if ('caches' in window) {
        const cacheKeys = await caches.keys();
        const modelCacheNames = cacheKeys.filter((key) =>
          /transformers|onnx|kokoro|huggingface/i.test(key)
        );
        await Promise.all(modelCacheNames.map((cacheName) => caches.delete(cacheName)));
      }

      if ('indexedDB' in window && 'databases' in indexedDB) {
        const databases = await indexedDB.databases();
        const modelDatabases = databases.filter((db) =>
          db.name && /transformers|onnx|kokoro|huggingface/i.test(db.name)
        );
        await Promise.all(
          modelDatabases.map((db) =>
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(db.name!);
              request.onsuccess = () => resolve();
              request.onerror = () => resolve();
              request.onblocked = () => resolve();
            })
          )
        );
      }

      resetModel();
      await refreshStorageStats();
    } finally {
      setIsClearingCache(false);
    }
  };

  const handlePreviewToggle = () => {
    setPreviewError(null);

    if (isPreviewPlaying && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setIsPreviewPlaying(false);
      return;
    }

    // Ensure model is loaded
    if (modelStatus === 'idle') {
      initModel();
    }

    // Wait for the main store worker to be ready, then send preview through it
    const store = useTTSStore.getState();
    const worker = store._worker;

    if (!worker || modelStatus !== 'ready') {
      // Model still loading — subscribe to store changes and retry when ready
      setIsPreviewLoading(true);
      const unsub = useTTSStore.subscribe((state) => {
        if (state.modelStatus === 'ready' && state._worker) {
          unsub();
          sendPreviewToWorker(state._worker, selectedVoice);
        } else if (state.modelStatus === 'error') {
          unsub();
          setIsPreviewLoading(false);
          setPreviewError(state.modelError || 'Model failed to load');
        }
      });
      return;
    }

    sendPreviewToWorker(worker, selectedVoice);
  };

  const sendPreviewToWorker = (worker: Worker, voiceId: string) => {
    const previewText =
      'Hello! This is a short voice preview for Informeer text to speech settings.';

    // Remove any previous preview listener to avoid duplicates
    if (previewListenerRef.current) {
      worker.removeEventListener('message', previewListenerRef.current);
    }

    setIsPreviewLoading(true);

    const PREVIEW_PASSAGE_INDEX = 999999; // Unique index to identify preview responses

    const listener = (e: MessageEvent) => {
      const data = e.data;

      if (data.type === 'passage' && data.passageIndex === PREVIEW_PASSAGE_INDEX) {
        setIsPreviewLoading(false);

        // Clean up previous preview audio
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
        }

        const url = URL.createObjectURL(data.audio as Blob);
        previewUrlRef.current = url;

        if (!previewAudioRef.current) {
          previewAudioRef.current = new Audio();
          previewAudioRef.current.addEventListener('ended', () => setIsPreviewPlaying(false));
          previewAudioRef.current.addEventListener('pause', () => setIsPreviewPlaying(false));
          previewAudioRef.current.addEventListener('play', () => setIsPreviewPlaying(true));
        }

        previewAudioRef.current.src = url;
        previewAudioRef.current.playbackRate = speed;
        previewAudioRef.current.play().catch((err) => {
          setPreviewError(err instanceof Error ? err.message : 'Failed to play preview');
          setIsPreviewPlaying(false);
        });

        // Remove listener after receiving the preview
        worker.removeEventListener('message', listener);
        previewListenerRef.current = null;
        return;
      }

      if (data.type === 'error') {
        setIsPreviewLoading(false);
        setPreviewError(data.error || 'Preview failed');
        worker.removeEventListener('message', listener);
        previewListenerRef.current = null;
      }
    };

    previewListenerRef.current = listener;
    worker.addEventListener('message', listener);

    worker.postMessage({
      type: 'synthesizePassage',
      passage: previewText,
      passageIndex: PREVIEW_PASSAGE_INDEX,
      voice: voiceId,
      speed,
    });
  };

  useEffect(() => {
    refreshStorageStats();
  }, []);

  useEffect(() => {
    if (previewAudioRef.current && isPreviewPlaying) {
      previewAudioRef.current.playbackRate = speed;
    }
  }, [speed, isPreviewPlaying]);

  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      // Clean up preview listener from the shared worker
      if (previewListenerRef.current) {
        const worker = useTTSStore.getState()._worker;
        if (worker) {
          worker.removeEventListener('message', previewListenerRef.current);
        }
      }
    };
  }, []);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center gap-2">
        <Headphones size={16} className="text-[var(--color-accent-fg)]" />
        <span className="text-sm font-medium text-[var(--color-text-primary)]">
          Text-to-Speech
        </span>
        {device && (
          <span className="ml-auto flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
            <Zap size={10} />
            {device === 'webgpu' ? 'WebGPU' : 'WASM'}
          </span>
        )}
      </div>

      {/* Model status */}
      {modelStatus === 'idle' && (
        <button
          onClick={initModel}
          className={cn(
            'w-full py-3 px-4 rounded-xl text-sm font-medium',
            'bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)]',
            'hover:bg-[var(--color-surface-hover)] transition-colors',
            'flex items-center justify-center gap-2'
          )}
        >
          <Headphones size={16} />
          Load TTS Model
        </button>
      )}

      {modelStatus === 'ready' && (
        <div className="flex items-center justify-between rounded-xl bg-[var(--color-surface-inset)] px-4 py-3">
          <div>
            <div className="text-sm font-medium text-[var(--color-text-primary)]">Model loaded</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">Ready for offline playback</div>
          </div>
          <button
            onClick={resetModel}
            className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            Unload
          </button>
        </div>
      )}

      {modelStatus === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-[var(--color-text-tertiary)]">
          <Loader2 size={16} className="animate-spin" />
          Loading TTS model...
        </div>
      )}

      {modelStatus === 'error' && (
        <div className="py-2 px-3 rounded-lg bg-[var(--color-danger-fg)]/10 text-sm text-[var(--color-danger-fg)]">
          Failed to load TTS model. Try refreshing.
        </div>
      )}

      {/* Voice selection */}
      {voices && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Voice</label>
          <div className="space-y-2 rounded-xl bg-[var(--color-surface-secondary)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--color-text-tertiary)]">Country</span>
              {([
                ['all', 'All'],
                ['us', 'US'],
                ['uk', 'UK'],
                ['other', 'Other'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setCountryFilter(value)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                    countryFilter === value
                      ? 'bg-[var(--color-accent-fg)]/15 text-[var(--color-accent-fg)]'
                      : 'bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--color-text-tertiary)]">Voice type</span>
              {([
                ['all', 'All'],
                ['female', 'Female'],
                ['male', 'Male'],
                ['other', 'Other'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setGenderFilter(value)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                    genderFilter === value
                      ? 'bg-[var(--color-accent-fg)]/15 text-[var(--color-accent-fg)]'
                      : 'bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
            {filteredVoices.map((voice) => (
              <button
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className={cn(
                  'px-3 py-2.5 rounded-xl text-left transition-all border',
                  selectedVoice === voice.id
                    ? 'bg-[var(--color-accent-fg)]/10 border-[var(--color-accent-fg)]/40'
                    : 'bg-[var(--color-surface-inset)] border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]'
                )}
              >
                <div className="text-sm font-medium text-[var(--color-text-primary)]">{voice.label}</div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
                  <span>{voice.countryFlag} {voice.countryLabel}</span>
                  <span>•</span>
                  <span>{voice.genderLabel}</span>
                </div>
              </button>
            ))}

            {filteredVoices.length === 0 && (
              <div className="col-span-full rounded-xl bg-[var(--color-surface-inset)] px-3 py-4 text-sm text-[var(--color-text-tertiary)] text-center">
                No voices match the selected filters.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Speed control */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Speed</label>
          <span className="text-xs text-[var(--color-text-tertiary)]">{speed}x</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.25}
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-[var(--color-surface-inset)] rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 
            [&::-webkit-slider-thumb]:bg-[var(--color-accent-fg)] [&::-webkit-slider-thumb]:rounded-full 
            [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
        />
      </div>

      {/* Voice preview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Voice preview</label>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {voiceList.find((voice) => voice.id === selectedVoice)?.label ?? selectedVoice}
          </span>
        </div>
        <button
          onClick={handlePreviewToggle}
          disabled={isPreviewLoading}
          className={cn(
            'w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
            'bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
            'disabled:opacity-60 disabled:cursor-not-allowed'
          )}
        >
          {isPreviewLoading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : isPreviewPlaying ? (
            <Pause size={15} />
          ) : (
            <Play size={15} />
          )}
          {isPreviewLoading ? 'Generating preview...' : isPreviewPlaying ? 'Stop preview' : 'Preview selected voice'}
        </button>
        {previewError && (
          <div className="text-xs text-[var(--color-danger-fg)]">{previewError}</div>
        )}
      </div>

      {/* Model cache */}
      <div className="space-y-3 pt-2 border-t border-[var(--color-border-subtle)]">
        {isModelCacheUnavailable && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Model caching is unavailable in this environment (non-secure origin or missing CacheStorage).
                Use <strong>HTTPS</strong> or <strong>localhost</strong> for faster startup and better offline reuse.
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Model cache</label>
          <button
            onClick={refreshStorageStats}
            disabled={isRefreshingUsage}
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] disabled:opacity-50"
          >
            <RefreshCw size={12} className={cn(isRefreshingUsage && 'animate-spin')} />
            Refresh
          </button>
        </div>

        <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3 space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-secondary)]">Estimated model cache</span>
            <span className="font-medium text-[var(--color-text-primary)]">{formatBytes(modelCacheUsage)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-text-tertiary)]">Total browser storage used</span>
            <span className="text-[var(--color-text-secondary)]">
              {formatBytes(storageUsage)}{storageQuota ? ` / ${formatBytes(storageQuota)}` : ''}
            </span>
          </div>
        </div>

        <button
          onClick={clearModelCache}
          disabled={isClearingCache}
          className={cn(
            'w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
            'bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
            'disabled:opacity-60 disabled:cursor-not-allowed'
          )}
        >
          {isClearingCache ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Trash2 size={15} />
          )}
          Clear model cache
        </button>
      </div>
    </div>
  );
}
