import literataNormal from '@fontsource-variable/literata/files/literata-latin-ext-wght-normal.woff2';
import literataItalic from '@fontsource-variable/literata/files/literata-latin-ext-wght-italic.woff2';
import ebGaramondNormal from '@fontsource/eb-garamond/files/eb-garamond-latin-ext-400-normal.woff2';
import ebGaramondItalic from '@fontsource/eb-garamond/files/eb-garamond-latin-ext-400-italic.woff2';
import robotoNormal from '@fontsource/roboto/files/roboto-latin-ext-400-normal.woff2';
import robotoItalic from '@fontsource/roboto/files/roboto-latin-ext-400-italic.woff2';
import openSansNormal from '@fontsource/open-sans/files/open-sans-latin-ext-400-normal.woff2';
import openSansItalic from '@fontsource/open-sans/files/open-sans-latin-ext-400-italic.woff2';

export const EPUB_FONT_FAMILY = {
  bookerlyFallback: 'Informeer Bookerly Fallback',
  literata: 'Informeer Literata',
  ebGaramond: 'Informeer EB Garamond',
  roboto: 'Informeer Roboto',
  openSans: 'Informeer Open Sans',
} as const;

export const EPUB_FONT_OPTIONS = [
  { value: 'original', label: 'Original (EPUB)' },
  { value: 'bookerly', label: 'Bookerly' },
  { value: 'literata', label: 'Literata' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'verdana', label: 'Verdana' },
  { value: 'eb-garamond', label: 'EB Garamond' },
  { value: 'roboto', label: 'Roboto' },
  { value: 'open-sans', label: 'Open Sans' },
] as const;

export function normalizeEpubFontValue(fontValue: string): string {
  switch (fontValue) {
    case 'original':
    case 'bookerly':
    case 'literata':
    case 'georgia':
    case 'verdana':
    case 'eb-garamond':
    case 'roboto':
    case 'open-sans':
      return fontValue;
    case 'system':
      return 'bookerly';
    case 'source-serif-4':
      return 'eb-garamond';
    case 'atkinson-hyperlegible':
      return 'open-sans';
    default:
      return 'bookerly';
  }
}

export function getEpubFontStack(fontValue: string): string {
  switch (fontValue) {
    case 'system':
      return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    case 'bookerly':
      return `"Bookerly", "${EPUB_FONT_FAMILY.bookerlyFallback}", "${EPUB_FONT_FAMILY.literata}", Georgia, serif`;
    case 'literata':
      return `"${EPUB_FONT_FAMILY.literata}", Georgia, serif`;
    case 'georgia':
      return 'Georgia, serif';
    case 'verdana':
      return 'Verdana, Geneva, sans-serif';
    case 'eb-garamond':
      return `"${EPUB_FONT_FAMILY.ebGaramond}", Georgia, serif`;
    case 'roboto':
      return `"${EPUB_FONT_FAMILY.roboto}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    case 'open-sans':
      return `"${EPUB_FONT_FAMILY.openSans}", "Helvetica Neue", Arial, sans-serif`;
    default:
      return fontValue;
  }
}

export const EPUB_FONT_FACE_CSS = `
@font-face {
  font-family: '${EPUB_FONT_FAMILY.bookerlyFallback}';
  src: url('${literataNormal}') format('woff2');
  font-style: normal;
  font-weight: 200 900;
  font-display: swap;
}

@font-face {
  font-family: '${EPUB_FONT_FAMILY.bookerlyFallback}';
  src: url('${literataItalic}') format('woff2');
  font-style: italic;
  font-weight: 200 900;
  font-display: swap;
}

@font-face {
  font-family: '${EPUB_FONT_FAMILY.literata}';
  src: url('${literataNormal}') format('woff2');
  font-style: normal;
  font-weight: 200 900;
  font-display: swap;
}

@font-face {
  font-family: '${EPUB_FONT_FAMILY.literata}';
  src: url('${literataItalic}') format('woff2');
  font-style: italic;
  font-weight: 200 900;
  font-display: swap;
}

@font-face {
  font-family: '${EPUB_FONT_FAMILY.ebGaramond}';
  src: url('${ebGaramondNormal}') format('woff2');
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: '${EPUB_FONT_FAMILY.ebGaramond}';
  src: url('${ebGaramondItalic}') format('woff2');
  font-style: italic;
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: '${EPUB_FONT_FAMILY.roboto}';
  src: url('${robotoNormal}') format('woff2');
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: '${EPUB_FONT_FAMILY.roboto}';
  src: url('${robotoItalic}') format('woff2');
  font-style: italic;
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: '${EPUB_FONT_FAMILY.openSans}';
  src: url('${openSansNormal}') format('woff2');
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: '${EPUB_FONT_FAMILY.openSans}';
  src: url('${openSansItalic}') format('woff2');
  font-style: italic;
  font-weight: 400;
  font-display: swap;
}
`;