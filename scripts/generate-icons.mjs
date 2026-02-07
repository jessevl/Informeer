#!/usr/bin/env node
/**
 * Generate PNG icons from SVG source using rsvg-convert.
 * Usage: node scripts/generate-icons.mjs
 * Requires: rsvg-convert (brew install librsvg)
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';

const iconsDir = 'public/icons';
const svgSource = `${iconsDir}/app-icon.svg`;
const svgSmall = `${iconsDir}/app-icon-small.svg`;

if (!existsSync(svgSource)) {
  console.error(`SVG source not found: ${svgSource}`);
  process.exit(1);
}

const hasSmall = existsSync(svgSmall);

// Small sizes use the simplified SVG (no background) for clarity
const smallSizes = [16, 32];
const largeSizes = [72, 96, 128, 144, 152, 167, 180, 192, 384, 512];

for (const size of smallSizes) {
  const src = hasSmall ? svgSmall : svgSource;
  const label = hasSmall ? ' (small variant)' : '';
  const output = `${iconsDir}/icon-${size}.png`;
  console.log(`Generating ${output} (${size}x${size})${label}...`);
  execSync(`rsvg-convert -w ${size} -h ${size} ${src} -o ${output}`);
}

for (const size of largeSizes) {
  const output = `${iconsDir}/icon-${size}.png`;
  console.log(`Generating ${output} (${size}x${size})...`);
  execSync(`rsvg-convert -w ${size} -h ${size} ${svgSource} -o ${output}`);
}

// Maskable icons (same icon, used for Android adaptive icons)
for (const size of [192, 512]) {
  const output = `${iconsDir}/icon-maskable-${size}.png`;
  console.log(`Generating ${output} (${size}x${size} maskable)...`);
  execSync(`rsvg-convert -w ${size} -h ${size} ${svgSource} -o ${output}`);
}

// Favicon from small variant for clarity
const faviconSrc = hasSmall ? svgSmall : svgSource;
execSync(`rsvg-convert -w 32 -h 32 ${faviconSrc} -o ${iconsDir}/favicon.png`);
console.log(`Generated favicon.png${hasSmall ? ' (small variant)' : ''}`);

console.log('Done! All icons generated.');
