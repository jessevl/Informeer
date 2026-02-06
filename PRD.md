# Informeer - Product Requirements Document

> **Version:** 2.1  
> **Last Updated:** January 30, 2026  
> **Status:** In Development  
> **Type:** Miniflux Client (Frontend Only)

---

## 1. Executive Summary

**Informeer** is a modern, beautifully designed frontend client for [Miniflux](https://miniflux.app/) that unifies RSS feeds, podcasts, and YouTube subscriptions into a polished reading experience. Built as a **Miniflux client**, Informeer focuses entirely on the frontend experience—leveraging Miniflux's battle-tested backend for feed management, syncing, and content fetching.

The project combines the **Miniflux integration patterns from Nextflux** with the **premium UI components from Planneer/Frameer** to create a reader that feels like a native Mac app while running in the browser.

### Vision Statement
*"The most beautiful way to read your Miniflux feeds."*

### Why a Miniflux Client?
- **Focus on UX:** Let Miniflux handle the hard parts (feed parsing, refresh scheduling, storage)
- **Proven Backend:** Miniflux is battle-tested, self-hostable, and privacy-focused
- **Faster Development:** Frontend-only means shipping sooner
- **Existing Ecosystem:** Users can switch clients without losing data

### Key Differentiators vs. Nextflux
- **Premium UI:** Glassmorphism, refined animations, Planneer-quality polish
- **Unified Media Experience:** First-class podcast and video player integration
- **Reeder-inspired Timeline:** Scroll position sync instead of unread counts
- **Enhanced Typography:** Magazine-quality reading experience
- **Advanced Customization:** Themes, layouts, and component-level styling

### Reference Repositories
| Repository | Purpose |
|------------|---------|
| [Nextflux](https://github.com/electh/nextflux) | Miniflux API integration patterns, stores, data flow |
| Planneer Frontend | UI patterns, layout system, navigation |
| Frameer | Reusable UI components, glassmorphism, design system |

---

## 2. Target Users

### Primary Personas

#### 1. The Miniflux Power User
- **Profile:** Already runs Miniflux, wants a better frontend
- **Needs:** Beautiful UI, keyboard shortcuts, fast navigation
- **Pain Points:** Miniflux's default UI is functional but basic

#### 2. The Reeder Convert
- **Profile:** Loves Reeder's design, uses Miniflux backend
- **Needs:** Reeder-like experience that connects to their Miniflux instance
- **Pain Points:** No cross-platform Reeder-quality client for Miniflux

#### 3. The Self-Hoster
- **Profile:** Runs their own infrastructure, privacy-conscious
- **Needs:** Modern web app that respects their setup
- **Pain Points:** Most polished readers require cloud subscriptions

#### 4. The Multi-Device Reader
- **Profile:** Reads on desktop, tablet, and phone
- **Needs:** Responsive design, consistent experience, PWA support
- **Pain Points:** Context switching between devices loses reading position

---

## 3. Product Features

### 3.1 Core Reading Experience

#### 3.1.1 Timeline View (Home)
- **Chronological feed** of all entries from Miniflux
- **Scroll position memory** — pick up where you left off (stored locally/via Miniflux)
- **Timeline controls:**
  - Jump to saved position
  - Jump to today
  - Jump to top/newest
- **Media type indicators** (article, podcast, video)
- **Reading time display** (from Miniflux API)
- **Infinite scroll** with smart prefetching
- **Mark as read on scroll** (configurable delay)

#### 3.1.2 Article Reader
- **Reader View** with Miniflux-fetched content
- **Typography controls:**
  - Font family (Serif, Sans-serif, Mono, System)
  - Font size (5 levels)
  - Line height and spacing
  - Content width (narrow, medium, wide)
- **Themes:**
  - Light mode
  - Dark mode
  - Sepia mode
  - OLED Black mode
  - Auto (follows system)
- **Progress indicator** showing scroll position
- **Image gallery** with zoom and gesture support (like Nextflux)
- **Code syntax highlighting** for technical content
- **"Fetch Original Content"** button (calls Miniflux API)

#### 3.1.3 Video Player
- **Embedded player** for YouTube content (detected via enclosures/URLs)
- **Privacy mode** using youtube-nocookie.com
- **Playback controls:**
  - Speed adjustment (0.5x - 3x)
  - Picture-in-Picture mode
  - Full-screen mode
- **Resume from last position** (stored in Miniflux enclosure media_progression)
- **Beautiful UI** inspired by Nextflux's video player

#### 3.1.4 Podcast Player
- **Persistent mini-player** across navigation (bottom bar)
- **Full-screen player** with artwork and metadata
- **Playback controls:**
  - Variable speed (0.5x - 3x)
  - Skip forward/backward (configurable intervals: 10s, 15s, 30s)
  - Sleep timer
- **Progress tracking** via Miniflux enclosure API (media_progression)
- **Background playback** support
- **Queue management** (local state, not Miniflux)
- **Show notes** display with clickable links

---

### 3.2 Sidebar Navigation

The sidebar provides the primary navigation structure with the following sections:

#### 3.2.1 Primary Navigation
- **Home** — Shows all entries from all feeds (chronological timeline)
- **Audio** — Filters to show only podcast/audio content (detected via enclosures)
- **Video** — Filters to show only video content (YouTube, video enclosures)

#### 3.2.2 Saved Section
A dedicated section for saved and bookmarked content:
- **Links** — Saved external links (future: via Miniflux third-party save)
- **Later** — Read later queue (future: local queue management)
- **Bookmarks** — Starred/bookmarked entries (via Miniflux starred field)
- **Favorites** — Favorited items (future: enhanced local favorites)

#### 3.2.3 Feed Categories
Categories are displayed as collapsible sections containing their feeds:
- Category name with unread count
- Expandable to show individual feeds
- Each feed shows title and unread count
- Click category to view all entries from that category
- Click feed to view entries from that specific feed

#### 3.2.4 Sidebar Header
- App branding (Informeer icon + name)
- Settings button (opens settings modal)
- Logout button
- Search button (⌘K shortcut displayed)

#### 3.2.5 Sidebar Footer
- Refresh All Feeds button with loading state

---

### 3.3 Content Organization (Miniflux-Powered)

> All organization features leverage the Miniflux API. Informeer provides a beautiful UI layer.

#### 3.2.1 Categories
- **Display Miniflux categories** in sidebar
- **Category entry counts** (unread/total via /v1/categories?counts=true)
- **Category-specific views** with filtering
- **Mark category as read** (via API)
- **Category CRUD** (create, rename, delete via Miniflux API)
- **Hide categories globally** (Miniflux 2.2.0+)

#### 3.2.2 Feeds
- **Feed list** organized by category
- **Feed icons** (fetched via Miniflux icon API)
- **Feed health indicators** (error count, last checked)
- **Feed management:**
  - Add feed (with discovery via /v1/discover)
  - Edit feed settings (crawler, rules, etc.)
  - Remove feed
  - Refresh individual feed
- **Hide feeds** from global timeline
- **OPML import/export** (via Miniflux API)

#### 3.2.3 Starred Items
- **Starred/Bookmarked entries** (via Miniflux starred field)
- **Toggle bookmark** action on any entry
- **Dedicated starred view**

#### 3.2.4 Entry Status
- **Unread / Read / Removed** states (Miniflux native)
- **Batch status updates** (mark multiple as read)
- **Flush history** (clear read entries via API)

---

### 3.3 Search & Filtering

#### 3.3.1 Search
- **Full-text search** via Miniflux API (search parameter)
- **Search within:**
  - All entries
  - Specific feed
  - Specific category
- **Search UI** with instant results

#### 3.3.2 Filters (Local)
- **Filter by status:** Unread, Read, All
- **Filter by media type:** Articles, Podcasts, Videos
- **Sort options:**
  - Published date (newest/oldest)
  - Entry ID
  - Status
  - Category
- **Date range filters**

---

### 3.4 Third-Party Integrations (via Miniflux)

> Miniflux handles third-party service integrations. Informeer triggers them via API.

#### 3.4.1 Save to Services
- **One-click save** to configured services (via POST /v1/entries/{id}/save)
- **Supported services** (configured in Miniflux):
  - Instapaper, Pocket, Wallabag, Pinboard, Linkding
  - Readeck, Shiori, Shaarli, Notion, Nunux Keeper
  - Espial, Readwise, Apprise, Omnivore, Raindrop, Betula

#### 3.4.2 Sharing
- **Copy link** to clipboard
- **Share via native share sheet** (Web Share API)
- **Share code generation** (Miniflux share_code field)

---

### 3.5 Authentication & Connection

#### 3.5.1 Miniflux Connection
- **Server URL** configuration
- **Authentication:**
  - Username/Password via HTTP Basic Auth (implemented)
  - Credentials stored securely with Zustand persist middleware
- **Connection test** on setup
- **Auto-reconnect** on connection loss
- **Multiple server profiles** (future)

#### 3.5.2 Security (Frontend)
- **Credentials stored securely** (encrypted localStorage or IndexedDB)
- **No credentials sent to third parties**
- **HTTPS enforcement** recommendation

---

### 3.6 Offline & Performance

#### 3.6.1 Local Caching
- **IndexedDB storage** for entries (like Nextflux)
- **Configurable cache size** and duration
- **Background sync** on reconnection
- **Offline reading** of cached content

#### 3.6.2 Performance
- **Optimistic UI updates** — instant feedback
- **Virtualized lists** — smooth scrolling with thousands of entries
- **Image lazy loading** — load images as they scroll into view
- **Prefetching** — load next entries before scroll reaches them

---

### 3.7 Customization & Settings

#### 3.7.1 Appearance (Planneer/Frameer Theme System)
- **Theme selection:**
  - Light, Dark, System (auto-detect)
  - **Color schemes** (from Frameer):
    - Stone (warm neutral)
    - Zinc (cool neutral)
    - Slate (blue-gray)
    - Gray (pure neutral)
    - Neutral (balanced)
  - **Accent colors** (from Planneer):
    - Blue (default)
    - Purple
    - Green
    - Orange
    - Rose
    - Custom (hex picker)
- **Typography modes:**
  - Serif (reading-optimized)
  - Sans-serif (modern/clean)
  - System (native fonts)
- **Layout options:**
  - List view (compact)
  - Card view (with thumbnails)
  - Magazine view (larger cards)
- **Pane configuration:**
  - Two-pane (list + reader)
  - Three-pane (sidebar + list + reader)
  - Single pane (mobile/focused)
- **Visual effects** (Frameer glassmorphism):
  - Blur intensity (subtle, medium, strong)
  - Panel transparency
  - Border glow effects
- **Custom CSS injection** (advanced users)

#### 3.7.2 Reading Behavior
- **Mark as read on scroll** — with configurable delay
- **Mark as read on open** — immediate or delayed
- **Entry sort order** — newest first or oldest first
- **Default view** — unread or all entries
- **Swipe gestures** — configurable actions

#### 3.7.3 Sync Settings
- **Refresh interval** — auto-sync with Miniflux
- **Background refresh** — when tab is inactive
- **Startup behavior** — fetch latest on open

#### 3.7.4 Podcast/Video Settings
- **Default playback speed**
- **Skip intervals** (forward/backward)
- **Continue playback** preference
- **Mini-player position** (bottom bar or floating)

---

## 4. User Interface Design

### 4.1 Design Principles

Combining **Nextflux patterns** with **Planneer/Frameer aesthetics**:

1. **Content First:** Minimal chrome, maximum readability
2. **Glassmorphism:** Subtle blur, translucency, depth
3. **Fluid Animations:** Smooth transitions, micro-interactions
4. **Responsive:** Desktop to Tablet to Mobile seamlessly
5. **Accessible:** WCAG 2.1 AA, keyboard navigable
6. **Dark-Mode Native:** Designed for dark mode first

### 4.2 Component Architecture

#### From Nextflux (Patterns)
| Component | Purpose |
|-----------|---------|
| ArticleList | Entry list with virtualization |
| ArticleView | Reader pane with typography |
| FeedList | Sidebar feed tree |
| Search | Search modal/panel |
| Settings | Settings panels |

#### From Planneer/Frameer (Components)
| Component | Purpose |
|-----------|---------|
| Panel / GlassmorphPanel | Card containers |
| Sidebar | Collapsible navigation |
| NavItem | Navigation items |
| ResizeHandle | Adjustable panes |
| Button | Actions (primary, ghost, danger) |
| Input | Text fields with icons |
| Toggle | Boolean settings |
| Select | Dropdowns |
| ContextMenu | Right-click menus |
| Toast | Notifications |
| EmptyState | Smart empty states |
| MobileSheet | Bottom sheets |

#### New Components (Informeer)
| Component | Purpose |
|-----------|---------|
| MiniPlayer | Persistent podcast player bar |
| FullPlayer | Full-screen media player |
| VideoPlayer | YouTube embed with controls |
| ImageGallery | Lightbox with gestures |
| FeedIcon | Feed favicon display |
| EntryCard | Entry preview card variants |
| ProgressBar | Reading/playback progress |

---

## 5. Technical Architecture

### 5.1 Technology Stack

| Technology | Choice | Rationale |
|------------|--------|-----------|
| Build Tool | **Vite 6+** | Fast HMR, optimized builds, same as Planneer |
| Framework | **React 19+** | Component architecture, hooks, concurrent features |
| Router | **TanStack Router** | Type-safe routing, same as Planneer |
| Language | **TypeScript 5+** | Type safety, better DX |
| Styling | **Tailwind CSS 4+** | Utility-first, consistent with Planneer/Frameer |
| State | **Zustand** | Simple, lightweight state management |
| Data | **TanStack Query** | Caching, background refetch, optimistic updates |
| Local DB | **IndexedDB** (via Dexie.js) | Offline cache, like Nextflux |
| UI Library | **Frameer** (git submodule) | Internal design system, glassmorphism, `src/frameer/` |
| Icons | **Lucide React** | Consistent icon set |
| i18n | **i18next + react-i18next** | Internationalization |

### 5.2 Miniflux API Integration

Key endpoints used:

```
GET  /v1/me                         — Current user
GET  /v1/feeds                      — All feeds
GET  /v1/categories                 — All categories
GET  /v1/entries                    — Entries with filters
PUT  /v1/entries                    — Update entry status
PUT  /v1/entries/{id}/bookmark      — Toggle starred
GET  /v1/entries/{id}/fetch-content — Fetch original
POST /v1/entries/{id}/save          — Save to third-party
PUT  /v1/enclosures/{id}            — Update media progress
GET  /v1/feeds/counters             — Unread counts
```

Full API documentation: https://miniflux.app/docs/api.html

---

## 6. Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| **Navigation** | |
| Next entry | `J` or `↓` |
| Previous entry | `K` or `↑` |
| Open entry | `Enter` or `O` |
| Go back | `Escape` or `H` |
| Toggle sidebar | `[` |
| Toggle reading pane | `]` |
| **Entry Actions** | |
| Toggle read/unread | `M` |
| Toggle starred | `S` or `D` |
| Open in browser | `V` |
| Save to third-party | `B` |
| Fetch original content | `F` |
| **Views** | |
| Go to All | `G` then `A` |
| Go to Unread | `G` then `U` |
| Go to Starred | `G` then `S` |
| Go to Today | `G` then `T` |
| **Playback** | |
| Play/Pause | `Space` |
| Skip forward | `→` or `L` |
| Skip backward | `←` or `J` |
| Speed up | `>` |
| Speed down | `<` |
| **Global** | |
| Search | `/` or `⌘K` |
| Refresh | `R` |
| Settings | `,` |
| Help | `?` |

---

## 7. Delighter Features

### 7.1 Enhanced Reading
- **Focus Mode:** Distraction-free, full-screen reading
- **Progress Tracking:** Visual indicator of reading position
- **Image Gallery:** Swipe through article images with zoom

### 7.2 Smart Caching
- **Offline Mode:** Read cached entries without connection
- **Preloading:** Fetch next entries before you need them
- **Smart Cleanup:** Auto-remove old cached content

### 7.3 Media Excellence
- **Unified Player:** Seamless podcast/video experience
- **Speed Memory:** Remember playback speed per feed
- **Chapter Support:** Navigate podcast chapters when available

### 7.4 Visual Polish
- **Smooth Animations:** 60fps transitions throughout
- **Theme Variants:** Multiple color schemes per mode
- **Custom Fonts:** Web font options for reading

### 7.5 Power Features
- **Command Palette:** Quick access via ⌘K
- **Bulk Actions:** Select and mark multiple entries
- **Feed Health:** Visual indicators for broken feeds

### 7.6 Future Delighters
- **AI Summaries:** Optional OpenAI/Ollama integration for summaries
- **Text-to-Speech:** Article narration
- **Widgets:** macOS/iOS home screen widgets (native apps)
- **Share Extensions:** Quick add from other apps

---

## 8. Platform Support

### Phase 1 — Web (MVP)
- **Browsers:** Chrome, Firefox, Safari, Edge (latest 2 versions)
- **PWA:** Installable, offline-capable
- **Responsive:** Mobile through ultra-wide

### Phase 2 — Desktop (Tauri)
- macOS native (Apple Silicon + Intel)
- Windows native
- Linux native (AppImage, deb)

### Phase 3 — Mobile
- iOS native (React Native or Swift)
- Android native (React Native or Kotlin)

---

## 9. Success Metrics

### Performance
| Metric | Target |
|--------|--------|
| First Contentful Paint | < 1.0s |
| Time to Interactive | < 2.0s |
| Entry render time | < 200ms |
| List scroll (60fps) | No dropped frames |

### Quality
- Error rate < 0.1%
- Offline success rate > 99%
- API call efficiency (batch when possible)

---

## 10. Development Roadmap

### Phase 1 — Foundation (Weeks 1-3) ✅
- [x] Project setup (Vite + React + TanStack Router + TypeScript + Tailwind)
- [x] Frameer UI library integrated as git submodule (`src/frameer/`)
- [x] Design tokens and base styles imported from Frameer
- [x] Miniflux API client implementation (`src/api/miniflux.ts`)
- [x] Authentication flow (login with username/password, HTTP Basic Auth)
- [x] Auth state persistence with Zustand
- [x] Login page with Frameer UI components
- [x] Basic entry list with infinite scroll
- [x] Article reader view with typography
- [x] Sidebar with categories/feeds

### Phase 2 — Core Experience (Weeks 4-6) 🔄 In Progress
- [x] Entry status management (read/unread/starred)
- [x] Search functionality (command palette style with ⌘K)
- [x] Category and feed views
- [x] Keyboard shortcuts (navigation, entry actions, search)
- [x] New sidebar navigation (Home, Audio, Video, Saved section)
- [x] Media type filtering (Audio/Video filters)
- [x] Multiple view modes (list, cards, magazine)
- [x] Theme system (dark mode, accent colors)
- [x] Cover image extraction and deduplication in articles
- [x] Settings modal with appearance/reading options
- [ ] Feed management (add, edit, delete)
- [x] Feed icons (via Miniflux icon API)

### Phase 3 — Media (Weeks 7-9)
- [x] YouTube video embed in article reader (privacy mode)
- [x] Podcast mini-player
- [x] Full podcast player UI
- [x] Playback progress sync (media_progression)
- [x] Queue management

### Phase 4 — Polish (Weeks 10-12)
- [ ] IndexedDB offline caching
- [ ] PWA setup (service worker, manifest)
- [ ] Performance optimization
- [ ] Accessibility audit
- [ ] Theme variants and customization
- [ ] i18n (English, Dutch)

### Phase 5 — Launch (Weeks 13-14)
- [ ] Beta testing
- [ ] Bug fixes
- [ ] Documentation
- [ ] Deploy to production

---

## 11. Appendix

### A. Nextflux Reference
Repository: https://github.com/electh/nextflux

Key patterns to adopt:
- Store structure (`stores/` folder)
- API client (`api/miniflux.js`)
- Component organization (`components/`)
- IndexedDB usage (`db/`)
- Image gallery with gestures
- Video/podcast player UI

### B. Frameer Integration
Internal repository: [github.com/jessevl/frameer](https://github.com/jessevl/frameer)

**Integration Method:** Git submodule at `src/frameer/`

**Import Paths:**
```typescript
import { Button, Input, Panel } from '@frameer/components/ui'
import { cn } from '@frameer/lib/design-system'
import { useMobileDetection } from '@frameer/hooks/useMobileDetection'
```

**Path Aliases (configured in tsconfig.json & vite.config.ts):**
```
@frameer/* → ./src/frameer/src/*
```

**Components in use:**
- Panel, GlassmorphPanel — Card containers
- Button, Input, Toggle, Select — Form controls
- Sidebar, NavItem — Navigation
- Toast, ContextMenu — Interactions
- EmptyState — Empty states

**Design Tokens:**
- CSS variables imported from `@frameer/styles/tokens.css`
- Base styles from `@frameer/styles/base.css`

**Development Rule:** Generic/reusable components should be added to Frameer, not this app. App-specific components go in `src/components/`.

### C. Competitive Comparison

| Feature | Informeer | Nextflux | Miniflux UI |
|---------|-----------|----------|-------------|
| Glassmorphism UI | ✅ Yes | ❌ No | ❌ No |
| Podcast Player | ✅ Yes | ✅ Yes | ❌ No |
| Video Player | ✅ Yes | ✅ Yes | ⚠️ Basic |
| Offline Cache | ✅ Yes | ✅ Yes | ❌ No |
| Custom Themes | ✅ Yes | ✅ Yes | ⚠️ Limited |
| PWA Support | ✅ Yes | ✅ Yes | ❌ No |
| i18n | ✅ Yes | ✅ Yes | ✅ Yes |
| Keyboard Shortcuts | ✅ Yes | ✅ Yes | ✅ Yes |
| Image Gallery | ✅ Yes | ✅ Yes | ❌ No |

---

*Informeer — A beautiful Miniflux client built with love.*
