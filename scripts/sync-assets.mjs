/**
 * Copies game-usable images and sounds from the asset packs into asset-library/,
 * resized for the game, and writes asset-library/index.json.
 *
 *   npm run assets:sync                       (packs in ../assets and ./Assets)
 *   ASSETS_DIR=D:/packs npm run assets:sync   (the first set of packs somewhere else)
 *
 * Two places are read: the original packs (ASSETS_DIR, ../assets by default)
 * and the project's own Assets folder. Either may be missing.
 *
 * The packs are commercial and are not committed: asset-library/ is
 * git-ignored, and the game shows placeholders for any asset it cannot find.
 * Re-running only converts files that are new or changed.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mp3Encoder } from '@breezystack/lamejs';
import sharp from 'sharp';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = resolve(process.env.ASSETS_DIR ?? join(projectRoot, '..', 'assets'));
const localDir = join(projectRoot, 'Assets');
const ROOTS = { packs: assetsDir, local: localDir };
// Kept out of public/ so builds do not copy it; vite.config.ts serves it at /asset-library/.
const outDir = join(projectRoot, 'asset-library');

/**
 * Each rule maps a folder of a pack to a library category.
 * `size` is the longest side in pixels; animations keep their size because
 * they are sprite sheets cut into 192 px frames.
 */
