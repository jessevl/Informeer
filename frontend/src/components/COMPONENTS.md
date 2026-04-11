# Component Architecture

Overview of where each component is used and how they relate.

## Rendering Chains

### Video Entries (main list)
```
routes/index.tsx → VideosView → EntryList → CardItem (internal)
```
`CardItem` renders the video thumbnails with play/queue buttons in the main videos section.

### Video Entries (channel detail)
```
routes/index.tsx → VideosView → ChannelDetail (internal) → VideoCard (internal)
```
`VideoCard` is only used inside the channel detail drill-down, not for the main video list.

### Podcast Entries
```
routes/index.tsx → PodcastsView → EntryList → MagazineItem / CardItem (internal)
```

### Article/Feed Entries
```
routes/index.tsx → EntryList → EntryCard
```

### EPUB Reader
```
routes/index.tsx → EPUBReader → useReaderGestures + useReaderAnimation + useReaderKeyboard + ReaderNavButtons + ReaderProgressBar + TypographyPanel
```

### PDF/Magazine Reader
```
routes/index.tsx → PDFViewer → useReaderGestures + useReaderAnimation + useReaderKeyboard + ReaderNavButtons + ReaderProgressBar
```

---

## Component Directories

### `books/`
| File | Exports | Used By |
|------|---------|---------|
| BooksView.tsx | `BooksView`, `BookHeaderActions` | routes/index.tsx |
| BookGrid.tsx | `BookGrid` | BooksView |
| EPUBReader.tsx | `EPUBReader` | routes/index.tsx |
| ZLibSearch.tsx | `ZLibSearch` | BooksView |

### `entries/`
No index.ts — components imported directly.

| File | Exports | Used By |
|------|---------|---------|
| EntryList.tsx | `EntryList` | routes/index.tsx, VideosView |
| EntryCard.tsx | `EntryCard` | EntryList |
| ArticleReader.tsx | `ArticleReader` | routes/index.tsx |
| ArticleContent.tsx | `ArticleContent` | ArticleReader |
| ArticleHeaderActions.tsx | `ArticleHeaderActions` | ArticleReader |
| CommentsPanel.tsx | `CommentsPanel` | ArticleReader |

**Internal components in EntryList.tsx** (not exported):
- `CardItem` — renders card-view entries (videos, podcasts, articles)
- `MagazineItem` — renders magazine-view entries
- `VirtualizedMasonry` — masonry grid layout for cards
- `ArticleModal` — inline article reader modal
- `YouTubeVideoTrigger` — YouTube embed trigger
- `useMediaProgress` — playback progress hook
- `getAudioEnclosure` — helper to find audio enclosure

### `feeds/`
| File | Exports | Used By |
|------|---------|---------|
| FeedIcon.tsx | `FeedIcon` | EntryCard, EntryList, VideosView, PodcastsView, AppSidebar |
| AddFeedModal.tsx | `AddFeedModal` | AppLayout |
| EditFeedModal.tsx | `EditFeedModal` | AppLayout |
| FeedContextMenu.tsx | `FeedContextMenu` | AppSidebar |
| FeedManagementModal.tsx | `FeedManagementModal` | AppLayout |

### `layout/`
No index.ts — components imported directly.

| File | Exports | Used By |
|------|---------|---------|
| AppLayout.tsx | `AppLayout` | routes/index.tsx |
| AppSidebar.tsx | `AppSidebar` | AppLayout |
| UnifiedHeader.tsx | `UnifiedHeader` | AppLayout |
| FloatingNavBar.tsx | `FloatingNavBar` | AppLayout |
| MobileDrawer.tsx | `MobileDrawer` | AppLayout |
| SearchModal.tsx | `SearchModal` | AppLayout |
| OfflineBanner.tsx | `OfflineBanner` | AppLayout |
| PullToRefreshIndicator.tsx | `PullToRefreshIndicator` | AppLayout |
| ViewTransition.tsx | `ViewTransition` | AppLayout |

