'use strict';
/* config -- tuning constants, stat tables, sprite tables, palettes.
   The CFG / KINDS / BLD / TECHS blocks are generated from data/*.json by tools/check-stats.mjs,
   the sprite tables from data/sprites.json by tools/gen-atlas.js: edit the data, not the blocks. */

// GENERATED FROM data/units.json -- edit the data or run `node tools/check-stats.mjs --write`.
const CFG = {
  MAP_W: 96,
  MAP_H: 96,
  TILE: 22,                       // px per tile (single zoom level for now)
  SEED: 1337,                     // fixed map => reproducible, testable
  START: { food: 100, wood: 100, gold: 50, stone: 50 },
  CARRY_MAX: 10,                  // villager carry capacity (AoE2 uses 10 - see design{})
  WORKERS_PER_TILE: 2,            // max villagers per tile (spreads the start squad)
  GATHER_RATE: 1.5,               // resource units per second while working
  CANCEL_REFUND: 0.8,             // fraction of a building's cost refunded on construction cancel
  AGE_FOOD: 500,                  // food cost of Feudal Age
  WAVE_EVERY: 45,                 // seconds between enemy attack waves
  ACQUIRE: 6,                     // tiles: idle fighters spot enemy units this far
  BUILDING_ACQUIRE: 5,            // tiles: ... and raze enemy buildings this close
  UNIT_SEP: 11,                   // min px between two units
  PAN_SPEED: 620,                 // px/s camera pan
  EDGE: 14,                       // px edge-scroll band
  PROJ_SPEED: 176,                // px/s an arrow flies (8 tiles/s - the table carries no projectile speed)
  ASTAR_MAX_NODES: 4000,          // expansion cap for one A* query (the table carries no pathfinding budget)
  RES: { tree: 60, gold: 800, stone: 450, berry: 150 },
  VERSION: 1,                     // save payload schema stamp - loadGame accepts only this version, migrate() converts older ones
  AUTOSAVE_DEBOUNCE: 2,           // seconds a mutator waits before the save writes (a burst inside the window keeps ONE pending save)
  AUTOSAVE_EVERY: 30,             // seconds between autosaves of a quiet game (the table carries no save cadence)
};

// GENERATED FROM data/units.json -- edit the data or run `node tools/check-stats.mjs --write`.
const KINDS = {
  villager: {
    label: 'Villager', hp: 25, speed: 18, atk: 3, atkType: 'melee',
    atkTime: 0.64, r: 5, time: 25, buildable: true,
    cost: { food: 50 }, meleeArmor: 0,
    pierceArmor: 0, lineOfSight: 4,
    range: 0, minRange: 0, reload: 2, accuracy: 100,
  },
  militia: {
    label: 'Militia', hp: 40, speed: 20, atk: 4, atkType: 'melee',
    atkTime: 0.5, r: 6, time: 21, buildable: true,
    cost: { food: 50, gold: 20 }, meleeArmor: 0,
    pierceArmor: 1, lineOfSight: 4,
    range: 0, minRange: 0, reload: 2, accuracy: 100,
  },
  archer: {
    label: 'Archer', hp: 30, speed: 21, atk: 4, atkType: 'ranged',
    atkTime: 0.35, r: 5, time: 35, buildable: true,
    cost: { wood: 25, gold: 45 }, meleeArmor: 0,
    pierceArmor: 0, lineOfSight: 6,
    range: 4, minRange: 0, reload: 2, accuracy: 80,
  },
};

/* Sprite atlas -- every frame lives in ONE image, assets/sprites.png, and every
 * table below it is generated: data/sprites.json plus the PNGs in
 * data/sprites/ are the art source (ripped AoE2 graphics, recoloured per team
 * from TEAM), tools/gen-atlas.js composes the sheet and rewrites the blocks
 * under their GENERATED FROM banners. sx/sy/sw/sh = the cell inside the sheet,
 * dw/dh = the size the cell is drawn on screen: for units the size authored in
 * the manifest, for buildings the footprint in px (b.w*TILE x b.h*TILE).
 * SPRITES maps kind -> animation -> [Blue, Red]; the columns run left to right
 * with row 0 = Blue and row 1 = Red, exactly like TEAM. Which cell a unit plays
 * is unitAnim(u) (src/render.js): villagers have civilian idle/walk plus the
 * two-frame work animations WORK_ANIM names per resource, militia idle/walk
 * plus attack_a/attack_b swings. New unit kinds or animations must add frames
 * to the manifest or the `sprites: every registered anim x team has a unique
 * in-sheet cell` check fails.
 */