const RULES = [
  // Gear
  { category: 'weapons', pack: 'RPG Weapons Icons', dir: 'rpgweaponsicons_windows/rpgweaponsicons/WeaponsIcons_png/transparent', size: 128, sub: true, exclude: /^(Addons|guns)$/i },
  { category: 'weapons/addons', pack: 'RPG Weapons Icons', dir: 'rpgweaponsicons_windows/rpgweaponsicons/WeaponsIcons_png/transparent/Addons', size: 128 },
  { category: 'armour', pack: 'Armor Icon Pack', dir: 'armoriconpack_windows/armoriconpack/transparent', size: 128, sub: true },
  { category: 'armour/action', pack: 'Action RPG Armor', dir: 'actionrpgarmor_windows/actionrpgarmor', size: 128 },
  { category: 'loot', pack: 'Loot Icons', dir: 'looticons_windows/looticons/LootIcons_png/transparent', size: 128 },
  { category: 'loot/addons', pack: 'Loot Icons', dir: 'looticons_windows/looticons/LootIcons_png/transparent/addons', size: 128 },
  { category: 'loot/action', pack: 'Action RPG Loot', dir: 'actionrpgloot_windows/actionrpgloot', size: 128 },
  { category: 'potions', pack: 'Potions and Tonics', dir: 'visustellaatelier_potionsandtonics_vol1', size: 128, deep: true, include: /[\\/]Base[\\/]/, exclude: /xx_Atlas/i },
  { category: 'coins', pack: 'Badges Megapack', dir: 'badgesmegapack_windows/badgesmegapack/Coins_Icons/coins', size: 96 },

  // Skills and spells
  { category: 'skills', pack: 'Spellbook Megapack', dir: 'spellbookmegapack_windows/spellbookmegapack/Skill_Icon_Pack', size: 128, sub: true },
  { category: 'skills/flat', pack: 'Spellbook Megapack', dir: 'spellbookmegapack_windows/spellbookmegapack/Flat_Skills_Icons', size: 128, deep: true },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
    category: `spells/page-${n}`,
    pack: 'Spellbook Megapack',
    dir: `spellbookmegapack_windows/spellbookmegapack/SpellBookPage0${n}`,
    size: 128,
    deep: true,
  })),

  // Characters and monsters
  { category: 'portraits/female', pack: 'Avatars Megapack', dir: 'avatarsmegapack_windows/avatarsmegapack/CharactersAvatarIcons/female', size: 192 },
  { category: 'portraits/male', pack: 'Avatars Megapack', dir: 'avatarsmegapack_windows/avatarsmegapack/CharactersAvatarIcons/male', size: 192 },
  { category: 'monsters/mobs', pack: 'Avatars Megapack', dir: 'avatarsmegapack_windows/avatarsmegapack/MobsAvatarIcons', size: 192 },
  { category: 'monsters/beasts', pack: 'Avatars Megapack', dir: 'avatarsmegapack_windows/avatarsmegapack/MonstersIvatarIcons', size: 192 },

  // Badges
  { category: 'badges/races', pack: 'Badges Megapack', dir: 'badgesmegapack_windows/badgesmegapack/RacesBadges/RacesBadges_png', size: 192 },
  { category: 'badges/classes', pack: 'Badges Megapack', dir: 'badgesmegapack_windows/badgesmegapack/RPG_Class_Badges/RPG_Class_Badges_png', size: 192 },
  { category: 'badges/professions', pack: 'Badges Megapack', dir: 'badgesmegapack_windows/badgesmegapack/RpgProfessionsBadges/RpgProfessionsBadges_png', size: 192 },
  { category: 'badges/fantasy', pack: 'Badges Megapack', dir: 'badgesmegapack_windows/badgesmegapack/FantasyBadges', size: 192 },
  { category: 'badges/magic', pack: 'Badges Megapack', dir: 'badgesmegapack_windows/badgesmegapack/MagicBadges/MagicBadges_png', size: 192 },
  { category: 'badges/shields', pack: 'Badges Megapack', dir: 'badgesmegapack_windows/badgesmegapack/ShieldsBadges/ShieldsBadges_png', size: 192 },
  { category: 'badges/runes', pack: 'Badges Megapack', dir: 'badgesmegapack_windows/badgesmegapack/FantasyRunesIcons/FantasyRunesIcons_png', size: 128 },
  { category: 'badges/heraldry', pack: 'Badges Megapack', dir: 'badgesmegapack_windows/badgesmegapack/HeraldicAnimalsIcons', size: 128 },

  // Attack and spell animations (sprite sheets, 192 px frames, 5 per row)
  { category: 'animations/cursed-kingdoms', pack: 'Animations Collection: Cursed Kingdoms', dir: 'animationscollection_cursedkingdoms/30FPS', animation: true },
  { category: 'animations/quantum', pack: 'Animations Collection 2: Quantum', dir: 'animationscollection2_quantum/30FPS', animation: true },
  { category: 'animations/dark', pack: 'Animations Select: Dark', dir: 'animationsselect_dark/AS5 Dark/30FPS', animation: true },
  { category: 'animations/earth', pack: 'Animations Select: Earth', dir: 'animationsselect_earth/30FPS', animation: true },
  { category: 'animations/ice', pack: 'Animations Select: Ice', dir: 'animationsselect_ice/30FPS', animation: true },
  { category: 'animations/thunder', pack: 'Animations Select: Thunder', dir: 'animationsselect_thunder/30FPS', animation: true },

  // The project's own Assets folder. The skill and spell icons keep the same ids as above.
  { root: 'local', category: 'skills', pack: 'Spellbook Megapack', dir: 'AbilityIcons/Skill_Icon_Pack', size: 128, sub: true },
  ...[1, 6, 9].map((n) => ({ root: 'local', category: `spells/page-${n}`, pack: 'Spellbook Megapack', dir: `AbilityIcons/SpellBookPage0${n}`, size: 128, deep: true })),
  { root: 'local', category: 'classes', pack: 'Class icons', dir: 'Classes', size: 192 },
  { root: 'local', category: 'races', pack: 'Race icons', dir: 'RaceIcons', size: 192 },
  { root: 'local', category: 'obstacles/containers', pack: 'Containers', dir: 'Obstacles/Containers', size: 128, trim: true },
  { root: 'local', category: 'obstacles/dungeon', pack: 'Isometric Dungeon Designer', dir: 'Obstacles/Dungeon', size: 128, trim: true },
  // Top-down floor textures for painting rooms, made from Assets/Tiles by `npm run floors`.
  { root: 'local', category: 'floors', pack: 'Isometric Dungeon Designer floors', dir: 'Floors', size: 1024, pattern: /\.jpe?g$/i },
  // Dialogue scene art, one folder per adventure: scenes/<adventure id>/<image key>.
  { root: 'local', category: 'scenes/greywater-ford', pack: 'The Toll at Greywater Ford', dir: 'TollGreywaterFord', size: 1344 },
  // Portraits and monster tokens (the Avatars Megapack): the same ids as the original packs.
  { root: 'local', category: 'portraits/female', pack: 'Avatars Megapack', dir: 'Tokens/CharactersAvatarIcons/female', size: 192 },
  { root: 'local', category: 'portraits/male', pack: 'Avatars Megapack', dir: 'Tokens/CharactersAvatarIcons/male', size: 192 },
  { root: 'local', category: 'monsters/mobs', pack: 'Avatars Megapack', dir: 'Tokens/MobsAvatarIcons', size: 192 },
  { root: 'local', category: 'monsters/beasts', pack: 'Avatars Megapack', dir: 'Tokens/MonstersIvatarIcons', size: 192 },
  // Spell and ability effects, unpacked from Assets/Animations by `npm run assets:unpack`.
  ...[
    ['dark', 'animationsselect_dark/AS5 Dark/30FPS', 'Animations Select: Dark'],
    ['earth', 'animationsselect_earth/30FPS', 'Animations Select: Earth'],
    ['ice', 'animationsselect_ice/30FPS', 'Animations Select: Ice'],
    ['light', 'animationsselect_light/30FPS', 'Animations Select: Light'],
    ['thunder', 'animationsselect_thunder/30FPS', 'Animations Select: Thunder'],
    ['water', 'animationsselect_water/30FPS', 'Animations Select: Water'],
    ['wind', 'animationsselect_wind/30FPS', 'Animations Select: Wind'],
    ['thaumaturgy', 'animationscollection3_thaumaturgy/30FPS', 'Animations Collection 3: Thaumaturgy'],
  ].map(([name, dir, pack]) => ({ root: 'local', category: `animations/${name}`, pack, dir: `_unpacked/animations/${dir}`, animation: true })),
  // Sound effects: WAVs are compressed to MP3, OGGs copied as they are.
  ...[
    ['sfx/magic', 'Simple Magic Sound FX Pack Vol. 1/Simple Magic Sound FX Pack Vol. 1', 'Simple Magic Sound FX'],
    ['sfx/medieval', 'Medieval Fantasy Sound FX Pack Vol. 2/Medieval Fantasy Sound FX Pack Vol. 2', 'Medieval Fantasy Sound FX'],
    ['sfx/impacts', 'Foley Impacts Vol. 1/Foley Impacts Vol. 1', 'Foley Impacts'],
    ['sfx/footsteps', 'Foley Footsteps Vol. 1/Foley Footsteps Vol. 1', 'Foley Footsteps'],
    ['sfx/movement', 'Foley Movement Vol. 1/Foley Movement Vol. 1', 'Foley Movement'],
    ['sfx/fire', 'Fire Sound FX Pack Vol. 1/Fire Sound FX Pack Vol. 1', 'Fire Sound FX'],
    ['sfx/ui', 'UI & Menus Sound FX Pack Vol. 2/UI & Menu Sound FX Pack Vol. 2', 'UI & Menus Sound FX'],
    ['sfx/blast', 'evfxblast/SFX', 'EVFX Blast'],
    ['sfx/slash', 'evfxslash/SFX', 'EVFX Slash'],
  ].map(([category, dir, pack]) => ({
    root: 'local',
    category,
    pack,
    dir: `_unpacked/sounds/${dir}`,
    audio: true,
    // The EVFX sounds sit in one folder; the other packs have a folder per kind of sound.
    sub: !dir.endsWith('/SFX'),
    deep: true,
  })),
  // Fairytale icons: only the transparent-background versions.
  ...[
    ['items/weapons', 'FantasyWeaponIcons/FantasyWeaponIcons_png', { sub: true, only: /_t\.png$/i }],
    ['items/barbarian', 'BarbarianIcons/Barbarian_icons_t'],
    ['items/witchcraft', 'WitchCraftIcons/WitchCraftIcons_transparent'],
    ['items/jewelry', 'JewelryIcons/transparent', { sub: true }],
    ['items/bags', 'BagsAndBoxesIcons/BagsAndBoxesIcons_png'],
    ['items/fishing', 'FishingIcons/FishingIcons_png'],
    ['items/forest', 'ForestIcons/ForestIcons_transparent'],
    ['items/food', 'FruitAndVegetablesIcons/png'],
    ['items/hunting', 'HuntingIcons/HuntingIcons_transparent'],
    ['items/mining', 'MiningIcons/MiningIcons_transparent'],
    ['items/necromancer', 'NecromancerIcons/NecromancerIcons_t'],
    ['items/pirates', 'PiratesIconsPack/transparent'],
    ['items/prehistoric', 'PrehistoricAgeIcons/transparent'],
    ['items/scrolls', 'ScrollsAndBooks/ScrollsAndBooks_t'],
    ['items/trading', 'TradingIcons/TradingIcons_t'],
    ['items/trophies', 'TrophyIcons/TrophyIcons_transparent'],
  ].map(([category, dir, extra]) => ({
    root: 'local',
    category,
    pack: 'Fairytale Icons Megapack',
    dir: `Loot&Equipment/fairytaleiconsmegapack/${dir}`,
    size: 128,
    exclude: /screenshot/i,
    ...(extra ?? {}),
  })),
];

