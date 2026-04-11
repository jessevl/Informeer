/**
 * Offline Blob Cache
 *
 * Uses the Cache API to store binary content (EPUBs, PDFs, audio) for offline use.
 * A lightweight registry in localStorage tracks what's saved and metadata.
 */

export interface OfflineItem {
  type: 'book' | 'magazine' | 'podcast' | 'article';
  id: string;
  title: string;
  cacheKey: string;
  retention?: 'manual' | 'recent';
  savedAt: number;
  sizeBytes: number;
  coverUrl?: string;
  author?: string;
  feedTitle?: string;
}

type OfflineRetention = NonNullable<OfflineItem['retention']>;

interface SaveBlobOptions {
  retention?: OfflineRetention;
  contentType?: string;
  maxRecentItems?: number;
}

const CACHE_NAME = 'informeer-offline';
const REGISTRY_KEY = 'informeer-offline-items';

// ── Registry helpers ──

export function getOfflineRegistry(): OfflineItem[] {
  try {
    return JSON.parse(localStorage.getItem(REGISTRY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveRegistry(items: OfflineItem[]) {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(items));
  // Notify reactive store subscribers
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('offline-registry-changed'));
  }
}

function getRetention(item: OfflineItem | undefined): OfflineRetention {
  return item?.retention ?? 'manual';
}

function toBlob(data: Blob | ArrayBuffer | Uint8Array, contentType?: string): Blob {
  if (data instanceof Blob) {
    if (!contentType || data.type === contentType) return data;
    return new Blob([data], { type: contentType });
  }

  if (data instanceof Uint8Array) {
    return new Blob([data], { type: contentType });
  }

  return new Blob([data], { type: contentType });
}

async function pruneRecentOfflineItemsInternal(
  type: OfflineItem['type'],
  maxRecentItems: number,
): Promise<void> {
  const limit = Math.max(0, maxRecentItems);
  const cache = await caches.open(CACHE_NAME);
  const registry = getOfflineRegistry();
  const recentItems = registry
    .filter((item) => item.type === type && getRetention(item) === 'recent')
    .sort((left, right) => right.savedAt - left.savedAt);

  const itemsToRemove = recentItems.slice(limit);
  if (itemsToRemove.length === 0) return;

  await Promise.all(itemsToRemove.map((item) => cache.delete(item.cacheKey)));
  saveRegistry(registry.filter((item) => !itemsToRemove.some((candidate) => candidate.cacheKey === item.cacheKey)));
}

async function upsertOfflineBlob(
  item: Omit<OfflineItem, 'savedAt' | 'sizeBytes' | 'retention'>,
  data: Blob | ArrayBuffer | Uint8Array,
  { retention = 'manual', contentType, maxRecentItems }: SaveBlobOptions = {},
): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  const blob = toBlob(data, contentType);
  await cache.put(
    item.cacheKey,
    new Response(blob, contentType ? { headers: { 'Content-Type': contentType } } : undefined),
  );

  const registry = getOfflineRegistry();
  const existing = registry.find((entry) => entry.cacheKey === item.cacheKey);
  const nextRetention = getRetention(existing) === 'manual' ? 'manual' : retention;

  saveRegistry([
    ...registry.filter((entry) => entry.cacheKey !== item.cacheKey),
    {
      ...item,
      retention: nextRetention,
      savedAt: Date.now(),
      sizeBytes: blob.size,
    },
  ]);

  if (nextRetention === 'recent') {
    await pruneRecentOfflineItemsInternal(item.type, maxRecentItems ?? 0);
  }
}

// ── Save functions ──

export async function saveBookOffline(
  bookId: number,
  title: string,
  url: string,
  authHeader: string,
  coverUrl?: string,
  author?: string,
): Promise<void> {
  const resp = await fetch(url, { headers: { Authorization: authHeader } });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

  await saveBookOfflineData(bookId, title, await resp.blob(), coverUrl, author);
}

export async function saveBookOfflineData(
  bookId: number,
  title: string,
  data: Blob | ArrayBuffer | Uint8Array,
  coverUrl?: string,
  author?: string,
  options?: SaveBlobOptions,
): Promise<void> {
  await upsertOfflineBlob(
    {
      type: 'book',
      id: String(bookId),
      title,
      cacheKey: `/offline/books/${bookId}`,
      coverUrl,
      author,
    },
    data,
    options,
  );
}