// GENERATED FROM data/sprites.json
const SPRITE_SHEET = {
  w: 1522, h: 684,
};
// GENERATED FROM data/sprites.json
const SPRITES = {
  archer: {
    attack_a: [{ sx: 0, sy: 0, sw: 58, sh: 70, dw: 20, dh: 20 },
              { sx: 0, sy: 86, sw: 58, sh: 70, dw: 20, dh: 20 }],
    attack_b: [{ sx: 58, sy: 0, sw: 58, sh: 70, dw: 20, dh: 20 },
              { sx: 58, sy: 86, sw: 58, sh: 70, dw: 20, dh: 20 }],
    idle: [{ sx: 116, sy: 0, sw: 49, sh: 51, dw: 20, dh: 20 },
          { sx: 116, sy: 86, sw: 49, sh: 51, dw: 20, dh: 20 }],
    walk: [{ sx: 165, sy: 0, sw: 53, sh: 54, dw: 20, dh: 20 },
          { sx: 165, sy: 86, sw: 53, sh: 54, dw: 20, dh: 20 }],
  },
  militia: {
    attack_a: [{ sx: 218, sy: 0, sw: 64, sh: 67, dw: 22, dh: 22 },
              { sx: 218, sy: 86, sw: 64, sh: 67, dw: 22, dh: 22 }],
    attack_b: [{ sx: 282, sy: 0, sw: 64, sh: 67, dw: 22, dh: 22 },
              { sx: 282, sy: 86, sw: 64, sh: 67, dw: 22, dh: 22 }],
    idle: [{ sx: 346, sy: 0, sw: 37, sh: 50, dw: 22, dh: 22 },
          { sx: 346, sy: 86, sw: 37, sh: 50, dw: 22, dh: 22 }],
    walk: [{ sx: 383, sy: 0, sw: 36, sh: 50, dw: 22, dh: 22 },
          { sx: 383, sy: 86, sw: 36, sh: 50, dw: 22, dh: 22 }],
  },
  villager: {
    chop_a: [{ sx: 419, sy: 0, sw: 82, sh: 71, dw: 20, dh: 20 },
            { sx: 419, sy: 86, sw: 82, sh: 71, dw: 20, dh: 20 }],
    chop_b: [{ sx: 501, sy: 0, sw: 82, sh: 71, dw: 20, dh: 20 },
            { sx: 501, sy: 86, sw: 82, sh: 71, dw: 20, dh: 20 }],
    farm_a: [{ sx: 583, sy: 0, sw: 146, sh: 86, dw: 20, dh: 20 },
            { sx: 583, sy: 86, sw: 146, sh: 86, dw: 20, dh: 20 }],
    farm_b: [{ sx: 729, sy: 0, sw: 146, sh: 86, dw: 20, dh: 20 },
            { sx: 729, sy: 86, sw: 146, sh: 86, dw: 20, dh: 20 }],
    idle: [{ sx: 875, sy: 0, sw: 28, sh: 46, dw: 20, dh: 20 },
          { sx: 875, sy: 86, sw: 28, sh: 46, dw: 20, dh: 20 }],
    mine_a: [{ sx: 903, sy: 0, sw: 73, sh: 76, dw: 20, dh: 20 },
            { sx: 903, sy: 86, sw: 73, sh: 76, dw: 20, dh: 20 }],
    mine_b: [{ sx: 976, sy: 0, sw: 73, sh: 76, dw: 20, dh: 20 },
            { sx: 976, sy: 86, sw: 73, sh: 76, dw: 20, dh: 20 }],
    walk: [{ sx: 1049, sy: 0, sw: 31, sh: 48, dw: 20, dh: 20 },
          { sx: 1049, sy: 86, sw: 31, sh: 48, dw: 20, dh: 20 }],
  },
};