const IMAGE = /\.png$/i;
const AUDIO = /\.(wav|ogg)$/i;

function slug(text) {
  return text
    .replace(/\.[^.]+$/, '')
    .replace(/^30FPS_/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function label(file) {
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/^30FPS_/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listImages(dir, deep, pattern = IMAGE) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && deep) found.push(...listImages(full, true, pattern));
    else if (entry.isFile() && pattern.test(entry.name)) found.push(full);
  }
  return found;
}

/** Expands a rule with `sub: true` into one rule per subfolder. */
function rootOf(rule) {
  return ROOTS[rule.root ?? 'packs'];
}

function expand(rule) {
  if (!rule.sub) return [rule];
  const base = join(rootOf(rule), rule.dir);
  if (!existsSync(base)) return [rule];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !(rule.exclude && rule.exclude.test(e.name)))
    .map((e) => ({
      ...rule,
      sub: false,
      exclude: rule.root === 'local' ? rule.exclude : undefined,
      dir: `${rule.dir}/${e.name}`,
      category: `${rule.category}/${slug(e.name)}`,
    }));
}

// ---------- sound: WAV to MP3 ----------

/** Reads a WAV file into 16-bit samples per channel. Handles 8/16/24/32-bit PCM and 32-bit float. */
function readWav(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV file`);
  let fmt = null;
  let data = null;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      let format = b.readUInt16LE(o + 8);
      // WAVE_FORMAT_EXTENSIBLE: the real format is in the sub-format GUID.
      if (format === 0xfffe && size >= 26) format = b.readUInt16LE(o + 32);
      fmt = { format, channels: b.readUInt16LE(o + 10), sampleRate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    } else if (id === 'data') {
      data = b.subarray(o + 8, Math.min(b.length, o + 8 + size));
    }
    o += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file} has no audio data`);
  const { format, channels, sampleRate, bits } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = Array.from({ length: channels }, () => new Int16Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const at = (i * channels + c) * bytes;
      let v;
      if (format === 3 && bits === 32) v = Math.max(-1, Math.min(1, data.readFloatLE(at))) * 32767;
      else if (bits === 16) v = data.readInt16LE(at);
      else if (bits === 24) v = data.readIntLE(at, 3) >> 8;
      else if (bits === 32) v = data.readInt32LE(at) >> 16;
      else if (bits === 8) v = (data.readUInt8(at) - 128) << 8;
      else throw new Error(`${file}: ${bits}-bit audio is not supported`);
      out[c][i] = v;
    }
  }
  return { sampleRate, channels: out };
}

