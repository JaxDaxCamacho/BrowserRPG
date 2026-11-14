/**
 * Turns the isometric floor art in Assets/Tiles (git-ignored: the raw files
 * are large) into top-down floor textures in Assets/Floors (committed), for
 * painting rooms on the map and the battlefield.
 *
 * An isometric floor is a diamond seen at an angle. The largest upright
 * rectangle inside the diamond is half its width and half its height; cut
 * that out of the diamond's centre and stretch it back to a square, and the
 * result looks like the same floor seen from above. The three "full" textures
 * are top-down already and are only scaled down.
 *
 *   node scripts/make-floors.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'Assets', 'Tiles');
const out = join(root, 'Assets', 'Floors');
const SIZE = 1024;
/** How much of the largest rectangle inside the diamond to keep. */
const INSET = 0.86;

/**
 * `diamond` is the height of the floor's top face as a share of the image's
 * width: about 1/√3 for true isometric art, 1/2 for the 2:1 pixel-art slabs,
 * whose sides hang below the top face.
 */
const FLOORS = [
  { name: 'flagstones', file: 'GalefireRPG_Dungeon_floors_12x12.png', diamond: 1 / 2 },
  { name: 'big-blocks', file: 'bigblockfloor.png', diamond: 1 / Math.sqrt(3) },
  { name: 'cave', file: 'cave-floor.png', diamond: 1 / Math.sqrt(3) },
  { name: 'rocky', file: 'rocky floor.png', diamond: 1 / Math.sqrt(3) },
  { name: 'icy', file: 'icy-floor.png', diamond: 1 / Math.sqrt(3) },
  { name: 'volcanic', file: 'volcanic-floor.png', diamond: 1 / Math.sqrt(3) },
  { name: 'grass', file: 'full grass.png' },
  { name: 'obsidian', file: 'full obsidian.png' },
  { name: 'snow', file: 'full snow.png' },
];

mkdirSync(out, { recursive: true });
for (const floor of FLOORS) {
  const source = join(from, floor.file);
  if (!existsSync(source)) {
    console.log(`Skipped ${floor.name}: ${floor.file} not found`);
    continue;
  }
  let image = sharp(source, { limitInputPixels: false });
  if (floor.diamond) {
    const { width } = await image.metadata();
    const faceHeight = width * floor.diamond;
    // A little inside the largest rectangle, clear of the diamond's soft, shaded edges.
    const w = (width / 2) * INSET;
    const h = (faceHeight / 2) * INSET;
    const crop = {
      left: Math.round(width / 2 - w / 2),
      top: Math.round(faceHeight / 2 - h / 2),
      width: Math.round(w),
      height: Math.round(h),
    };
    image = sharp(await image.extract(crop).toBuffer());
  }
  await image
    .resize(SIZE, SIZE, { fit: 'fill' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(join(out, `${floor.name}.jpg`));
  console.log(`Made ${floor.name}.jpg`);
}
