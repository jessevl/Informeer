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

if (!existsSync(svgSource)) {
  console.error(`SVG source not found: ${svgSource}`);
  process.exit(1);
}

const sizes = [16, 32, 72, 96, 128, 144, 152, 167, 180, 192, 384, 512];

for (const size of sizes) {
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

// Also copy favicon.png from the 32px version
execSync(`cp ${iconsDir}/icon-32.png ${iconsDir}/favicon.png`);

console.log('Done! All icons generated.');
