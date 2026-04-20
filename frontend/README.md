# Informeer — Frontend

The React SPA for Informeer. See the [root README](../README.md) for full project documentation.

## Development

```bash
npm install
npm run hooks:install
npm run dev
```

The dev server starts on port 3000 with an API proxy to `localhost:3011`.

For Android, the frontend scripts are intentionally reduced to these main entry points:

- `npm run dev:android:server`: start the Android-friendly Vite dev server on port 3000
- `npm run android:reverse`: configure `adb reverse` for `localhost:3000` and `localhost:3011`
- `npm run android:dev`: install and launch the live-reload Android app
- `npm run android:build`: build the native debug APK
- `npm run android:install`: build and install the native debug app on an emulator or device

For Android emulator live-reload, run the dev server on all interfaces and point Capacitor at the emulator host alias:

```bash
npm run dev:android:server
npm run android:dev
```

`npm run android:dev` now configures `adb reverse` automatically and loads the app from `http://localhost:3000`, which keeps service worker and `window.caches` available for offline testing. `10.0.2.2` can still reach the host, but it is not a secure origin, so Android offline caching and PWA behavior will not match the browser there.

For native emulator installs that run the bundled app instead of live reload, Android now keeps a local login shell in the APK, then relaunches into the server-hosted frontend you choose there so the server's own PWA cache and offline media caches remain authoritative after a reboot. The install script also configures `adb reverse` and defaults the bundled shell to `http://localhost:3011` for local Android testing.

To target a different backend when building a native bundle, override `VITE_API_URL`:

```bash
VITE_API_URL=http://your-host:3011 npm run android:install
```

`npm run hooks:install` enables the repo-local Git guardrail for the `src/frameer` submodule so accidental submodule pointer changes are blocked before push.

## Tech Stack

- React 19 + TypeScript 5
- Vite 6
- TanStack Router (file-based routing)
- Zustand (state management)
- Tailwind CSS v4
- Frameer (shared UI library, git submodule)

## Project Structure

```
src/
  api/            # API client
  components/     # UI: entries, feeds, player, podcasts, reader, TTS, etc.
  hooks/          # Keyboard shortcuts, offline detection, pull-to-refresh
  routes/         # TanStack Router pages
  stores/         # Zustand state stores
  styles/         # Global styles and design tokens
  frameer/        # Shared UI library (submodule)
```

## Build

```bash
npm run build     # Production build to dist/
npm run preview   # Preview production build locally
```

## License

[AGPL-3.0-or-later](LICENSE)