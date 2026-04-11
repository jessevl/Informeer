import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settings';

export function useResolvedIsDark() {
  const theme = useSettingsStore((state) => state.theme);
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemIsDark(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return theme === 'dark' || (theme === 'system' && systemIsDark);
}