export async function saveMagazineOffline(
  entryId: string,
  title: string,
  url: string,
  authHeader: string,
  coverUrl?: string,
  feedTitle?: string,
): Promise<void> {
  const resp = await fetch(url, { headers: { Authorization: authHeader } });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

  await saveMagazineOfflineData(entryId, title, await resp.blob(), coverUrl, feedTitle);
}

export async function saveMagazineOfflineData(
  entryId: string,
  title: string,
  data: Blob | ArrayBuffer | Uint8Array,
  coverUrl?: string,
  feedTitle?: string,
  options?: SaveBlobOptions,
): Promise<void> {
  await upsertOfflineBlob(
    {
      type: 'magazine',
      id: entryId,
      title,
      cacheKey: `/offline/magazines/${entryId}`,
      coverUrl,
      feedTitle,
    },
    data,
    { ...options, contentType: 'application/pdf' },
  );
}

export async function savePodcastOffline(
  enclosureId: number,
  title: string,
  url: string,
  _authHeader?: string,
  feedTitle?: string,
  coverUrl?: string,
): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  // Podcast URLs are external/public — do NOT send Authorization header
  // (causes CORS preflight failures on third-party podcast hosts)
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

  const blob = await resp.blob();
  const key = `/offline/podcasts/${enclosureId}`;
  await cache.put(
    key,
    new Response(blob, {
      headers: { 'Content-Type': resp.headers.get('Content-Type') || 'audio/mpeg' },
    }),
  );

  const registry = getOfflineRegistry().filter(i => i.cacheKey !== key);
  registry.push({
    type: 'podcast',
    id: String(enclosureId),
    title,
    cacheKey: key,
    savedAt: Date.now(),
    sizeBytes: blob.size,
    feedTitle,
    coverUrl,
  });
  saveRegistry(registry);
}

// ── Retrieve ──

export async function getCachedBlob(cacheKey: string): Promise<Response | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(cacheKey)) ?? null;
  } catch {
    return null;
  }
}

export function isAvailableOffline(type: OfflineItem['type'], id: string): boolean {
  return getOfflineRegistry().some(i => i.type === type && i.id === id);
}

export function getOfflineItem(type: OfflineItem['type'], id: string): OfflineItem | null {
  return getOfflineRegistry().find((item) => item.type === type && item.id === id) ?? null;
}

export async function setOfflineItemRetention(
  cacheKey: string,
  retention: OfflineRetention,
): Promise<void> {
  const registry = getOfflineRegistry();
  const existing = registry.find((item) => item.cacheKey === cacheKey);
  if (!existing) return;

  saveRegistry(
    registry.map((item) => item.cacheKey === cacheKey ? { ...item, retention, savedAt: Date.now() } : item),
  );
}

export async function pruneRecentOfflineItems(
  type: OfflineItem['type'],
  maxRecentItems: number,
): Promise<void> {
  try {
    await pruneRecentOfflineItemsInternal(type, maxRecentItems);
  } catch {
    // ignore cache errors; registry updates are best-effort here
  }
}

// ── Remove ──

export async function removeOfflineItem(cacheKey: string): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(cacheKey);
  } catch {
    // Cache API not available — still clean the registry
  }

  const registry = getOfflineRegistry().filter(i => i.cacheKey !== cacheKey);
  saveRegistry(registry);
}

// ── Stats ──

export interface OfflineStats {
  count: number;
  totalBytes: number;
  byType: Record<string, { count: number; bytes: number }>;
}

export function getOfflineStats(): OfflineStats {
  const items = getOfflineRegistry();
  const byType: Record<string, { count: number; bytes: number }> = {};

  for (const item of items) {
    if (!byType[item.type]) byType[item.type] = { count: 0, bytes: 0 };
    byType[item.type].count++;
    byType[item.type].bytes += item.sizeBytes;
  }

  return {
    count: items.length,
    totalBytes: items.reduce((sum, i) => sum + i.sizeBytes, 0),
    byType,
  };
}

export async function clearAllOffline(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // not critical
  }
  saveRegistry([]);
}
