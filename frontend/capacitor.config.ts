import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.informeer.app',
  appName: 'Informeer',
  webDir: 'native-shell',
  server: {
    // During development, CAP_SERVER_URL points at the Vite dev server for live reload.
    // In production builds the bundled native-shell setup page is used; MainActivity
    // overrides the server URL at runtime once the user has chosen a server.
    ...(serverUrl ? { url: serverUrl } : {}),
    cleartext: true,
  },
};

export default config;
