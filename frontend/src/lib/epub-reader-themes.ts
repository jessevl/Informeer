/**
 * EPUB reader color schemes.
 *
 * The reader keeps one scheme per app mode (light / dark) so it still follows
 * the app theme automatically; the typography panel picks the scheme for the
 * mode that is currently active. E-Ink mode always forces the eink schemes.
 */

export type EpubReaderTheme =
  | 'light'
  | 'paper'
  | 'sepia'
  | 'sage'
  | 'dusk'
  | 'slate'
  | 'dark'
  | 'black'
  | 'eink'
  | 'eink-dark';

export interface EpubReaderThemeColors {
  label: string;
  /** Page background */
  bg: string;
  /** Body text */
  fg: string;
  link: string;
  isDark: boolean;
}

export const EPUB_READER_THEMES: Record<EpubReaderTheme, EpubReaderThemeColors> = {
  light: { label: 'White', bg: '#ffffff', fg: '#1a1a1a', link: '#2563eb', isDark: false },
  paper: { label: 'Paper', bg: '#faf6ee', fg: '#2b2620', link: '#9a5b1e', isDark: false },
  sepia: { label: 'Sepia', bg: '#f4ecd8', fg: '#5b4636', link: '#8b5e34', isDark: false },
  sage: { label: 'Sage', bg: '#e6eee0', fg: '#28331f', link: '#3f6b2f', isDark: false },
  dusk: { label: 'Dusk', bg: '#2a241f', fg: '#dccbb5', link: '#e0a86b', isDark: true },
  slate: { label: 'Slate', bg: '#22272e', fg: '#d3dae3', link: '#79b8ff', isDark: true },
  dark: { label: 'Dark', bg: '#1a1a1a', fg: '#e8e8e8', link: '#60a5fa', isDark: true },
  black: { label: 'Black', bg: '#000000', fg: '#c9c9c9', link: '#7cb3ff', isDark: true },
  eink: { label: 'E-Ink', bg: '#ffffff', fg: '#000000', link: '#000000', isDark: false },
  'eink-dark': { label: 'E-Ink Dark', bg: '#000000', fg: '#ffffff', link: '#ffffff', isDark: true },
};

/** Schemes offered in the picker (E-Ink ones are applied by E-Ink mode). */
export const EPUB_READER_THEME_CHOICES: EpubReaderTheme[] = [
  'light', 'paper', 'sepia', 'sage', 'dusk', 'slate', 'dark', 'black',
];

export function getEpubReaderTheme(theme: string | null | undefined): EpubReaderThemeColors {
  return EPUB_READER_THEMES[theme as EpubReaderTheme] ?? EPUB_READER_THEMES.light;
}
