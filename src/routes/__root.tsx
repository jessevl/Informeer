import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useAudioStore, setStopVideoCallback } from '@/stores/audio';
import { useVideoStore, setStopAudioCallback } from '@/stores/video';
import ThemeInitializer from '@/components/ThemeInitializer';

// Initialize cross-store communication for unified player behavior
function initializeUnifiedPlayer() {
  // When video plays, stop audio
  setStopAudioCallback(() => {
    const audioState = useAudioStore.getState();
    if (audioState.currentEnclosure) {
      audioState.stop();
    }
  });
  
  // When audio plays, stop video
  setStopVideoCallback(() => {
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
      <div className="animate-fade-in">
        <Outlet />
      </div>
    </>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
