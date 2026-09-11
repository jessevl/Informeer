#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import sharp from 'sharp';

const iconsDir = 'public/icons';
const svgSource = `${iconsDir}/app-icon.svg`;
const svgSmall = `${iconsDir}/app-icon-small.svg`;
const svgNoBackdrop = `${iconsDir}/app-icon-no-backdrop.svg`;
const svgOutline = `${iconsDir}/app-icon-outline.svg`;

if (!existsSync(svgSource)) {
  console.error(`SVG source not found: ${svgSource}`);
  process.exit(1);
}

const hasSmall = existsSync(svgSmall);
const hasNoBackdrop = existsSync(svgNoBackdrop);
const hasOutline = existsSync(svgOutline);

const smallSizes = [16, 32];
const largeSizes = [72, 96, 128, 144, 152, 167, 180, 192, 384, 512];
const variantSizes = [192, 512];

function createMaskableBackground(size) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="bg" x1="${size * 0.18}" y1="${size * 0.1}" x2="${size * 0.84}" y2="${size * 0.92}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#FF9F84"/>
          <stop offset="0.5" stop-color="#EF6B52"/>
          <stop offset="1" stop-color="#CE4835"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#bg)"/>
    </svg>
  `);
}

async function generateIcons() {
  const sourceBuffer = readFileSync(svgSource);
  const smallBuffer = readFileSync(hasSmall ? svgSmall : svgSource);
  const noBackdropBuffer = hasNoBackdrop ? readFileSync(svgNoBackdrop) : null;
  const outlineBuffer = hasOutline ? readFileSync(svgOutline) : null;

  for (const size of smallSizes) {
    const output = `${iconsDir}/icon-${size}.png`;
    console.log(`Generating ${output} (${size}x${size})${hasSmall ? ' (small variant)' : ''}...`);
    await sharp(smallBuffer)
      .resize(size, size)
      .png()
      .toFile(output);
  }

  for (const size of largeSizes) {
    const output = `${iconsDir}/icon-${size}.png`;
    console.log(`Generating ${output} (${size}x${size})...`);
    await sharp(sourceBuffer)
      .resize(size, size)
      .png()
      .toFile(output);
  }

  // Plateless artwork, generated at every manifest size. These are the
  // `purpose: "any"` icons: desktop Chrome/Edge use them for the Windows
  // taskbar and Start shortcut, where a baked-in container would sit awkwardly
  // inside the chrome's own framing. Android prefers the maskable set below.
  if (noBackdropBuffer) {
    for (const size of largeSizes) {
      const output = `${iconsDir}/icon-no-backdrop-${size}.png`;
      console.log(`Generating ${output} (${size}x${size})...`);
      await sharp(noBackdropBuffer)
        .resize(size, size)
        .png()
        .toFile(output);
    }
  }

  if (outlineBuffer) {
    for (const size of variantSizes) {
      const output = `${iconsDir}/icon-outline-${size}.png`;
      console.log(`Generating ${output} (${size}x${size})...`);
      await sharp(outlineBuffer)
        .resize(size, size)
        .png()
        .toFile(output);
    }
  }

  for (const size of [192, 512]) {
    const innerSize = Math.round(size * 0.8);
    const padding = Math.round(size * 0.1);
    const output = `${iconsDir}/icon-maskable-${size}.png`;
    console.log(`Generating ${output} (${size}x${size} maskable)...`);

    // Use the no-backdrop glyph here, not the squircle-backed source — otherwise
    // the icon's own rounded-square frame gets nested a second time inside
    // whatever mask the OS applies on top.
    const iconBuffer = await sharp(noBackdropBuffer ?? sourceBuffer)
      .resize(innerSize, innerSize)
      .png()
      .toBuffer();

    await sharp(createMaskableBackground(size))
      .composite([{ input: iconBuffer, left: padding, top: padding }])
      .png()
      .toFile(output);
  }

  await sharp(smallBuffer)
    .resize(32, 32)
    .png()
    .toFile(`${iconsDir}/favicon.png`);

  console.log(`Generated favicon.png${hasSmall ? ' (small variant)' : ''}`);

  console.log('Done! All icons generated.');
}

generateIcons().catch(console.error);
