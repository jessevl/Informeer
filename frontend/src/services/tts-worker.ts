/**
 * TTS Web Worker
 * Runs Kokoro TTS model off the main thread using kokoro-js
 * Streams audio chunks back to the main thread as they're generated
 */

import { KokoroTTS, TextSplitterStream } from 'kokoro-js';

// Some production worker runtimes (or polyfilled environments) do not expose
// CacheStorage as `caches`, but transformers/kokoro access it directly.
// Provide a no-op shim so generation can continue without persistent cache.
if (typeof (globalThis as { caches?: unknown }).caches === 'undefined') {
  const noOpCache: any = {
    match: async () => undefined,
    matchAll: async () => [],
    add: async () => {},
    addAll: async () => {},
    put: async () => {},
    delete: async () => false,
    keys: async () => [],
  };

  const cacheStorageShim: any = {
    open: async () => noOpCache,
    has: async () => false,
    delete: async () => false,
    keys: async () => [],
    match: async () => undefined,
  };

  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    enumerable: true,
    writable: false,
    value: cacheStorageShim,
  });
}

// Detect WebGPU support
async function detectWebGPU(): Promise<boolean> {
  try {
    // @ts-expect-error - WebGPU types
    const adapter = await navigator.gpu?.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

let tts: KokoroTTS | null = null;
let currentAbortController: AbortController | null = null;

async function initializeModel() {
  const device = (await detectWebGPU()) ? 'webgpu' : 'wasm';
  self.postMessage({ type: 'device', device });

  const model_id = 'onnx-community/Kokoro-82M-v1.0-ONNX';

  self.postMessage({ type: 'loading', message: 'Downloading TTS model...' });

  tts = await KokoroTTS.from_pretrained(model_id, {
    dtype: device === 'wasm' ? 'q8' : 'fp32',
    device,
  }).catch((e: Error) => {
    self.postMessage({ type: 'error', error: e.message });
    throw e;
  });

  self.postMessage({
    type: 'ready',
    voices: tts.voices,
    device,
  });
}

// Initialize on worker start
initializeModel();

// Listen for messages
self.addEventListener('message', async (e: MessageEvent) => {
  const { type, passage, passageIndex, voice, speed } = e.data;

  if (type === 'abort') {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    return;
  }

  if (type === 'synthesizePassage') {
    if (!tts) {
      self.postMessage({ type: 'error', error: 'Model not loaded yet' });
      return;
    }

    // Abort any previous generation
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
      const streamer = new TextSplitterStream();
      streamer.push(passage);
      streamer.close();

      const stream = tts.stream(streamer, { voice: voice || 'af_heart', speed: speed || 1 });

      const pieces: any[] = [];
      for await (const { audio } of stream) {
        if (signal.aborted) break;
        pieces.push(audio);
      }

      if (!signal.aborted && pieces.length > 0) {
        let audioBlob: Blob;

        if (pieces.length === 1) {
          audioBlob = pieces[0].toBlob();
        } else {
          const samplingRate = pieces[0].sampling_rate;
          const silenceMsBetweenPieces = 40;
          const silenceSamples = Math.max(1, Math.floor((samplingRate * silenceMsBetweenPieces) / 1000));
          const totalSilence = silenceSamples * (pieces.length - 1);
          const totalLength = pieces.reduce((sum, piece) => sum + piece.audio.length, 0) + totalSilence;
          const waveform = new Float32Array(totalLength);

          let offset = 0;
          for (let index = 0; index < pieces.length; index++) {
            const piece = pieces[index];
            waveform.set(piece.audio, offset);
            offset += piece.audio.length;
            if (index < pieces.length - 1) {
              offset += silenceSamples;
            }
          }

          const RawAudioCtor = pieces[0].constructor;
          const mergedAudio = new RawAudioCtor(waveform, samplingRate);
          audioBlob = mergedAudio.toBlob();
        }

        self.postMessage({
          type: 'passage',
          passageIndex,
          text: passage,
          audio: audioBlob,
        });
      }
    } catch (err) {
      if (!signal.aborted) {
        self.postMessage({
          type: 'error',
          error: err instanceof Error ? err.message : 'Generation failed',
        });
      }
    }
  }
});
