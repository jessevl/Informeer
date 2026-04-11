import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useAudioStore, setStopVideoCallback } from '@/stores/audio';
import { useVideoStore, setStopAudioCallback } from '@/stores/video';
import { useTTSStore, setStopAudioCallbackForTTS, setStopVideoCallbackForTTS } from '@/stores/tts';
import { initConnectivity } from '@/stores/connectivity';
import { initFocusRefresh } from '@/lib/focus-refresh';
import { flushSyncQueue } from '@/lib/offline/sync-queue';
import { useFeedsStore } from '@/stores/feeds';
import { useEntriesStore } from '@/stores/entries';
import { OfflineBanner } from '@/components/layout/OfflineBanner';
import ThemeInitializer from '@/components/ThemeInitializer';

// Function to stop TTS playback
let stopTTSPlayback: (() => void) | null = null;

export function setStopTTSCallback(callback: () => void) {
  stopTTSPlayback = callback;
}

// Initialize cross-store communication for unified player behavior
function initializeUnifiedPlayer() {
  // When video plays, stop audio and TTS
  setStopAudioCallback(() => {
    const audioState = useAudioStore.getState();
    if (audioState.currentEnclosure) {
      audioState.stop();
    }
    // Also stop TTS
    const ttsState = useTTSStore.getState();
    if (ttsState.currentEntry) {
      ttsState.abort();
      ttsState.cleanup();
    }
  });
  
  // When audio plays, stop video and TTS
  setStopVideoCallback(() => {
    const videoState = useVideoStore.getState();
    if (videoState.currentEnclosure || videoState.currentYouTubeId) {
      videoState.stop();
    }
    // Also stop TTS
    const ttsState = useTTSStore.getState();
    if (ttsState.currentEntry) {
      ttsState.abort();
      ttsState.cleanup();
    }
  });

  // When TTS plays, stop audio and video
  setStopAudioCallbackForTTS(() => {
    const audioState = useAudioStore.getState();
    if (audioState.currentEnclosure) {
      audioState.stop();
    }
  });

  setStopVideoCallbackForTTS(() => {
    const videoState = useVideoStore.getState();
    if (videoState.currentEnclosure || videoState.currentYouTubeId) {
      videoState.stop();
    }
  });
}

// Call once on module load
initializeUnifiedPlayer();

function RootComponent() {
  const navigate = useNavigate();
  const { isAuthenticated, checkAuth } = useAuthStore();
  const [isChecking, setIsChecking] = useState(true);
  const offlineInitRef = useRef(false);

  useEffect(() => {
    const init = async () => {
      const isValid = await checkAuth();
      setIsChecking(false);
      
      if (!isValid) {
        navigate({ to: '/login' });
      }
    };
    init();
  }, [checkAuth, navigate]);

  // Initialise connectivity monitoring and focus-refresh (once, after auth)
  useEffect(() => {
    if (isChecking || !isAuthenticated || offlineInitRef.current) return;
    offlineInitRef.current = true;

    const cleanupConnectivity = initConnectivity(() => {
      // When coming back online, flush queued mutations
      flushSyncQueue().catch(() => {});
    });

    const cleanupFocus = initFocusRefresh({
      refreshEntries: () => useEntriesStore.getState().fetchEntries(false),
      refreshFeeds: () => useFeedsStore.getState().fetchFeeds(),
      refreshCounters: () => useFeedsStore.getState().fetchCounters(),
    });

    return () => {
      cleanupConnectivity();
      cleanupFocus();
      offlineInitRef.current = false;
    };
  }, [isChecking, isAuthenticated]);

  if (isChecking) {
    return (
      <>
        <ThemeInitializer />
        <div className="min-h-screen bg-[var(--color-surface-app)] flex items-center justify-center">
          <div className="text-[var(--color-text-secondary)]">Loading...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <ThemeInitializer />
      <OfflineBanner />
      <div className="animate-fade-in">
        <Outlet />
      </div>
    </>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
