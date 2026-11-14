# Allerya Heroes: where the game is, and what's next

*Last updated 2026-11-14.*

Allerya Heroes is a party-based, turn-based dungeon crawler for the browser, Windows (Tauri) and,
later, Android. There is one TypeScript codebase. You lead a company of up to four mercenaries:
you take contracts, talk your way through briefings, explore dungeons under fog of war, and fight
on a tactical grid. Up to four players can play together online.

For how to run, build and package the game, see the [README](../README.md).

---

## Part 1: What the game is today

### The game loop

1. **Main menu.** Pick a save slot, or join someone's co-op game.
2. **Party creation.** Choose up to four mercs from the pre-built roster or make your own in the
   merc builder. Then pick a **leader**, whose player breaks ties in conversations.
3. **Adventure select.** Pick a contract.
4. **Debrief.** A branching conversation with scene art. Some options need a stat check (best
   merc, or the whole party) or an item (for example rope). The dice roll shows in the corner.
5. **Quartermaster (store).** The store opens before each dungeon and after the debrief.
6. **Dungeon.** Explore, sneak, spot and disarm traps, trigger events, make camp, split the party,
   and fight enemy groups.
7. **Combat.** Turn-based fights on a grid with obstacles.
8. **The journey back.** Once the goal is done, walk back out to the entrance, play the ending, and
   the contract is marked complete.

### Characters

- **Races (5):** Human (+XP rate, two free +1 stat choices), Dwarf (2 movement, base armour),
  Elf (4 movement, wider crit range), Goliath (bonus HP, can carry a two-hander in each hand),
  Cursed (death save).
- **Classes (6):** Knight, Barbarian, Ranger, Wizard, Warlock, Rogue. Each class has a role, key
  stats, base HP and HP per level, base Defense and an armour weight.
- **Stats (6):** Strength (melee), Agility (ranged, movement, stealth), Toughness, Intellect
  (magic), Spirit (spiritual) and Charisma. They feed checks and derived values.
- **Talent trees.** Every class has three branches with tiered, ranked passive talents and ability
  unlocks:

  | Class | Branches |
  | --- | --- |
  | Knight | Templar, Guardian, Captain |
  | Rogue | Assassin, Highwayman, Entertainer |
  | Barbarian | Savagery, Mage Hunter, Bully |
  | Wizard | Elemental, White Magic, Destruction |
  | Ranger | Trapper, Beast Master, Druid |
  | Warlock | Spirit Healer, Plague Bearer, Sword Binder |

- **Levelling:** an XP curve up to level 20. Each level gives a stat point and 2 talent points
  (every merc also starts with 1 talent point). Points can only be spent at camp or in town
  (the training panel).
- **Injuries:** being knocked down leaves a permanent injury (-1 to one or two stats). A fourth
  injury kills the merc. Injuries only heal with a healing kit during a long rest.
- **Money:** gold, silver and copper, shown with coin art. New mercs start with 50 silver, and each
  merc has their own purse.

### Gear and the store

- **37 items:** melee weapons (sword, axe, mace, spear, dagger, two-handers), ranged and magic
  weapons (shortbow, crossbow, wand, staff, focus), body armour from robes to warded plate,
  shields, rings and an amulet, potions, ammunition (including fire arrows) and supplies (rope,
  trap kit, camping kit, rations, healing kit).
- **Dual wielding:** the basic attack follows up with the off-hand weapon at -3 to hit. Talents
  (Twin Weapons, Ambidextrous) reduce the penalty.
- **Store:** staples are always in stock and six pieces of gear change on each visit. Mercs sell
  for half price. In co-op, each player trades for their own merc.
- **Supplies:** rations heal 6 HP outside fights, a trap kit disarms a spotted trap with no roll,
  and a camping kit allows a second camp on a level.

### Dungeons

- Square-grid maps with **fog of war**. The party sees two tiles around it in line of sight, and the
  whole of any room it enters.
- Click-to-move **pathfinding** through ground the party has already seen.
- **Traps** (spotted with checks, disarmed or triggered), **events** (step on one and a dialogue
  opens) and a **goal** shown from the start.
- **Stealth:** inside an enemy group's detection range, every step needs a stealth check made by the
  party's noisiest merc. Failing one starts a fight.
- **Camp (long rest):** heals fully, gets downed mercs back up, and cures injuries with kits. You
  get one camp per level, or more with camping kits.
