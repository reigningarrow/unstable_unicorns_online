// cards.js — 2nd Edition Base Deck, built directly from CSV data

const CARD_TYPES = {
  BABY_UNICORN:    'baby_unicorn',
  BASIC_UNICORN:   'basic_unicorn',
  MAGICAL_UNICORN: 'magical_unicorn',
  MAGIC:           'magic',
  INSTANT:         'instant',
  UPGRADE:         'upgrade',
  DOWNGRADE:       'downgrade',
};

// Effect type tokens (used by game engine)
const EFFECTS = {
  DRAW:            'draw',
  DISCARD:         'discard',
  DESTROY:         'destroy',
  SACRIFICE:       'sacrifice',
  STEAL:           'steal',
  RETURN_TO_HAND:  'return_to_hand',
  RETURN_TO_DECK:  'return_to_deck',
  NEIGH:           'neigh',
  SEARCH_DECK:     'search_deck',
  FROM_DISCARD:    'from_discard',
  MOVE_CARD:       'move_card',
  TRADE_HANDS:     'trade_hands',
  SKIP_TURN:       'skip_turn',
  EXTRA_TURN:      'extra_turn',
  ALL_SACRIFICE:   'all_sacrifice',
  ALL_DISCARD:     'all_discard',
  COUNT_AS_TWO:    'count_as_two',
  PROTECTION:      'protection',
  NURSERY:         'nursery',
  PASSIVE:         'passive',
};

const COLORS = { WHITE:'white', YELLOW:'yellow', BLUE:'blue', PINK:'pink',
  ORANGE:'orange', GREEN:'green', RED:'red', PURPLE:'purple', RAINBOW:'rainbow' };

let _id = 1;
function makeCard(type, name, effect, description, emoji, qty, expansion) {
  const cards = [];
  for (let i = 0; i < qty; i++) {
    cards.push({ id: `c${_id++}`, type, name, effect, description: description || '', emoji: emoji || '🦄', expansion: expansion || null });
  }
  return cards;
}

