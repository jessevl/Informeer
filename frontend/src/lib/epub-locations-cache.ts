import type { Book } from '@/types/api';

interface EpubLocationsCacheEntry {
  bookId: number;
  cacheKey: string;
  revision: string;
  savedAt: number;
  sizeBytes: number;
}

const EPUB_LOCATIONS_CACHE_NAME = 'informeer-epub-locations';
const EPUB_LOCATIONS_REGISTRY_KEY = 'informeer-epub-locations-registry';
const EPUB_LOCATIONS_CACHE_VERSION = 'v1';
const EPUB_LOCATIONS_MAX_ENTRIES = 24;

function canUseLocationsCache(): boolean {
  return typeof window !== 'undefined'
    && typeof localStorage !== 'undefined'
    && 'caches' in window;
}

async function openLocationsCache(): Promise<Cache | null> {
  if (!canUseLocationsCache() || typeof caches === 'undefined') {
    return null;
  }

  return caches.open(EPUB_LOCATIONS_CACHE_NAME);
}

function loadRegistry(): Record<string, EpubLocationsCacheEntry> {
  if (!canUseLocationsCache()) {
    return {};
  }

  try {
    return JSON.parse(localStorage.getItem(EPUB_LOCATIONS_REGISTRY_KEY) || '{}') as Record<string, EpubLocationsCacheEntry>;
  } catch {
    return {};
  }
}

function saveRegistry(registry: Record<string, EpubLocationsCacheEntry>): void {
  if (!canUseLocationsCache()) {
    return;
  }

  try {
    localStorage.setItem(EPUB_LOCATIONS_REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    // Ignore storage quota issues and fall back to runtime generation.
  }
}

function buildLocationsRevision(book: Book, charsPerBreak: number): string {
  return [
    EPUB_LOCATIONS_CACHE_VERSION,
    String(book.id),
    String(book.file_size),
    book.updated_at || '',
    String(charsPerBreak),
  ].join(':');
}

function buildLocationsCacheKey(bookId: number, revision: string): string {
  return `/epub-locations/books/${bookId}?revision=${encodeURIComponent(revision)}`;
}

async function pruneLocationsRegistry(
  registry: Record<string, EpubLocationsCacheEntry>,
  cache: Cache,
): Promise<Record<string, EpubLocationsCacheEntry>> {
  const entries = Object.entries(registry)
    .sort(([, left], [, right]) => right.savedAt - left.savedAt);

  if (entries.length <= EPUB_LOCATIONS_MAX_ENTRIES) {
    return registry;
  }

  const trimmed = { ...registry };
  const removals = entries.slice(EPUB_LOCATIONS_MAX_ENTRIES);

  await Promise.all(removals.map(async ([bookId, entry]) => {
    await cache.delete(entry.cacheKey);
    delete trimmed[bookId];
  }));

  return trimmed;
}

export async function readCachedEpubLocations(
  book: Book,
  charsPerBreak: number,
): Promise<string | null> {
  const cache = await openLocationsCache();
  if (!cache) {
    return null;
  }

  const registry = loadRegistry();
  const entry = registry[String(book.id)];
  if (!entry) {
    return null;
  }

  const expectedRevision = buildLocationsRevision(book, charsPerBreak);
  if (entry.revision !== expectedRevision) {
    await cache.delete(entry.cacheKey);
    delete registry[String(book.id)];
    saveRegistry(registry);
    return null;
  }

  const response = await cache.match(entry.cacheKey);
  if (!response) {
    delete registry[String(book.id)];
    saveRegistry(registry);
    return null;
  }

  try {
    return await response.text();
  } catch {
    await cache.delete(entry.cacheKey);
    delete registry[String(book.id)];
    saveRegistry(registry);
    return null;
  }
}

export async function writeCachedEpubLocations(
  book: Book,
  charsPerBreak: number,
  locationsJson: string,
): Promise<void> {
  const cache = await openLocationsCache();
  if (!cache || !locationsJson) {
    return;
  }

  const revision = buildLocationsRevision(book, charsPerBreak);
  const cacheKey = buildLocationsCacheKey(book.id, revision);
  const registry = loadRegistry();
  const previousEntry = registry[String(book.id)];

  if (previousEntry && previousEntry.cacheKey !== cacheKey) {
    await cache.delete(previousEntry.cacheKey);
  }

  await cache.put(cacheKey, new Response(locationsJson, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  }));

  registry[String(book.id)] = {
    bookId: book.id,
    cacheKey,
    revision,
    savedAt: Date.now(),
    sizeBytes: locationsJson.length,
  };

  saveRegistry(await pruneLocationsRegistry(registry, cache));
}

export async function deleteCachedEpubLocations(bookId: number): Promise<void> {
  const cache = await openLocationsCache();
  if (!cache) {
    return;
  }

  const registry = loadRegistry();
  const entry = registry[String(bookId)];
  if (!entry) {
    return;
  }

  await cache.delete(entry.cacheKey);
  delete registry[String(bookId)];
  saveRegistry(registry);
}