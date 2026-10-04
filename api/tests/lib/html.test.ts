import { describe, test, expect } from 'bun:test';
import { sanitizeHtml, resolveRelativeUrls, extractFirstImage, resolveLazyImages, hasFullArticleText } from '../../src/lib/html.ts';

describe('sanitizeHtml', () => {
  test('removes script tags', () => {
    const input = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    expect(sanitizeHtml(input)).toBe('<p>Hello</p><p>World</p>');
  });

  test('removes nested script tags', () => {
    const input = '<script type="text/javascript">var x = "<script>";</script>';
    expect(sanitizeHtml(input)).toBe('');
  });

  test('removes event handler attributes', () => {
    const input = '<img src="x.jpg" onerror="alert(1)" />';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('onerror');
    expect(result).toContain('src="x.jpg"');
  });

  test('removes onclick', () => {
    const input = '<a href="#" onclick="steal()">Click</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('onclick');
    expect(result).toContain('href="#"');
  });

  test('preserves safe HTML', () => {
    const input = '<p class="text">Hello <strong>world</strong></p>';
    expect(sanitizeHtml(input)).toBe(input);
  });
});

describe('resolveRelativeUrls', () => {
  const base = 'https://example.com/blog/post';

  test('resolves relative src attributes', () => {
    const input = '<img src="/images/photo.jpg" />';
    const result = resolveRelativeUrls(input, base);
    expect(result).toContain('src="https://example.com/images/photo.jpg"');
  });

  test('resolves relative href attributes', () => {
    const input = '<a href="../about">About</a>';
    const result = resolveRelativeUrls(input, base);
    expect(result).toContain('href="https://example.com/about"');
  });

  test('leaves absolute URLs unchanged', () => {
    const input = '<a href="https://other.com/page">Link</a>';
    const result = resolveRelativeUrls(input, base);
    expect(result).toBe(input);
  });

  test('leaves data URIs unchanged', () => {
    const input = '<img src="data:image/png;base64,abc" />';
    const result = resolveRelativeUrls(input, base);
    expect(result).toBe(input);
  });

  test('leaves mailto links unchanged', () => {
    const input = '<a href="mailto:user@example.com">Email</a>';
    const result = resolveRelativeUrls(input, base);
    expect(result).toBe(input);
  });

  test('handles empty base URL gracefully', () => {
    const input = '<img src="/test.jpg" />';
    expect(resolveRelativeUrls(input, '')).toBe(input);
  });

  test('handles invalid base URL gracefully', () => {
    const input = '<img src="/test.jpg" />';
    expect(resolveRelativeUrls(input, 'not-a-url')).toBe(input);
  });
});

describe('extractFirstImage', () => {
  test('extracts src from first img tag', () => {
    const html = '<p>Text</p><img src="https://example.com/photo.jpg" /><img src="https://example.com/second.jpg" />';
    expect(extractFirstImage(html)).toBe('https://example.com/photo.jpg');
  });

  test('prefers data-src over placeholder src', () => {
    const html = '<img src="data:image/gif;base64,..." data-src="https://example.com/lazy.jpg" />';
    expect(extractFirstImage(html)).toBe('https://example.com/lazy.jpg');
  });

  test('skips tracking pixels (1x1)', () => {
    const html = '<img src="https://track.com/pixel.gif" width="1" height="1" /><img src="https://example.com/real.jpg" />';
    expect(extractFirstImage(html)).toBe('https://example.com/real.jpg');
  });

  test('skips data: URIs', () => {
    const html = '<img src="data:image/png;base64,abc" /><img src="https://example.com/real.jpg" />';
    expect(extractFirstImage(html)).toBe('https://example.com/real.jpg');
  });

  test('resolves relative URLs when baseUrl provided', () => {
    const html = '<img src="/images/photo.jpg" />';
    expect(extractFirstImage(html, 'https://example.com')).toBe('https://example.com/images/photo.jpg');
  });

  test('returns empty string for no images', () => {
    expect(extractFirstImage('<p>No images here</p>')).toBe('');
  });

  test('returns empty string for empty input', () => {
    expect(extractFirstImage('')).toBe('');
  });
});

describe('resolveLazyImages', () => {
  test('replaces placeholder src with data-src', () => {
    const html = '<img src="data:image/gif;base64,R0lGOD..." data-src="https://example.com/real.jpg" />';
    const result = resolveLazyImages(html);
    expect(result).toContain('src="https://example.com/real.jpg"');
  });

  test('replaces placeholder src with data-original', () => {
    const html = '<img src="data:image/gif;base64,..." data-original="https://example.com/photo.jpg" />';
    const result = resolveLazyImages(html);
    expect(result).toContain('src="https://example.com/photo.jpg"');
  });

  test('does not replace real src', () => {
    const html = '<img src="https://example.com/real.jpg" data-src="https://example.com/other.jpg" />';
    const result = resolveLazyImages(html);
    expect(result).toContain('src="https://example.com/real.jpg"');
  });

  test('handles img with empty src', () => {
    const html = '<img src="" data-src="https://example.com/lazy.jpg" />';
    const result = resolveLazyImages(html);
    expect(result).toContain('src="https://example.com/lazy.jpg"');
  });
});

// Feed bodies are publisher-supplied HTML that the reader renders directly,
// so script-bearing URLs must not survive sanitizing.
describe('sanitizeHtml script URLs', () => {
  test('neutralizes javascript: hrefs', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a href="#">x</a>');
  });

  test('neutralizes padded and mixed-case javascript: hrefs', () => {
    expect(sanitizeHtml('<a href=" JavaScript : alert(1)">x</a>')).toBe('<a href="#">x</a>');
  });

  test('neutralizes vbscript: hrefs, preserving the quote style', () => {
    expect(sanitizeHtml("<a href='vbscript:msgbox'>x</a>")).toBe("<a href='#'>x</a>");
  });

  test('neutralizes data: documents', () => {
    expect(sanitizeHtml('<a href="data:text/html;base64,PHN2Zz4=">x</a>')).toBe('<a href="#">x</a>');
  });

  test('neutralizes xlink:href on SVG', () => {
    expect(sanitizeHtml('<use xlink:href="javascript:alert(1)"/>')).toBe('<use xlink:href="#"/>');
  });

  test('keeps data:image/ sources', () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=">';
    expect(sanitizeHtml(html)).toBe(html);
  });

  test('keeps ordinary and relative URLs untouched', () => {
    const html = '<a href="https://example.com/a?b=1&c=2">x</a><img src="/img/photo.jpg">';
    expect(sanitizeHtml(html)).toBe(html);
  });
});

describe('hasFullArticleText', () => {
  test('is false for empty or missing content', () => {
    expect(hasFullArticleText('')).toBe(false);
    expect(hasFullArticleText(null)).toBe(false);
    expect(hasFullArticleText(undefined)).toBe(false);
  });

  test('is false for a feed teaser', () => {
    expect(hasFullArticleText('<p>A one-line teaser about the article.</p>')).toBe(false);
  });

  test('is false for markup with no text', () => {
    expect(hasFullArticleText('<div>'.repeat(500))).toBe(false);
  });

  test('is true for a full article body', () => {
    expect(hasFullArticleText(`<p>${'word '.repeat(600)}</p>`)).toBe(true);
  });
});
