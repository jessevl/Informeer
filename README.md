# Informeer

A modern, beautifully designed frontend client for [Miniflux](https://miniflux.app/) that unifies RSS feeds, podcasts, and YouTube subscriptions into a polished reading experience.

## Features

- **Unified reading timeline** for all feeds
- **Audio & video views** with built-in players
- **Magazine-style reading** and reader mode
- **Fast navigation** with keyboard shortcuts
- **Themes & design system** built on Frameer/Planneer UI patterns
- **Fully client-side**: Miniflux handles all backend operations

## Tech Stack

- React 19 + TypeScript 5
- Vite 6
- TanStack Router
- Zustand
- Tailwind CSS v4
- Dexie (local persistence)

## Getting Started

### Prerequisites

- Node.js 18+ (recommended)
- A running Miniflux instance

### Install

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
3. Open the app at http://localhost:3000 and sign in with your Miniflux URL, username, and password.

### Build

```bash
npm run build
```

### Preview

```bash
npm run preview
```

## Configuration

### Miniflux API Endpoint (Dev Proxy)

In development, Vite proxies `/api` to your Miniflux instance. Update the proxy target in:

- [vite.config.ts](vite.config.ts)

Set `server.proxy['/api'].target` to your Miniflux base URL (without `/v1`).

### Authentication

Informeer uses **HTTP Basic Auth** (username/password) to connect to Miniflux. Credentials are stored in **browser localStorage** for session persistence.

## Environment Variables

No environment variables are required by default. An example file is provided at:

- [.env.example](.env.example)

If you add your own environment files, do **not** commit them.

## Project Structure

```
src/
  api/            # Miniflux API client
  components/     # UI and layout components
  hooks/          # Custom React hooks
  routes/         # TanStack Router routes
  stores/         # Zustand state stores
  styles/         # Global styles and tokens
  frameer/        # Local UI library package
```

## License

Specify a license before publishing if you plan to distribute or accept contributions.