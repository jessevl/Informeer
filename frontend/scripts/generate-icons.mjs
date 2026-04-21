#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
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
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="${size}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fbfbfb"/>
          <stop offset="1" stop-color="#ebeceb"/>
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

  if (noBackdropBuffer) {
    for (const size of variantSizes) {
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

    const iconBuffer = await sharp(sourceBuffer)
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

  await generateAndroidIcons(sourceBuffer, noBackdropBuffer, outlineBuffer);

  console.log('Done! All icons generated.');
}

// ─── Android mipmap icon generation ──────────────────────────────────────────

const androidResDir = 'android/app/src/main/res';

// Standard launcher icon sizes (48dp at each density)
const androidMipmapConfigs = [
  { density: 'mdpi',    launcherPx: 48,  foregroundPx: 108 },
  { density: 'hdpi',    launcherPx: 72,  foregroundPx: 162 },
  { density: 'xhdpi',   launcherPx: 96,  foregroundPx: 216 },
  { density: 'xxhdpi',  launcherPx: 144, foregroundPx: 324 },
  { density: 'xxxhdpi', launcherPx: 192, foregroundPx: 432 },
];

async function generateAndroidIcons(sourceBuffer, noBackdropBuffer, outlineBuffer) {
  for (const { density, launcherPx, foregroundPx } of androidMipmapConfigs) {
    const dir = join(androidResDir, `mipmap-${density}`);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // ic_launcher.png — full icon with background (for legacy Android < 26, squircle/square clip).
    // Scale to 72 % and add padding so the logo isn't clipped by the rounded-square mask.
    const launcherOut = join(dir, 'ic_launcher.png');
    console.log(`Android: ${launcherOut} (${launcherPx}\u00d7${launcherPx})`);
    const legacyInner = Math.round(launcherPx * 0.72);
    const legacyPad   = Math.round((launcherPx - legacyInner) / 2);
    const legacyInnerBuf = await sharp(sourceBuffer).resize(legacyInner, legacyInner).png().toBuffer();
    await sharp({
      create: { width: launcherPx, height: launcherPx, channels: 4, background: { r: 253, g: 246, b: 244, alpha: 1 } },
    })
      .composite([{ input: legacyInnerBuf, left: legacyPad, top: legacyPad }])
      .png()
      .toFile(launcherOut);

    // ic_launcher_round.png — used when the launcher clips to a circle.
    // The icon content must fit within the inscribed circle, so we scale the
    // no-backdrop icon to 70% and center it on a solid warm-white background
    // that bleeds to the circle edge cleanly.
    const roundOut = join(dir, 'ic_launcher_round.png');
    console.log(`Android: ${roundOut} (${launcherPx}×${launcherPx}, circle-safe)`);
    const roundIconBuf = noBackdropBuffer ?? sourceBuffer;
    const roundInner = Math.round(launcherPx * 0.70);
    const roundPad   = Math.round((launcherPx - roundInner) / 2);
    const roundInnerBuf = await sharp(roundIconBuf).resize(roundInner, roundInner).png().toBuffer();
    await sharp({
      create: { width: launcherPx, height: launcherPx, channels: 4, background: { r: 253, g: 246, b: 244, alpha: 1 } },
    })
      .composite([{ input: roundInnerBuf, left: roundPad, top: roundPad }])
      .png()
      .toFile(roundOut);

    // ic_launcher_foreground.png — no-backdrop icon centered in 108dp canvas (for adaptive icons API 26+)
    if (noBackdropBuffer) {
      const foregroundOut = join(dir, 'ic_launcher_foreground.png');
      console.log(`Android: ${foregroundOut} (${foregroundPx}×${foregroundPx})`);
      // Scale icon to ~60% of foreground canvas to keep it well within the adaptive-icon
      // safe zone (the central 61% of the 108dp canvas guaranteed not to be clipped).
      // 80% was previously used, which extended outside the safe zone causing logo cutoff.
      const iconPx = Math.round(foregroundPx * 0.60);
      const padding = Math.round((foregroundPx - iconPx) / 2);
      const iconBuf = await sharp(noBackdropBuffer).resize(iconPx, iconPx).png().toBuffer();
      await sharp({
        create: { width: foregroundPx, height: foregroundPx, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: iconBuf, left: padding, top: padding }])
        .png()
        .toFile(foregroundOut);
    }

    // ic_launcher_eink.png — outline icon (for eink alias, squircle/square clip)
    if (outlineBuffer) {
      const einkOut = join(dir, 'ic_launcher_eink.png');
      console.log(`Android: ${einkOut} (${launcherPx}×${launcherPx})`);
      await sharp(outlineBuffer).resize(launcherPx, launcherPx).png().toFile(einkOut);

      // ic_launcher_eink_round.png — outline icon scaled to 70% on white, circle-safe
      const einkRoundOut = join(dir, 'ic_launcher_eink_round.png');
      console.log(`Android: ${einkRoundOut} (${launcherPx}×${launcherPx}, circle-safe)`);
      const einkRoundInner = Math.round(launcherPx * 0.70);
      const einkRoundPad   = Math.round((launcherPx - einkRoundInner) / 2);
      const einkRoundInnerBuf = await sharp(outlineBuffer).resize(einkRoundInner, einkRoundInner).png().toBuffer();
      await sharp({
        create: { width: launcherPx, height: launcherPx, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      })
        .composite([{ input: einkRoundInnerBuf, left: einkRoundPad, top: einkRoundPad }])
        .png()
        .toFile(einkRoundOut);

      // ic_launcher_eink_foreground.png — outline icon centered in foreground canvas
      const einkForegroundOut = join(dir, 'ic_launcher_eink_foreground.png');
      console.log(`Android: ${einkForegroundOut} (${foregroundPx}×${foregroundPx})`);
      const iconPx = Math.round(foregroundPx * 0.60);
      const padding = Math.round((foregroundPx - iconPx) / 2);
      const einkIconBuf = await sharp(outlineBuffer).resize(iconPx, iconPx).png().toBuffer();
      await sharp({
        create: { width: foregroundPx, height: foregroundPx, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      })
        .composite([{ input: einkIconBuf, left: padding, top: padding }])
        .png()
        .toFile(einkForegroundOut);
    }
  }
}

generateIcons().catch(console.error);
