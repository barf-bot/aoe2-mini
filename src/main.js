'use strict';
/* main -- the public surface and the boot call. Must be the last script.
   Node has no window: tools/lib/load-game.js runs the same script list and reads `AoE2`
   out of the shared scope, which is how every tool in tools/ drives the game. */

const AoE2 = {
  CFG, KINDS, BLD, TECHS, AGES, T, PAL, TEAM, RES_OF_TILE, SFX, MUTE_PATH,
  SPRITE_SHEET, SPRITES, WORK_ANIM, spriteFor, BLD_SPRITES, bldSpriteFor,
  makeWorld, findSite, berryCluster, tileRes, sourceFromTile, sourceFromFarm, workSpot,
  makeUnit, makeBuilding, removeBuilding, walkable, workPos, standingSpots, reachOf,
  tileOf, findPath, formationSlots, separate,
  setAtlas, createState, boot, beginCanvas, loadAtlas, stepGame, stepSim, renderFrame, playSfx, isMuted,
  unitAnim,
  build, canPlaceAt, cancelConstruction, demolish, train, researchTech, trade, issueOrder, upgradeAge, upgradeBuilding, promoteBuilding, garrisonUnits, leaveBuilding, orderForUnit, siteFree, toast,
  hitUnit, hitBuilding, unitAttack, unitArmor, autoAcquire, attackableAsEnemy, targetableAsEnemy, spawnArrow, updateProjectiles, stepBuildingAttacks,
  pickUnit, unitsInBox,
  popCap, popUsed, popCommitted, selectedUnits, canAfford, spend, refund, resetGame,
  SAVE_PATH, saveGame, loadGame, markDirty, storageGet, storageSet, applyMuteButton, setMuted,
  infoHtml, hudState, hudHtml, commandsHtml, queueHtml, resultHtml,
  findDropoff, dropTargetScore, nextSource, resumeGather, depleteTile, workersOnTile,
};

if (typeof window !== 'undefined') {
  window.AoE2 = AoE2;
  if (typeof document !== 'undefined' && document.getElementById('view')) window.Game = boot(document);
}
