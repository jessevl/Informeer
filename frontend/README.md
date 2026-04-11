# Informeer — Frontend

The React SPA for Informeer. See the [root README](../README.md) for full project documentation.

## Development

```bash
npm install
npm run hooks:install
npm run dev
```

The dev server starts on port 5173 with an API proxy to `localhost:3011`.

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