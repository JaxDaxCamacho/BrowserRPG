/**
 * Makes the desktop app's icons from the d20 art: PNGs at the sizes Tauri asks
 * for, and a Windows .ico holding PNG images (which Windows Vista and later read).
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'public', 'dice', 'face-20.png');
const out = join(root, 'src-tauri', 'icons');
mkdirSync(out, { recursive: true });

const png = (size) => sharp(source).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

for (const [file, size] of [['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256], ['icon.png', 512]]) {
  writeFileSync(join(out, file), await png(size));
}

// ICO: a 6-byte header, a 16-byte entry per image, then the PNG data.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((data, i) => {
  const e = Buffer.alloc(16);
  const size = sizes[i];
  e.writeUInt8(size >= 256 ? 0 : size, 0);
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt8(0, 2);
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...images]));
console.log(`Icons written to ${out}`);