/* Which work animation each gathered resource uses (unitAnim picks it from the
 * unit's order source). Stone mines like gold, exactly like AoE2. */
// GENERATED FROM data/sprites.json
const WORK_ANIM = {
  food: 'farm',
  gold: 'mine',
  stone: 'mine',
  wood: 'chop',
};

/** The atlas cell for (kind, team, anim), or null when that frame has no art.
 *  Anim defaults to idle so callers of the v1 signature keep working. */
function spriteFor(kind, team, anim) {
  const table = SPRITES[kind];
  const cells = table && table[anim || 'idle'];
  if (!Array.isArray(cells)) return null;
  const c = cells[team];
  return (c && typeof c.sx === 'number' && typeof c.sw === 'number') ? c : null;
}

/* Built-building art: one cell per BLD kind x team, the two rows below the unit
 * block, generated from data/sprites.json like the unit tables, with dw/dh set
 * to the footprint in px (b.w*TILE x b.h*TILE) that the 5c check re-checks
 * against BLD. The farm frame is the old procedural cell: the ripped building
 * set ships no farm bitmap (see data/README.md). */
// GENERATED FROM data/sprites.json
const BLD_SPRITES = {
  archery_range: [{ sx: 0, sy: 172, sw: 307, sh: 253, dw: 44, dh: 44 },
                 { sx: 0, sy: 428, sw: 307, sh: 253, dw: 44, dh: 44 }],
  barracks: [{ sx: 307, sy: 172, sw: 316, sh: 256, dw: 44, dh: 44 },
            { sx: 307, sy: 428, sw: 316, sh: 256, dw: 44, dh: 44 }],
  farm: [{ sx: 623, sy: 172, sw: 44, sh: 44, dw: 44, dh: 44 },
        { sx: 623, sy: 428, sw: 44, sh: 44, dw: 44, dh: 44 }],
  house: [{ sx: 667, sy: 172, sw: 177, sh: 126, dw: 44, dh: 44 },
         { sx: 667, sy: 428, sw: 177, sh: 126, dw: 44, dh: 44 }],
  lumber_camp: [{ sx: 844, sy: 172, sw: 163, sh: 137, dw: 22, dh: 22 },
               { sx: 844, sy: 428, sw: 163, sh: 137, dw: 22, dh: 22 }],
  mill: [{ sx: 1007, sy: 172, sw: 218, sh: 216, dw: 44, dh: 44 },
        { sx: 1007, sy: 428, sw: 218, sh: 216, dw: 44, dh: 44 }],
  mining_camp: [{ sx: 1225, sy: 172, sw: 176, sh: 110, dw: 22, dh: 22 },
               { sx: 1225, sy: 428, sw: 176, sh: 110, dw: 22, dh: 22 }],
  town_center: [{ sx: 1401, sy: 172, sw: 121, sh: 163, dw: 66, dh: 66 },
               { sx: 1401, sy: 428, sw: 121, sh: 163, dw: 66, dh: 66 }],
};

/** The atlas cell for one built building kind, per team; null when unknown. */
function bldSpriteFor(kind, team) {
  const cells = BLD_SPRITES[kind];
  if (!Array.isArray(cells)) return null;
  const c = cells[team];
  return (c && typeof c.sx === 'number' && typeof c.sw === 'number') ? c : null;
}

