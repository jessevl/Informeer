import { EPUB_FONT_OPTIONS, getEpubFontStack, normalizeEpubFontValue } from '@/lib/epub-fonts';

export interface TypographySettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  maxWidth: number;
  columnCount: 1 | 2;
  readingMode: 'scroll' | 'paginated';
  margin: number;
  verticalMargin: number;
  paragraphSpacing: number;
  textAlign: string;
  hyphenation: boolean;
  preset: 'custom' | 'original';
}

export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  fontFamily: 'bookerly',
  fontSize: 100,
  lineHeight: 1.7,
  maxWidth: 768,
  columnCount: 1,
  readingMode: 'scroll',
  margin: 40,
  verticalMargin: 20,
  paragraphSpacing: 1,
  textAlign: 'left',
  hyphenation: false,
  preset: 'custom',
};

export const DEFAULT_ARTICLE_TYPOGRAPHY: TypographySettings = {
  fontFamily: 'bookerly',
  fontSize: 100,
  lineHeight: 1.7,
  maxWidth: 768,
  columnCount: 2,
  readingMode: 'scroll',
  margin: 0,
  verticalMargin: 0,
  paragraphSpacing: 1,
  textAlign: 'left',
  hyphenation: false,
  preset: 'custom',
};

export const ARTICLE_FONT_OPTIONS = EPUB_FONT_OPTIONS.map((option) => (
  option.value === 'original'
    ? { ...option, label: 'Default (Article)' }
    : option
));

export function normalizeTypographySettings(
  settings?: Partial<TypographySettings>,
): TypographySettings {
  return normalizeTypographySettingsWithDefaults(DEFAULT_TYPOGRAPHY, settings);
}

export function normalizeTypographySettingsWithDefaults(
  defaults: TypographySettings,
  settings?: Partial<TypographySettings>,
): TypographySettings {
  const nextSettings = {
    ...defaults,
    ...settings,
  };

  const readingMode = nextSettings.readingMode === 'paginated' ? 'paginated' : 'scroll';
  const columnCount = readingMode === 'paginated' && nextSettings.columnCount === 2 ? 2 : 1;

  return {
    ...nextSettings,
    fontFamily: normalizeEpubFontValue(nextSettings.fontFamily),
    maxWidth: Math.min(1440, Math.max(480, nextSettings.maxWidth)),
    columnCount,
    readingMode,
    textAlign: nextSettings.textAlign === 'justify' || nextSettings.textAlign === 'original'
      ? nextSettings.textAlign
      : 'left',
    preset: nextSettings.preset === 'original' ? 'original' : 'custom',
  };
}

export function normalizeArticleTypographySettings(
  settings?: Partial<TypographySettings>,
): TypographySettings {
  return {
    ...normalizeTypographySettingsWithDefaults(DEFAULT_ARTICLE_TYPOGRAPHY, settings),
    margin: 0,
    verticalMargin: 0,
  };
}

export function isOriginalTypography(settings: TypographySettings): boolean {
  return settings.preset === 'original';
}

export function getTypographyFontFamily(fontFamily: string): string | undefined {
  const normalizedFont = normalizeEpubFontValue(fontFamily);
  return normalizedFont === 'original' ? undefined : getEpubFontStack(normalizedFont);
}