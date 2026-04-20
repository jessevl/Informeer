import { Capacitor, WebPlugin, registerPlugin } from '@capacitor/core';

/**
 * Minimal native shell bridge for Android installs.
 *
 * The APK bundles only a tiny setup page for choosing the server URL. Once chosen,
 * the WebView loads the remote PWA and the service worker handles the rest.
 * This module exposes `isAndroidNativeShell()` for platform queries (e.g. e-ink)
 * and `clearServerUrl()` so the user can return to the setup page from settings.
 */

interface NativeShellPlugin {
  getServerUrl(): Promise<{ url: string | null }>;
  setServerUrl(options: { url: string }): Promise<void>;
  clearServerUrl(): Promise<void>;
}

class NativeShellWebPlugin extends WebPlugin implements NativeShellPlugin {
  async getServerUrl(): Promise<{ url: string | null }> {
    return { url: null };
  }

  async setServerUrl(): Promise<void> {}

  async clearServerUrl(): Promise<void> {}
}

const NativeShell = registerPlugin<NativeShellPlugin>('NativeShell', {
  web: () => new NativeShellWebPlugin(),
});

export function isAndroidNativeShell(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * Return to the bundled setup page by clearing the stored server URL.
 * The native plugin relaunches the activity, which will show the setup page
 * because no server URL is configured.
 */
export async function clearServerUrl(): Promise<void> {
  if (!isAndroidNativeShell()) return;
  await NativeShell.clearServerUrl();
}