// GENERATED FROM data/buildings.json -- edit the data or run `node tools/check-stats.mjs --write`.
const BLD = {
  town_center: {
    label: 'Town Center', hp: 2400, w: 3, h: 3,
    cost: { wood: 275, stone: 100 }, time: 100, pop: 5,
    trains: ['villager'],
    attack: 5, meleeArmor: 3, pierceArmor: 5, lineOfSight: 8, range: 6, reload: 2, accuracy: 100, garrisonCapacity: 15,
  },
  house: {
    label: 'House', hp: 550, w: 2, h: 2,
    cost: { wood: 25 }, time: 25, pop: 5,
    trains: [],
    attack: 0, meleeArmor: -2, pierceArmor: 7, lineOfSight: 2, range: 0, reload: 0, accuracy: 0, garrisonCapacity: 0,
  },
  farm: {
    label: 'Farm', hp: 480, w: 2, h: 2,
    cost: { wood: 60 }, time: 15, pop: 0,
    trains: [],
    attack: 0, meleeArmor: 0, pierceArmor: 0, lineOfSight: 1, range: 0, reload: 0, accuracy: 0, garrisonCapacity: 0, field: 170,
  },
  barracks: {
    label: 'Barracks', hp: 1200, w: 2, h: 2,
    cost: { wood: 175 }, time: 50, pop: 0,
    trains: ['militia'],
    attack: 0, meleeArmor: 0, pierceArmor: 7, lineOfSight: 6, range: 0, reload: 0, accuracy: 0, garrisonCapacity: 10,
  },
  lumber_camp: {
    label: 'Lumber Camp', hp: 1800, w: 1, h: 1,
    cost: { wood: 150 }, time: 40, pop: 0,
    trains: [],
    attack: 0, meleeArmor: 0, pierceArmor: 7, lineOfSight: 6, range: 0, reload: 0, accuracy: 0, garrisonCapacity: 0,
  },
  mining_camp: {
    label: 'Mining Camp', hp: 600, w: 1, h: 1,
    cost: { wood: 100 }, time: 35, pop: 0,
    trains: [],
    attack: 0, meleeArmor: 0, pierceArmor: 7, lineOfSight: 6, range: 0, reload: 0, accuracy: 0, garrisonCapacity: 0,
  },
  mill: {
    label: 'Mill', hp: 600, w: 2, h: 2,
    cost: { wood: 100 }, time: 35, pop: 0,
    trains: [],
    attack: 0, meleeArmor: 0, pierceArmor: 7, lineOfSight: 6, range: 0, reload: 0, accuracy: 0, garrisonCapacity: 0, field: 170,
  },
  archery_range: {
    label: 'Archery Range', hp: 1500, w: 2, h: 2,
    cost: { wood: 175 }, time: 50, pop: 0,
    trains: ['archer'],
    attack: 0, meleeArmor: 1, pierceArmor: 8, lineOfSight: 6, range: 0, reload: 0, accuracy: 0, garrisonCapacity: 10,
  },
  blacksmith: {
    label: 'Blacksmith', hp: 1800, w: 1, h: 1,
    cost: { wood: 150 }, time: 40, pop: 0,
    trains: [],
    attack: 0, meleeArmor: 0, pierceArmor: 7, lineOfSight: 6, range: 0, reload: 0, accuracy: 0, garrisonCapacity: 0, age: 1, noSprite: true,
  },
  market: {
    label: 'Market', hp: 1800, w: 2, h: 2,
    cost: { wood: 175 }, time: 60, pop: 0,
    trains: [],
    attack: 0, meleeArmor: 1, pierceArmor: 8, lineOfSight: 6, range: 0, reload: 0, accuracy: 100, garrisonCapacity: 10, age: 1, noSprite: true,
    trade: { sell: 33, buy: 67 },
  },
  watch_tower: {
    label: 'Watch Tower', hp: 850, w: 1, h: 1,
    cost: { wood: 35, stone: 125 }, time: 80, pop: 0,
    trains: [],
    attack: 5, meleeArmor: 1, pierceArmor: 7, lineOfSight: 10, range: 8, reload: 2, accuracy: 100, garrisonCapacity: 5, age: 1, noSprite: true,
  },
  barricade: {
    label: 'Barricade', hp: 150, w: 1, h: 1,
    cost: { wood: 3 }, time: 7, pop: 0,
    trains: [],
    attack: 0, meleeArmor: 2, pierceArmor: 5, lineOfSight: 2, range: 0, reload: 0, accuracy: 0, garrisonCapacity: 0, age: 1, noSprite: true,
  },
};

