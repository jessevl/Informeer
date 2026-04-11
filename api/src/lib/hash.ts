import { createHash } from 'crypto';

/** Create a SHA-256 hash of content for entry deduplication */
export function contentHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