function createDeck() {
  const cards = [];

  // ── Baby Unicorns (go to nursery) ────────────────────────────────────────
  const babies = [
    'Baby Unicorn (Red)','Baby Unicorn (Pink)','Baby Unicorn (Orange)','Baby Unicorn (Yellow)',
    'Baby Unicorn (Green)','Baby Unicorn (Blue)','Baby Unicorn (Purple)','Baby Unicorn (Black)',
    'Baby Unicorn (White)','Baby Unicorn (Brown)','Baby Unicorn (Rainbow)','Baby Unicorn (Death)',
    'Baby Narwhal',
  ];
  for (const name of babies) cards.push(...makeCard(CARD_TYPES.BABY_UNICORN, name, null, '', '🐴', 1));

  // ── Basic Unicorns ────────────────────────────────────────────────────────
  const basics = [
    'Basic Unicorn (Red)','Basic Unicorn (Orange)','Basic Unicorn (Yellow)',
    'Basic Unicorn (Green)','Basic Unicorn (Blue)','Basic Unicorn (Indigo)','Basic Unicorn (Purple)',
  ];
  for (const name of basics) cards.push(...makeCard(CARD_TYPES.BASIC_UNICORN, name, null, '', '🦄', 3));
  cards.push(...makeCard(CARD_TYPES.BASIC_UNICORN, 'Narwhal', null, '', '🐟', 1));

  // ── Magical Unicorns ──────────────────────────────────────────────────────
  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Alluring Narwhal',
    { trigger:'enter', type: EFFECTS.STEAL, targetType:'upgrade', optional:true },
    'When this card enters your Stable, you may STEAL an Upgrade card.', '🌊', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Americorn',
    { trigger:'enter', type:'pull_random_hand', optional:true },
    'When this card enters your Stable, you may pull a card at random from another player\'s hand.', '🇺🇸', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Annoying Flying Unicorn',
    { trigger:'enter', type:'force_discard', amount:1, optional:true, onLeave:{ type:'return_to_hand_self' } },
    'When this card enters your Stable, you may force another player to DISCARD a card. If sacrificed or destroyed, return to hand.', '😤', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Black Knight Unicorn',
    { trigger:'passive', type:'shield_from_destroy', cost:{ type:'sacrifice_self' } },
    'If a Unicorn in your Stable would be destroyed, you may SACRIFICE this card instead.', '⚔️', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Chainsaw Unicorn',
    { trigger:'enter', type:'destroy_upgrade_or_sacrifice_downgrade', optional:true },
    'When this card enters your Stable, you may DESTROY an Upgrade card or SACRIFICE a Downgrade card.', '🪚', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Classy Narwhal',
    { trigger:'enter', type: EFFECTS.SEARCH_DECK, targetType:'upgrade', addToHand:true, optional:true },
    'When this enters your Stable, you may search the deck for an Upgrade card, add it to hand, shuffle.', '🧐', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Dark Angel Unicorn',
    { trigger:'enter', type:'sacrifice_then_revive', optional:true },
    'When this enters your Stable, you may SACRIFICE a Unicorn, then bring a Unicorn from discard into Stable.', '😇', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Extremely Destructive Unicorn',
    { trigger:'enter', type: EFFECTS.ALL_SACRIFICE, targetType:'unicorn' },
    'When this enters your Stable, each player (including you) must SACRIFICE a Unicorn card.', '💥', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Ginormous Unicorn',
    { trigger:'passive', type: EFFECTS.COUNT_AS_TWO, restriction:'cannot_play_neigh' },
    'This card counts for 2 Unicorns. You cannot play any Neigh cards.', '🐘', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Greedy Flying Unicorn',
    { trigger:'enter', type: EFFECTS.DRAW, amount:1, onLeave:{ type:'return_to_hand_self' } },
    'When this enters your Stable, DRAW a card. If sacrificed or destroyed, return to hand.', '🤑', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Llamacorn',
    { trigger:'enter', type: EFFECTS.ALL_DISCARD, amount:1 },
    'When this enters your Stable, each player (including you) must DISCARD a card.', '🦙', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Magical Flying Unicorn',
    { trigger:'enter', type: EFFECTS.FROM_DISCARD, targetType:'magic', addToHand:true, optional:true },
    'When this enters your Stable, you may add a Magic card from the discard pile to your hand.', '✨', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Magical Kittencorn',
    { trigger:'passive', type: EFFECTS.PROTECTION, protectsFrom:'magic_destroy' },
    'This card cannot be destroyed by Magic cards.', '🐱', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Majestic Flying Unicorn',
    { trigger:'enter', type: EFFECTS.FROM_DISCARD, targetType:'unicorn', addToHand:true, optional:true, onLeave:{ type:'return_to_hand_self' } },
    'When this enters your Stable, you may add a Unicorn from discard to hand. If sacrificed/destroyed, return to hand.', '🦋', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Mother Goose Unicorn',
    { trigger:'enter', type: EFFECTS.NURSERY, optional:true },
    'When this enters your Stable, you may bring a Baby Unicorn from the Nursery into your Stable.', '🦢', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Mermaid Unicorn',
    { trigger:'enter', type: EFFECTS.RETURN_TO_HAND, targetType:'any', targetOwner:'opponent' },
    'When this enters your Stable, return a card in another player\'s Stable to their hand.', '🧜', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Narwhal Torpedo',
    { trigger:'enter', type:'sacrifice_all_own', targetType:'downgrade' },
    'When this enters your Stable, SACRIFICE all Downgrade cards in your Stable.', '🐟', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Necromancer Unicorn',
    { trigger:'enter', type:'discard_two_unicorns_revive', optional:true },
    'When this enters your Stable, you may DISCARD 2 Unicorn cards, then bring a Unicorn from discard into Stable.', '💀', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Queen Bee Unicorn',
    { trigger:'passive', type:'block_basic_to_others' },
    'Basic Unicorn cards cannot enter any player\'s Stable except yours.', '👑', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Rainbow Unicorn',
    { trigger:'enter', type:'play_basic_from_hand', optional:true },
    'When this enters your Stable, you may bring a Basic Unicorn card from your hand into your Stable.', '🌈', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Rhinocorn',
    { trigger:'beginning', type: EFFECTS.DESTROY, targetType:'unicorn', optional:true, cost:{ type:'end_turn' } },
    'At the beginning of your turn, you may DESTROY a Unicorn card, then immediately end your turn.', '🦏', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Seductive Unicorn',
    { trigger:'enter', type:'discard_then_steal', targetType:'unicorn', optional:true },
    'When this enters your Stable, you may DISCARD a card, then STEAL a Unicorn card.', '💋', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Shabby the Narwhal',
    { trigger:'enter', type: EFFECTS.SEARCH_DECK, targetType:'downgrade', addToHand:true, optional:true },
    'When this enters your Stable, you may search the deck for a Downgrade card, add to hand, shuffle.', '🐟', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Shark With a Horn',
    { trigger:'enter', type:'sacrifice_self_destroy_unicorn', optional:true },
    'When this enters your Stable, you may SACRIFICE this card, then DESTROY a Unicorn card.', '🦈', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Stabby the Unicorn',
    { trigger:'on_leave', type: EFFECTS.DESTROY, targetType:'unicorn', optional:true },
    'If this card is sacrificed or destroyed, you may DESTROY a Unicorn card.', '🗡️', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Swift Flying Unicorn',
    { trigger:'enter', type: EFFECTS.FROM_DISCARD, targetType:'neigh', addToHand:true, optional:true, onLeave:{ type:'return_to_hand_self' } },
    'When this enters your Stable, you may add a Neigh card from discard to hand. If sacrificed/destroyed, return to hand.', '💨', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'The Great Narwhal',
    { trigger:'enter', type:'search_deck_by_name', nameContains:'Narwhal', addToHand:true, optional:true },
    'When this enters your Stable, you may search the deck for a card with "Narwhal" in its name, add to hand, shuffle.', '🐳', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Unicorn on the Cob',
    { trigger:'enter', type:'draw_discard', draw:2, discard:1 },
    'When this enters your Stable, DRAW 2 cards and DISCARD a card.', '🌽', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Unicorn Oracle',
    { trigger:'enter', type:'look_top_keep_one', amount:3 },
    'When this enters your Stable, look at top 3 cards of deck, add one to hand, return other two in any order.', '🔮', 1));

  cards.push(...makeCard(CARD_TYPES.MAGICAL_UNICORN, 'Unicorn Phoenix',
    { trigger:'on_would_sac_destroy', type:'discard_instead', optional:true },
    'If this card would be sacrificed or destroyed, you may DISCARD a card instead.', '🔥', 1));

  // ── Magic Cards ───────────────────────────────────────────────────────────
  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Back Kick',
    { type: EFFECTS.RETURN_TO_HAND, targetType:'any', targetOwner:'opponent', thenDiscard:{ owner:'target', amount:1 } },
    'Return a card in another player\'s Stable to their hand. That player must DISCARD a card.', '🦵', 3));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Blatant Thievery',
    { type:'look_hand_take_one' },
    'Look at another player\'s hand. Choose a card and add it to your hand.', '🕵️', 1));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Change of Luck',
    { type:'draw_discard_extra_turn', draw:2, discard:3 },
    'DRAW 2 cards and DISCARD 3 cards, then take another turn.', '🍀', 2));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Glitter Tornado',
    { type:'return_one_each_stable' },
    'Return a card in each player\'s Stable (including yours) to their hand.', '🌪️', 2));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Good Deal',
    { type:'draw_discard', draw:3, discard:1 },
    'DRAW 3 cards and DISCARD a card.', '🤝', 1));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Kiss of Life',
    { type: EFFECTS.FROM_DISCARD, targetType:'unicorn', intoStable:true },
    'Bring a Unicorn card from the discard pile into your Stable.', '💋', 1));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Mystical Vortex',
    { type:'all_discard_one_shuffle_discard' },
    'Each player (including you) must DISCARD a card. Shuffle the discard pile into the deck.', '🌀', 1));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Re-Target',
    { type:'move_upgrade_or_downgrade_between_stables' },
    'Move an Upgrade or Downgrade card from any player\'s Stable to any other player\'s Stable.', '🎯', 2));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Reset Button',
    { type:'all_sacrifice_upgrades_downgrades_shuffle' },
    'Each player must SACRIFICE all Upgrade and Downgrade cards in their Stable. Shuffle discard into deck.', '🔄', 1));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Shake Up',
    { type:'shuffle_hand_discard_draw5' },
    'Shuffle this card, your hand, and the discard pile into the deck. DRAW 5 cards.', '🎲', 1));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Targeted Destruction',
    { type:'destroy_upgrade_or_sacrifice_downgrade' },
    'DESTROY an Upgrade card or SACRIFICE a Downgrade card.', '💣', 1));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Two-For-One',
    { type:'sacrifice_then_destroy_two' },
    'SACRIFICE a card, then DESTROY 2 cards.', '✌️', 2));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Unfair Bargain',
    { type: EFFECTS.TRADE_HANDS },
    'Trade hands with any other player.', '🤦', 2));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Unicorn Poison',
    { type: EFFECTS.DESTROY, targetType:'unicorn' },
    'DESTROY a Unicorn card.', '🧪', 3));

  cards.push(...makeCard(CARD_TYPES.MAGIC, 'Unicorn Swap',
    { type:'move_own_unicorn_steal_unicorn' },
    'Move a Unicorn in your Stable to another player\'s Stable, then STEAL a Unicorn from that player\'s Stable.', '🔁', 2));

  // ── Upgrade Cards ─────────────────────────────────────────────────────────
  cards.push(...makeCard(CARD_TYPES.UPGRADE, 'Caffeine Overload',
    { trigger:'beginning', type:'sacrifice_then_draw', sacrifice:1, draw:2, optional:true },
    'At the beginning of your turn, you may SACRIFICE a card, then DRAW 2 cards.', '☕', 1));

  cards.push(...makeCard(CARD_TYPES.UPGRADE, 'Claw Machine',
    { trigger:'beginning', type:'discard_then_draw', discard:1, draw:1, optional:true },
    'At the beginning of your turn, you may DISCARD a card, then DRAW a card.', '🕹️', 3));

  cards.push(...makeCard(CARD_TYPES.UPGRADE, 'Double Dutch',
    { trigger:'beginning', type:'play_two_cards', optional:true },
    'At the beginning of your turn, you may play 2 cards during your Action phase.', '🎪', 1));

  cards.push(...makeCard(CARD_TYPES.UPGRADE, 'Glitter Bomb',
    { trigger:'beginning', type:'sacrifice_then_destroy', sacrifice:1, destroy:1, optional:true },
    'At the beginning of your turn, you may SACRIFICE a card, then DESTROY a card.', '✨', 2));

  cards.push(...makeCard(CARD_TYPES.UPGRADE, 'Rainbow Aura',
    { trigger:'passive', type: EFFECTS.PROTECTION, protectsFrom:'destroy' },
    'Your Unicorn cards cannot be destroyed.', '🌈', 1));

  cards.push(...makeCard(CARD_TYPES.UPGRADE, 'Rainbow Lasso',
    { trigger:'beginning', type:'discard_three_steal_unicorn', discard:3, optional:true },
    'At the beginning of your turn, you may DISCARD 3 cards, then STEAL a Unicorn card.', '🤠', 1));

  cards.push(...makeCard(CARD_TYPES.UPGRADE, 'Stable Artillery',
    { trigger:'beginning', type:'discard_two_destroy_unicorn', discard:2, optional:true },
    'At the beginning of your turn, you may DISCARD 2 cards, then DESTROY a Unicorn card.', '💣', 3));

  cards.push(...makeCard(CARD_TYPES.UPGRADE, 'Yay',
    { trigger:'passive', type:'cards_cannot_be_neighed' },
    'Cards you play cannot be Neigh\'d.', '🎉', 2));

  // ── Downgrade Cards ───────────────────────────────────────────────────────
  cards.push(...makeCard(CARD_TYPES.DOWNGRADE, 'Barbed Wire',
    { trigger:'on_unicorn_enter_or_leave', type: EFFECTS.DISCARD, amount:1 },
    'Each time a Unicorn card enters or leaves your Stable, DISCARD a card.', '🪡', 1));

  cards.push(...makeCard(CARD_TYPES.DOWNGRADE, 'Pandamonium',
    { trigger:'passive', type:'unicorns_are_pandas' },
    'All of your Unicorns are considered Pandas. Cards that affect Unicorn cards do not affect your Pandas.', '🐼', 1));

  cards.push(...makeCard(CARD_TYPES.DOWNGRADE, 'Sadistic Ritual',
    { trigger:'beginning', type:'sacrifice_unicorn_draw', sacrifice:1, draw:1 },
    'At the beginning of your turn, SACRIFICE a Unicorn card, then DRAW a card.', '🩸', 1));

  cards.push(...makeCard(CARD_TYPES.DOWNGRADE, 'Slowdown',
    { trigger:'passive', type:'cannot_play_neigh' },
    'You cannot play Neigh cards.', '🐌', 1));

  cards.push(...makeCard(CARD_TYPES.DOWNGRADE, 'Nanny Cam',
    { trigger:'passive', type:'hand_visible' },
    'Your hand must be visible to all players.', '📷', 1));

  cards.push(...makeCard(CARD_TYPES.DOWNGRADE, 'Broken Stable',
    { trigger:'passive', type:'cannot_play_upgrades' },
    'You cannot play Upgrade cards.', '🔨', 1));

  cards.push(...makeCard(CARD_TYPES.DOWNGRADE, 'Blinding Light',
    { trigger:'passive', type:'unicorns_are_basic' },
    'All of your Unicorn cards are considered Basic Unicorns with no effects.', '💡', 1));

  cards.push(...makeCard(CARD_TYPES.DOWNGRADE, 'Tiny Stable',
    { trigger:'passive', type:'tiny_stable_limit', limit:5 },
    'If at any time you have more than 5 Unicorns in your Stable, SACRIFICE a Unicorn card.', '🏚️', 1));

  // ── Instant Cards ─────────────────────────────────────────────────────────
  cards.push(...makeCard(CARD_TYPES.INSTANT, 'Neigh',
    { type: EFFECTS.NEIGH, super:false },
    'Play when another player tries to play a card. Stop their card from being played.', '🙅', 14));

  cards.push(...makeCard(CARD_TYPES.INSTANT, 'Super Neigh',
    { type: EFFECTS.NEIGH, super:true },
    'Stop a card from being played. This card cannot be Neigh\'d.', '🛑', 1));

  return cards;
}

function createBabyUnicornDeck() {
  // Returns just the baby unicorns for the nursery (non-expansion)
  return createDeck().filter(c => c.type === CARD_TYPES.BABY_UNICORN);
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { createDeck, createBabyUnicornDeck, shuffle, CARD_TYPES, EFFECTS, COLORS };