- **Split party:** each group has its own token. Play goes in world rounds: every fight plays a
  round, then every group outside a fight takes an exploration turn.

### Combat

- Turn-based, on a square grid sized to the room (a strip in corridors), with **obstacles**:
  barrel, chest, barricade, pillar, crate, boulder. Some block movement or line of sight.
- Each turn a combatant moves up to their movement (race base + Agility modifier) and takes one
  action. Melee reaches the eight adjacent tiles. Ranged weapons have a range in tiles and roll
  with disadvantage while an enemy is adjacent.
- **Attacks:** a d20 plus the stat modifier against Defense. A natural 1 misses, and 20 (or the crit
  threshold) crits. Above Defense is a hit, otherwise a graze. Armour reduces damage by type:
  physical armour against physical damage, magic armour against magic damage.
  **Spiritual damage goes through both kinds of armour.**
- **Attacks of opportunity** from enemies engaged with the mover when the move starts. **Flanking**,
  conditions, buffs, invisibility, summons, ammunition, the Defend action and fleeing (an Agility
  check by the leader).
- **Action bar** with 84 abilities across the classes and monsters, paid for with class resources
  (mana, adrenaline or souls).
- **9 monsters:** Bandit Thug, Bandit Archer, Bandit Captain, Hedge Mage, War Hound, Imp, Wolf, Hawk
  and Bear. Monster AI acts on its own.
- Animations, sound effects, "Down!" / "Slain!" callouts, and HP and resource bars on the character
  sheet and enemy details.

### Content

- **One adventure:** *The Toll at Greywater Ford* (starter). Bandits in the old watchtower,
  with a debrief, a dungeon (*the Greywater watchtower*) and an ending.
- 8 pre-built mercs and 65 portraits.

### Online co-op (up to 4 players)

- The host gets a five-letter code and the others join and pick a merc. The host plays every
  unclaimed merc, and takes a merc back if its player drops out.
- The host's game is authoritative. Other players send commands, which the host validates.
- Conversations are decided by vote. The leader's player breaks ties.
- Connections are browser-to-browser over WebRTC (PeerJS). Only the host's game is saved.

### Tools (`Tools.bat` / `/tools.html`, development server only)

- **Content editor:** gear, abilities, monsters, classes, races, pre-built mercs, portraits and
  obstacle types, validated against the game's own schemas. It saves the JSON in `src/content/`.
- **Dungeon maker:** maps, rooms, traps, events, goals, enemy groups and battlefield obstacles,
  with a test-play button.

### Platforms and tech

- React 19, Zustand, PixiJS 8 (map and combat), Zod (content schemas), PeerJS, and Vite and Vitest.
- The rules engine (`src/engine/`) is pure functions over `GameState`, with no UI imports. It has
  293 tests.
- Builds: browser (Vite) and a Windows installer (Tauri v2, NSIS). Android is planned but not set
  up yet.
- Art and sound come from commercial packs, which are kept out of the repo. A placeholder shows
  wherever an asset is missing.

---

## Part 2: What's next

### Combat feel
- [ ] **Fix the enemy animation sequence.**
- [ ] **Better effects when characters get attacked.** Impact feedback on hit, graze, crit and
  miss.
- [ ] **Combat screen rework.** Show more information (turn order, hit chances, statuses, ranges)
  with a better layout.

### Battlefield rules
- [ ] **Rebalance weapon ranges.** Today: shortbow 8, crossbow, wand, staff and focus 6, melee
  adjacent.
- [ ] **Starting positions from the approach.** Place the party according to how far each merc was
  from the enemy when combat started.
- [ ] **Ambush.** If the party reaches a square next to an enemy token without being detected, the
  party gets a free turn.
- [ ] **More obstacle types**, and icons for the existing ones that lack them (pillar and boulder).

### Monsters
- [ ] **Large monsters** that take up more than one square. This affects pathfinding, reach,
  targeting and placement.
- [ ] **Boss fights.** These build on large monsters.

### Map and party
- [ ] **Split-party movement.** While the party is split, every merc moves 3 + Agility modifier
  tiles per exploration turn on the map.
- [ ] **Better map graphics.**
- [ ] **Co-op: vote for the leader.**

### Big reworks (agree a design first)
- [ ] **Expand and rework items and gear.**
- [ ] **Expand and rework each class's abilities.**

### Done
- [x] Rule decision: spiritual damage ignores both physical and magic armour.
