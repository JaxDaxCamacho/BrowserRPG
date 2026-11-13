/**
 * Copies game-usable images from the asset packs into public/asset-library,
 * resized for the game, and writes public/asset-library/index.json.
 *
 *   npm run assets:sync                       (packs in ../assets)
 *   ASSETS_DIR=D:/packs npm run assets:sync   (packs somewhere else)
 *
 * The packs are commercial and are not committed: public/asset-library is
 * git-ignored, and the game shows placeholders for any asset it cannot find.
 * Re-running only converts files that are new or changed.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = resolve(process.env.ASSETS_DIR ?? join(projectRoot, '..', 'assets'));
const outDir = join(projectRoot, 'public', 'asset-library');

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
];

const IMAGE = /\.png$/i;

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

function listImages(dir, deep) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && deep) found.push(...listImages(full, true));
    else if (entry.isFile() && IMAGE.test(entry.name)) found.push(full);
  }
  return found;
}

/** Expands a rule with `sub: true` into one rule per subfolder. */
function expand(rule) {
  if (!rule.sub) return [rule];
  const base = join(assetsDir, rule.dir);
  if (!existsSync(base)) return [rule];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !(rule.exclude && rule.exclude.test(e.name)))
    .map((e) => ({ ...rule, sub: false, exclude: undefined, dir: `${rule.dir}/${e.name}`, category: `${rule.category}/${slug(e.name)}` }));
}

async function convert(source, target, rule) {
  if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) return false;
  mkdirSync(dirname(target), { recursive: true });
  if (rule.animation) {
    await sharp(source).png({ compressionLevel: 9 }).toFile(target);
  } else {
    await sharp(source).resize(rule.size, rule.size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toFile(target);
  }
  return true;
}

async function main() {
  if (!existsSync(assetsDir)) {
    console.error(`Asset packs not found at ${assetsDir}. Set ASSETS_DIR to their folder.`);
    process.exit(1);
  }
  console.log(`Reading packs from ${assetsDir}`);

  const entries = [];
  const missing = [];
  let converted = 0;
  const seen = new Set();

  for (const rule of RULES.flatMap(expand)) {
    const dir = join(assetsDir, rule.dir);
    if (!existsSync(dir)) {
      missing.push(rule.dir);
      continue;
    }
    const files = listImages(dir, rule.deep).filter((f) => {
      const rel = relative(dir, f);
      if (rule.include && !rule.include.test(rel)) return false;
      if (rule.exclude && rule.exclude.test(rel)) return false;
      return true;
    });

    const convertOne = async (source) => {
      const rel = relative(dir, source);
      let id = `${rule.category}/${slug(rule.deep ? rel.replace(/[\\/]/g, '-') : rel)}`;
      while (seen.has(id)) id += '-x';
      seen.add(id);
      const ext = rule.animation ? '.png' : '.webp';
      const file = `${id}${ext}`;
      if (await convert(source, join(outDir, file), rule)) converted++;
      const meta = rule.animation ? await sharp(source).metadata() : null;
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