### `magazines/`
| File | Exports | Used By |
|------|---------|---------|
| MagazinesView.tsx | `MagazinesView` | routes/index.tsx |
| MagazineCoverGrid.tsx | `MagazineCoverGrid` | MagazinesView |
| MagazineStack.tsx | `MagazineStack` | MagazinesView |
| MagazineIssuesRow.tsx | `MagazineIssuesRow` | MagazinesView |
| MagazineIssuesPanel.tsx | `MagazineIssuesPanel` | MagazinesView |
| PDFViewer.tsx | `PDFViewer` | routes/index.tsx |

### `media/`
Inline play/queue buttons used inside entry cards.

| File | Exports | Used By |
|------|---------|---------|
| AudioPlayButton.tsx | `AudioPlayButton` | EntryCard, EntryList |
| VideoPlayButton.tsx | `VideoPlayButton` | EntryCard, EntryList, VideosView |
| MediaProgressBar.tsx | `MediaProgressBar` | AudioPlayButton, EntryCard |

### `player/`
Persistent floating players that live at the app root.

| File | Exports | Used By |
|------|---------|---------|
| AudioPlayer.tsx | `AudioPlayer` | routes/index.tsx |
| VideoPlayer.tsx | `VideoPlayer` | routes/index.tsx |
| PlayButton.tsx | `PlayButton` | AudioPlayer |

### `podcasts/`
| File | Exports | Used By |
|------|---------|---------|
| PodcastsView.tsx | `PodcastsView` | routes/index.tsx |
| PodcastStack.tsx | `PodcastStack` | PodcastsView |
| PodcastEpisodesRow.tsx | `PodcastEpisodesRow` | PodcastsView |
| PodcastArtwork.tsx | `PodcastArtwork` | PodcastsView, PodcastStack |

### `reader/`
Shared infrastructure for EPUB and PDF readers.

| File | Exports | Used By |
|------|---------|---------|
| useReaderGestures.ts | `useReaderGestures` + types | EPUBReader, PDFViewer |
| useReaderAnimation.ts | `useReaderAnimation` + types | EPUBReader, PDFViewer |
| useReaderKeyboard.ts | `useReaderKeyboard` + types | EPUBReader, PDFViewer |
| ReaderNavButtons.tsx | `ReaderNavButtons` | EPUBReader, PDFViewer |
| ReaderProgressBar.tsx | `ReaderProgressBar` | EPUBReader, PDFViewer |
| TypographyPanel.tsx | `TypographyPanel` | EPUBReader (not in index.ts) |

### `settings/`
No index.ts — components imported directly.

| File | Exports | Used By |
|------|---------|---------|
| SettingsModal.tsx | `SettingsModal` | AppLayout |
| ui.tsx | Shared setting UI primitives | Setting section components |
| sections/ | Individual setting panels | SettingsModal |

### `tts/`
| File | Exports | Used By |
|------|---------|---------|
| TTSButton.tsx | `TTSButton` | ArticleReader |
| TTSMiniPlayer.tsx | `TTSMiniPlayer` | routes/index.tsx |
| TTSSettingsPanel.tsx | `TTSSettingsPanel` | SettingsModal |

### `ui/`
No index.ts — components imported directly.

| File | Exports | Used By |
|------|---------|---------|
| FilterBar.tsx | `FilterBar` | EntryList |
| OfflineSaveButton.tsx | `OfflineSaveButton` | ArticleReader |
| ToggleSwitch.tsx | `ToggleSwitch` | Settings sections |

### `videos/`
| File | Exports | Used By |
|------|---------|---------|
| VideosView.tsx | `VideosView` | routes/index.tsx |

**Internal components in VideosView.tsx** (not exported):
- `VideoCard` — renders individual video in channel detail view
- `ChannelDetail` — channel drill-down with video list
- `isYouTubeShort` — helper to detect YouTube Shorts
