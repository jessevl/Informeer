/**
 * TTS Store
 * Manages text-to-speech state, model loading, and streaming audio generation
 * Uses Kokoro TTS via a web worker for off-thread processing
 * 
 * Key design: Generates audio chunks incrementally, only staying ~2 chunks ahead
 * of playback to avoid wasting CPU on audio that may never be listened to.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Entry } from '@/types/api';

// Callbacks to stop other media players
let stopAudioPlayback: (() => void) | null = null;
let stopVideoPlayback: (() => void) | null = null;

export function setStopAudioCallbackForTTS(callback: () => void) {
  stopAudioPlayback = callback;
}

export function setStopVideoCallbackForTTS(callback: () => void) {
  stopVideoPlayback = callback;
}

export type TTSVoiceId = string;

export interface TTSVoice {
  id: string;
  name: string;
  language?: string;
}

export interface TTSChunk {
  index: number;
  text: string;
  audioBlob: Blob;
  audioUrl: string;
}

type TTSModelStatus = 'idle' | 'loading' | 'ready' | 'error';
type TTSGenerationStatus = 'idle' | 'generating' | 'done' | 'error';

interface TTSState {
  // Model state
  modelStatus: TTSModelStatus;
  modelError: string | null;
  device: string | null;
  voices: Record<string, TTSVoice> | null;

  // Generation state
  generationStatus: TTSGenerationStatus;
  chunks: TTSChunk[];
  currentChunkIndex: number;
  isPlaying: boolean;
  currentEntry: Entry | null;
  pendingPassages: string[];
  nextPassageIndex: number;
  isRenderingPassage: boolean;
  
  // Settings (persisted)
  selectedVoice: string;
  speed: number;

  // Actions
  initModel: () => void;
  generate: (text: string, entry: Entry) => void;
  abort: () => void;
  setPlaying: (playing: boolean) => void;
  setCurrentChunkIndex: (index: number) => void;
  advanceToNextChunk: () => boolean; // returns false if no more chunks
  requestNextPassage: () => void;
  ensureSinglePassageBuffer: () => void;
  cleanup: () => void;
  resetModel: () => void;
  setSelectedVoice: (voice: string) => void;
  setSpeed: (speed: number) => void;
  
  // Internal
  _worker: Worker | null;
  _workerReady: boolean;
}

function splitTextIntoPassages(text: string): string[] {
  const normalized = text
    .replace(/([.!?])([A-Z])/g, '$1 $2')
    .replace(/([.!?])(["'”’])(\S)/g, '$1$2 $3')
    .replace(/\n{3,}/g, '\n\n');

  const sentences = normalized
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) return [];

  const passages: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const isParagraphBoundary = /\n{2,}/.test(sentence);
    const joiner = isParagraphBoundary ? '\n\n' : ' ';
    const candidate = current ? `${current}${joiner}${sentence}` : sentence;
    if (candidate.length <= 320) {
      current = candidate;
      continue;
    }

    if (current) passages.push(current);
    current = sentence;
  }

  if (current) passages.push(current);
  return passages;
}

// Strip HTML and clean text for TTS
function prepareTextForTTS(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  // Remove scripts, styles, etc.
  doc.querySelectorAll('script, style, nav, header, footer, aside').forEach(el => el.remove());

  // Preserve paragraph and block boundaries for better pauses
  doc.querySelectorAll('p, div, li, blockquote, h1, h2, h3, h4, h5, h6, pre').forEach((el) => {
    if (!el.textContent?.trim()) return;
    if (!el.textContent.endsWith('\n\n')) {
      el.append('\n\n');
    }
  });

  doc.querySelectorAll('br').forEach((br) => {
    br.replaceWith('\n');
  });
  
  // Get text content
  let text = doc.body.textContent || '';
  
  // Ensure punctuation boundaries have spacing if source HTML removed it
  text = text
    .replace(/([.!?])([A-Z])/g, '$1 $2')
    .replace(/([.!?])(["'”’])(\S)/g, '$1$2 $3');

  // Keep paragraph breaks, but normalize internal whitespace
  text = text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  // Remove URLs
  text = text.replace(/https?:\/\/[^\s]+/g, '');
  
  // Limit length for sanity (very long articles)
  if (text.length > 50000) {
    text = text.substring(0, 50000) + '...';
  }
  
  return text;
}

export { prepareTextForTTS };

let workerInstance: Worker | null = null;
let workerMessageHandler: ((e: MessageEvent) => void) | null = null;
let workerErrorHandler: ((e: ErrorEvent) => void) | null = null;

function getOrCreateWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('../services/tts-worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return workerInstance;
}

export const useTTSStore = create<TTSState>()(
  persist(
    (set, get) => ({
      // Initial state
      modelStatus: 'idle',
      modelError: null,
      device: null,
      voices: null,
      generationStatus: 'idle',
      chunks: [],
      currentChunkIndex: -1,
      isPlaying: false,
      currentEntry: null,
      pendingPassages: [],
      nextPassageIndex: 0,
      isRenderingPassage: false,
      selectedVoice: 'af_heart',
      speed: 1,
      _worker: null,
      _workerReady: false,

      initModel: () => {
        const state = get();
        if (state.modelStatus === 'loading' || state.modelStatus === 'ready') return;

        set({ modelStatus: 'loading', modelError: null });

        const worker = getOrCreateWorker();

        // Remove previous listeners to prevent accumulation on retries
        if (workerMessageHandler) {
          worker.removeEventListener('message', workerMessageHandler);
        }
        if (workerErrorHandler) {
          worker.removeEventListener('error', workerErrorHandler);
        }

        const onMessage = (e: MessageEvent) => {
          const data = e.data;
          switch (data.type) {
            case 'device':
              set({ device: data.device });
              break;
            case 'loading':
              set({ modelStatus: 'loading' });
              break;
            case 'ready':
              set({
                modelStatus: 'ready',
                voices: data.voices,
                _worker: worker,
                _workerReady: true,
              });
              get().ensureSinglePassageBuffer();
              break;
            case 'error':
              set({
                modelStatus: 'error',
                modelError: data.error,
                generationStatus: 'error',
                isRenderingPassage: false,
              });
              break;
            case 'passage': {
              const blob = data.audio as Blob;
              const url = URL.createObjectURL(blob);
              const chunk: TTSChunk = {
                index: data.passageIndex,
                text: data.text,
                audioBlob: blob,
                audioUrl: url,
              };

              set((s) => {
                if (s.chunks.some((existingChunk) => existingChunk.index === chunk.index)) {
                  return {
                    isRenderingPassage: false,
                  };
                }

                const newChunks = [...s.chunks, chunk].sort((a, b) => a.index - b.index);
                // If this is the first chunk - auto-start playback
                const shouldAutoStart = s.currentChunkIndex === -1 && newChunks.length === 1;
                const isDone =
                  newChunks.length >= s.pendingPassages.length &&
                  s.nextPassageIndex >= s.pendingPassages.length;

                return {
                  chunks: newChunks,
                  currentChunkIndex: shouldAutoStart ? 0 : s.currentChunkIndex,
                  isPlaying: shouldAutoStart ? true : s.isPlaying,
                  isRenderingPassage: false,
                  generationStatus: isDone ? 'done' : s.generationStatus,
                };
              });
              get().ensureSinglePassageBuffer();
              break;
            }
          }
        };

        const onError = (e: ErrorEvent) => {
          console.error('TTS Worker error:', e);
          set({ modelStatus: 'error', modelError: e.message });
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        workerMessageHandler = onMessage;
        workerErrorHandler = onError;

        set({ _worker: worker });
      },

      generate: (text, entry) => {
        const state = get();
        
        // Stop other media players
        if (stopAudioPlayback) stopAudioPlayback();
        if (stopVideoPlayback) stopVideoPlayback();
        
        // Init model if needed
        if (state.modelStatus === 'idle') {
          get().initModel();
        }

        // Clean up old chunks
        state.chunks.forEach((chunk) => URL.revokeObjectURL(chunk.audioUrl));

        set({
          generationStatus: 'generating',
          chunks: [],
          currentChunkIndex: -1,
          isPlaying: false,
          currentEntry: entry,
          pendingPassages: splitTextIntoPassages(text),
          nextPassageIndex: 0,
          isRenderingPassage: false,
        });
        get().ensureSinglePassageBuffer();
      },

      abort: () => {
        const worker = get()._worker;
        if (worker) {
          worker.postMessage({ type: 'abort' });
        }
        set({
          generationStatus: 'idle',
          isPlaying: false,
          isRenderingPassage: false,
        });
      },

      setPlaying: (playing) => set({ isPlaying: playing }),

      setCurrentChunkIndex: (index) => {
        set({ currentChunkIndex: index });
        get().ensureSinglePassageBuffer();
      },

      advanceToNextChunk: () => {
        const state = get();
        const nextIndex = state.currentChunkIndex + 1;
        
        if (nextIndex < state.chunks.length) {
          set({ currentChunkIndex: nextIndex });
          get().ensureSinglePassageBuffer();
          return true;
        }
        
        // No more chunks yet - if still generating, we'll catch up
        if (state.generationStatus === 'generating') {
          // Keep isPlaying true, the player component will wait for chunks
          return true;
        }
        
        // All done
        set({ isPlaying: false, currentChunkIndex: -1 });
        return false;
      },

      requestNextPassage: () => {
        const state = get();

        if (state.generationStatus !== 'generating') return;
        if (state.isRenderingPassage) return;
        if (!state._workerReady || state.modelStatus !== 'ready') return;
        if (state.nextPassageIndex >= state.pendingPassages.length) {
          if (state.chunks.length >= state.pendingPassages.length) {
            set({ generationStatus: 'done' });
          }
          return;
        }

        const passageIndex = state.nextPassageIndex;
        const passage = state.pendingPassages[passageIndex];

        set({
          nextPassageIndex: passageIndex + 1,
          isRenderingPassage: true,
        });

        const worker = state._worker ?? getOrCreateWorker();
        worker.postMessage({
          type: 'synthesizePassage',
          passage,
          passageIndex,
          voice: state.selectedVoice,
          speed: state.speed,
        });
      },

      ensureSinglePassageBuffer: () => {
        const state = get();

        if (state.generationStatus !== 'generating') return;

        const targetRenderedCount =
          state.currentChunkIndex < 0
            ? 1
            : Math.min(state.pendingPassages.length, state.currentChunkIndex + 2);

        if (state.chunks.length < targetRenderedCount) {
          get().requestNextPassage();
          return;
        }

        if (
          state.chunks.length >= state.pendingPassages.length &&
          state.nextPassageIndex >= state.pendingPassages.length &&
          !state.isRenderingPassage
        ) {
          set({ generationStatus: 'done' });
        }
      },

      cleanup: () => {
        const state = get();
        state.chunks.forEach((chunk) => URL.revokeObjectURL(chunk.audioUrl));
        if (state._worker) {
          state._worker.postMessage({ type: 'abort' });
        }
        set({
          generationStatus: 'idle',
          chunks: [],
          currentChunkIndex: -1,
          isPlaying: false,
          currentEntry: null,
          pendingPassages: [],
          nextPassageIndex: 0,
          isRenderingPassage: false,
        });
      },

      resetModel: () => {
        const state = get();

        if (state._worker) {
          state._worker.postMessage({ type: 'abort' });
          state._worker.terminate();
        }

        if (workerInstance) {
          workerInstance = null;
        }
        workerMessageHandler = null;
        workerErrorHandler = null;

        set({
          modelStatus: 'idle',
          modelError: null,
          device: null,
          voices: null,
          _worker: null,
          _workerReady: false,
          generationStatus: 'idle',
          chunks: [],
          currentChunkIndex: -1,
          isPlaying: false,
          currentEntry: null,
          pendingPassages: [],
          nextPassageIndex: 0,
          isRenderingPassage: false,
        });
      },

      setSelectedVoice: (voice) => set({ selectedVoice: voice }),
      setSpeed: (speed) => set({ speed }),
    }),
    {
      name: 'informeer-tts',
      partialize: (state) => ({
        selectedVoice: state.selectedVoice,
        speed: state.speed,
      }),
    }
  )
);