/** Encodes a WAV as MP3: stereo at 128 kbps, mono at 96. More than two channels are mixed down to stereo. */
function wavToMp3(source, target) {
  const wav = readWav(source);
  let channels = wav.channels;
  if (channels.length > 2) {
    const mix = (pick) => {
      const out = new Int16Array(channels[0].length);
      for (let i = 0; i < out.length; i++) {
        const picked = pick.map((c) => channels[c][i]);
        out[i] = Math.round(picked.reduce((a, v) => a + v, 0) / picked.length);
      }
      return out;
    };
    const left = channels.map((_, c) => c).filter((c) => c % 2 === 0);
    const right = channels.map((_, c) => c).filter((c) => c % 2 === 1);
    channels = [mix(left), mix(right)];
  }
  const stereo = channels.length === 2;
  const encoder = new Mp3Encoder(channels.length, wav.sampleRate, stereo ? 128 : 96);
  const parts = [];
  const block = 1152;
  for (let i = 0; i < channels[0].length; i += block) {
    const l = channels[0].subarray(i, i + block);
    const chunk = stereo ? encoder.encodeBuffer(l, channels[1].subarray(i, i + block)) : encoder.encodeBuffer(l);
    if (chunk.length > 0) parts.push(Buffer.from(chunk));
  }
  const end = encoder.flush();
  if (end.length > 0) parts.push(Buffer.from(end));
  writeFileSync(target, Buffer.concat(parts));
}

