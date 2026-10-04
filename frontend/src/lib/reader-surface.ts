/**
 * Reader page colours for DOM-rendered readers.
 *
 * The EPUB reader paints its scheme straight into the epubjs iframe, where it
 * controls the whole document. The article reader instead renders inside the
 * app's own markup, so it adopts a scheme by remapping the semantic colour
 * tokens on its root element — every prose rule, glass toolbar and divider
 * already reads those tokens, so nothing else has to know a scheme exists.
 *
 * Only `bg`, `fg` and `link` are authored per scheme (see `epub-reader-themes`).
 * The in-between tones are mixed from that pair, so adding a scheme there needs
 * no change here.
 */

import type { CSSProperties } from 'react';
import { getEpubReaderTheme } from './epub-reader-themes';
import type { EpubReaderTheme } from './epub-reader-themes';

export function getReaderSurfaceVars(theme: EpubReaderTheme): CSSProperties {
  const { bg, fg, link, isDark } = getEpubReaderTheme(theme);

  /** Blend `percent` of the ink into the paper. */
  const ink = (percent: number) => `color-mix(in srgb, ${fg} ${percent}%, ${bg})`;

  const vars: Record<string, string> = {
    backgroundColor: bg,
    // `body` sets `color: var(--color-text-primary)`, which resolves at body —
    // inheritance then passes that *resolved* colour down, so redefining the
    // token here is not enough on its own. The prose has no colour of its own,
    // so set `color` directly and let it inherit the scheme's ink.
    color: fg,
    // Keeps native controls (scrollbars, the panel's range inputs) in step.
    colorScheme: isDark ? 'dark' : 'light',

    '--color-surface-app': bg,
    '--color-surface-base': bg,
    '--color-surface-primary': bg,
    '--color-surface-secondary': ink(5),
    '--color-surface-tertiary': ink(7),
    '--color-surface-inset': ink(8),
    '--color-surface-hover': ink(10),
    '--color-surface-active': ink(14),
    '--color-surface-glass': bg,
    // The paper gradient is tuned for the app's warm off-white and muddies
    // every other scheme, so flatten it.
    '--color-panel-gradient': 'none',

    '--color-text-primary': fg,
    '--color-text-secondary': ink(78),
    '--color-text-tertiary': ink(58),
    '--color-text-disabled': ink(38),
    '--color-text-link': link,
    '--color-text-link-hover': link,

    '--color-border-default': ink(18),
    '--color-border-secondary': ink(12),
    '--color-border-subtle': ink(10),
    '--color-border-emphasis': ink(28),

    '--color-accent-primary': link,
    '--color-accent-fg': link,
    '--color-accent-emphasis': link,
    '--color-accent-muted': ink(10),
    '--color-accent-subtle': ink(6),
  };

  return vars as CSSProperties;
}

/**
 * Resolve the scheme to use from the two stored preferences.
 *
 * E-Ink mode forces the pure black/white schemes: the mid-tones in the other
 * schemes ghost badly on electrophoretic displays.
 */
export function resolveReaderTheme({
  einkMode,
  appIsDark,
  lightTheme,
  darkTheme,
}: {
  einkMode: boolean;
  appIsDark: boolean;
  lightTheme: EpubReaderTheme;
  darkTheme: EpubReaderTheme;
}): EpubReaderTheme {
  if (einkMode) return appIsDark ? 'eink-dark' : 'eink';
  return appIsDark ? darkTheme : lightTheme;
}
