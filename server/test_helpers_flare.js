'use strict';
// Flare Gun is an Instant a player may play at the START of another player's turn, so a dealt Flare Gun correctly makes
// _beginningPhase() stop and ask its holder first. Tests that deal random hands and then start a turn directly don't want
// that noise (it's covered by the dedicated Flare Gun tests), so they park any dealt Flare Gun at the bottom of the deck.
function stripFlareGuns(g) {
  for (const pid of g.playerOrder) {
    const keep = [];
    for (const c of g.players[pid].hand) (c.effect?.type === 'target_skip_beginning_and_draw' ? g.deck : keep).push(c);
    g.players[pid].hand = keep;
  }
  // startGame() itself begins the first turn, so an offer for a just-dealt Flare Gun may already be pending — clear it and
  // let that first Beginning phase carry on normally.
  if (g.pendingEffect?.type === 'flare_gun_offer') { g.pendingEffect = null; g._beginningPhaseBody(g.currentPlayer); }
  return g;
}
module.exports = { stripFlareGuns };
