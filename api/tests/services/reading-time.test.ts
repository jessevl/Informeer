import { describe, test, expect } from 'bun:test';
import { estimateReadingTime } from '../../src/services/reading-time.ts';

describe('estimateReadingTime', () => {
  test('returns 1 minute for very short content', () => {
    expect(estimateReadingTime('<p>Hello world</p>')).toBe(1);
  });

  test('estimates correctly for ~265 words', () => {
    const words = Array(265).fill('word').join(' ');
    const html = `<p>${words}</p>`;
    expect(estimateReadingTime(html)).toBe(1);
  });

  test('estimates correctly for ~530 words', () => {
    const words = Array(530).fill('word').join(' ');
    const html = `<p>${words}</p>`;
    expect(estimateReadingTime(html)).toBe(2);
  });

  test('strips HTML tags before counting', () => {
    const html = '<div><p><strong>One</strong> <em>two</em> <a href="#">three</a></p></div>';
    expect(estimateReadingTime(html)).toBe(1); // Only 3 words
  });

  test('handles empty content', () => {
    expect(estimateReadingTime('')).toBe(1); // min 1
  });

  test('handles content with many tags and few words', () => {
    const html = '<div><span></span><br/><hr/></div>';
    expect(estimateReadingTime(html)).toBe(1);
  });

  test('respects custom WPM', () => {
    const words = Array(200).fill('test').join(' ');
    const html = `<p>${words}</p>`;
    // 200 words at 100 WPM = 2 minutes
    expect(estimateReadingTime(html, 100)).toBe(2);
  });
});