// GENERATED FROM data/techs.json -- edit the data or run `node tools/check-stats.mjs --write`.
const TECHS = {
  forge: {
    label: 'Forge', age: 1, building: 'blacksmith',
    cost: { food: 150 }, time: 50,
    atk: { melee: 1, pierce: 0 }, armor: { melee: 0, pierce: 0 },
  },
  scale_mail: {
    label: 'Scale Mail', age: 1, building: 'blacksmith',
    cost: { food: 100 }, time: 40,
    atk: { melee: 0, pierce: 0 }, armor: { melee: 1, pierce: 1 },
  },
  fletching: {
    label: 'Fletching', age: 1, building: 'blacksmith',
    cost: { food: 100, gold: 50 }, time: 30,
    atk: { melee: 0, pierce: 1 }, armor: { melee: 0, pierce: 0 },
  },
  bracer: {
    label: 'Bracer', age: 1, building: 'blacksmith',
    cost: { food: 300, gold: 200 }, time: 40,
    atk: { melee: 0, pierce: 0 }, armor: { melee: 0, pierce: 1 },
  },
};

const AGES = ['Dark Age', 'Feudal Age', 'Castle Age', 'Imperial Age'];
const SAVE_PATH = 'aoe2mini:save';
const MUTE_PATH = 'aoe2mini:muted';
/* touch: a press this long that stayed inside this many pixels is the right-click
   the desktop has. Hand-written beside SAVE_PATH/MUTE_PATH, not in CFG — that block
   is generated from data/units.json by tools/check-stats.mjs. */
const LONG_PRESS_MS = 600; const LONG_PRESS_SLOP = 8;

const T = { GRASS:0, WATER:1, FOREST:2, GOLD:3, STONE:4, BERRY:5 };

/* per-tile palettes; a per-tile hash picks the variant, so terrain looks
   textured without needing a single image asset */
const PAL = [
  ['#4d6a35','#4a6632','#516f38'],   // grass
  ['#2c527d','#2a5683','#315c8d'],   // water
  ['#33512b','#2f4d26','#37562d'],   // forest
  ['#6b6f79','#656a74','#757984'],   // gold ore
  ['#8d8f96','#84868d','#9a9ca3'],   // stone
  ['#7d4a55','#74454f','#87505c'],   // berry bush
];

const TEAM = [
  { name:'Blue', main:'#5b8fd6', dark:'#2f5f9e', light:'#a8cbf3' },
  { name:'Red',  main:'#d1584f', dark:'#9a3831', light:'#f2a89f' },
];

/* which resource a tile type yields */
const RES_OF_TILE = {
  [T.FOREST]: 'wood', [T.GOLD]: 'gold', [T.STONE]: 'stone', [T.BERRY]: 'food',
};
const CARRY_COLOR = {
  food:'#e7b16a', wood:'#9ec96f', gold:'#f0d264', stone:'#c6c8cf',
};

/* every sound the game can make, authored by hand like AGES: one row per
   sound, five fields each. `playSfx` (src/sound.js) synthesises the row and the
   checks in tools/checks/11-sound.js bind to the `fire` column, so the table is the contract
   both readers share. `freq` is the list one oscillator ramps through. */
const SFX = {
  hit:     { wave: 'triangle', freq: [170, 60],       dur: 0.14, gain: 0.35, fire: 'hitUnit' },
  arrow:   { wave: 'sawtooth', freq: [880, 320],      dur: 0.10, gain: 0.18, fire: 'spawnArrow' },
  build:   { wave: 'square',   freq: [220, 140],      dur: 0.20, gain: 0.25, fire: 'updateUnit' },
  age:     { wave: 'triangle', freq: [392, 523, 659], dur: 0.60, gain: 0.30, fire: 'upgradeAge' },
  victory: { wave: 'sawtooth', freq: [523, 659, 784], dur: 0.90, gain: 0.30, fire: 'setResult' },
  defeat:  { wave: 'sawtooth', freq: [392, 311, 262], dur: 1.10, gain: 0.28, fire: 'setResult' },
};