async function convert(source, target, rule) {
  if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) return false;
  mkdirSync(dirname(target), { recursive: true });
  if (rule.audio) {
    if (/\.wav$/i.test(source)) {
      wavToMp3(source, target);
      // An uncompressed copy from an earlier sync is no longer needed.
      const stale = target.replace(/\.mp3$/, '.wav');
      if (existsSync(stale)) rmSync(stale);
    } else {
      copyFileSync(source, target);
    }
  } else if (rule.animation) {
    await sharp(source).png({ compressionLevel: 9 }).toFile(target);
  } else {
    // `trim` cuts away empty transparent margins first, so props fill the square they are drawn in.
    const image = rule.trim ? sharp(await sharp(source).trim({ threshold: 1 }).toBuffer()) : sharp(source);
    await image.resize(rule.size, rule.size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toFile(target);
  }
  return true;
}

async function main() {
  const present = Object.entries(ROOTS).filter(([, dir]) => existsSync(dir));
  if (present.length === 0) {
    console.error(`No asset packs found at ${assetsDir} or ${localDir}. Set ASSETS_DIR to their folder.`);
    process.exit(1);
  }
  for (const [, dir] of present) console.log(`Reading packs from ${dir}`);

  const entries = [];
  const missing = [];
  let converted = 0;
  const seen = new Set();

  for (const rule of RULES.flatMap(expand)) {
    if (!existsSync(rootOf(rule))) continue;
    const dir = join(rootOf(rule), rule.dir);
    if (!existsSync(dir)) {
      missing.push(rule.dir);
      continue;
    }
    const files = listImages(dir, rule.deep, rule.pattern ?? (rule.audio ? AUDIO : IMAGE)).filter((f) => {
      const rel = relative(dir, f);
      if (rule.only && !rule.only.test(rel)) return false;
      if (rule.include && !rule.include.test(rel)) return false;
      if (rule.exclude && rule.exclude.test(rel)) return false;
      return true;
    });

    const convertOne = async (source) => {
      const rel = relative(dir, source);
      let id = `${rule.category}/${slug(rule.deep ? rel.replace(/[\\/]/g, '-') : rel)}`;
      while (seen.has(id)) id += '-x';
      seen.add(id);
      // Sounds: WAVs are compressed to MP3; anything else (OGG) is kept as it is.
      const ext = rule.audio ? (/\.wav$/i.test(source) ? '.mp3' : source.slice(source.lastIndexOf('.')).toLowerCase()) : rule.animation ? '.png' : '.webp';
      const file = `${id}${ext}`;
      if (await convert(source, join(outDir, file), rule)) converted++;
      const meta = rule.animation && !rule.audio ? await sharp(source).metadata() : null;
      entries.push({
        id,
        file,
        category: rule.category,
        pack: rule.pack,
        label: label(rule.deep ? rel.replace(/[\\/]/g, ' ') : rel),
        ...(meta ? { frames: Math.floor((meta.width ?? 0) / 192) * Math.floor((meta.height ?? 0) / 192) } : {}),
      });
    };
    // Eight at a time keeps memory steady on large folders.
    for (let i = 0; i < files.length; i += 8) await Promise.all(files.slice(i, i + 8).map(convertOne));
  }

  entries.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), count: entries.length, entries }),
  );

  const byCategory = {};
  for (const e of entries) {
    const top = e.category.split('/')[0];
    byCategory[top] = (byCategory[top] ?? 0) + 1;
  }
  console.log(`Indexed ${entries.length} assets (${converted} converted this run).`);
  console.log(Object.entries(byCategory).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
  if (missing.length) console.log(`Not found (still zipped or moved):\n  ${missing.join('\n  ')}`);
  console.log(`Wrote ${relative(projectRoot, join(outDir, 'index.json'))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
