/** Format a Date to ISO 8601 string in UTC */
export function toISO(date: Date | string | number): string {
  return new Date(date).toISOString();
}

/** Get current time as ISO string */
export function now(): string {
  return new Date().toISOString();
}

/** Parse a date string, returning null if invalid */
export function parseDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}
