// expansions.js — All expansion packs built from CSV data
const { CARD_TYPES, EFFECTS } = require('./cards');

let _expId = 10000;
function eid() { return `e${_expId++}`; }
function c(type, name, effect, description, emoji, qty, expansion) {
  const cards = [];
  for (let i = 0; i < qty; i++) {
    cards.push({ id: eid(), type, name, effect: effect || null, description: description || '', emoji: emoji || '🦄', expansion });
  }
  return cards;
}
const BU = CARD_TYPES.BABY_UNICORN, BS = CARD_TYPES.BASIC_UNICORN,
      MU = CARD_TYPES.MAGICAL_UNICORN, MA = CARD_TYPES.MAGIC,
      IN = CARD_TYPES.INSTANT, UP = CARD_TYPES.UPGRADE, DN = CARD_TYPES.DOWNGRADE;

// ─── DRAGONS EXPANSION ───────────────────────────────────────────────────────
function dragonsExpansion() {
  const X = 'dragons';
  return [
    ...c(BU,'Baby Dragoncorn (Black)',null,'',  '🐲',1,X),
    ...c(BU,'Baby Dragoncorn (Blue)', null,'',  '🐲',1,X),
    ...c(BU,'Baby Dragoncorn (Green)',null,'',  '🐲',1,X),
    ...c(BU,'Baby Dragoncorn (Orange)',null,'', '🐲',1,X),
    ...c(BU,'Baby Dragoncorn (Pink)', null,'',  '🐲',1,X),
    ...c(BU,'Baby Dragoncorn (Red)',  null,'',  '🐲',1,X),

    ...c(BS,'Apprentice Unicorn',  null,'','🎓',3,X),
    ...c(BS,'Dragon Cosplay Unicorn', null,'','🎭',3,X),
    ...c(BS,'High Roller Unicorn', null,'','🎲',3,X),
    ...c(BS,'Unicorn With a Dragon Tattoo', null,'','🔱',3,X),

    ...c(MU,'Angry Dragoncorn',
      { trigger:'enter', type: EFFECTS.ALL_DISCARD, amount:1 },
      'When this card enters your Stable, each player (including you) must DISCARD a card.','😡',1,X),

    ...c(MU,'Dragon Rider Unicorn',
      { trigger:'enter', type:'move_upgrade_or_downgrade_between_stables', optional:true },
      'When this card enters your Stable, you may move an Upgrade or Downgrade card from any player\'s Stable to any other player\'s Stable.','🏇',1,X),

    ...c(MU,'Dragon Slayer Unicorn',
      { trigger:'passive', type:'protection_from_dragon_destroy' },
      'Your Unicorn cards cannot be destroyed by the effect of any card with "Dragon" in its name.','⚔️',1,X),

    ...c(MU,'Dragon Summoner Unicorn',
      { trigger:'enter', type: EFFECTS.FROM_DISCARD, nameContains:'Dragon', addToHand:true, optional:true },
      'When this enters your Stable, you may add a card with "Dragon" in its name from the discard pile to your hand.','📜',1,X),

    ...c(MU,'Dragon Tamer Unicorn',
      { trigger:'enter', type: EFFECTS.SEARCH_DECK, nameContains:'Dragon', addToHand:true, optional:true },
      'When this enters your Stable, you may search the deck for a card with "Dragon" in its name, add to hand, shuffle.','🎪',1,X),

    ...c(MU,'Dragon Turtle Unicorn',
      { trigger:'enter', type: EFFECTS.DRAW, amount:1, optional:true },
      'When this enters your Stable, you may DRAW a card.','🐢',1,X),

    ...c(MU,'Dragon Unicorn',
      { trigger:'on_leave', type: EFFECTS.DESTROY, targetType:'unicorn', optional:true },
      'When this card leaves your Stable, you may DESTROY a Unicorn card.','🐉',1,X),

    ...c(MU,'Friendly Dragoncorn',
      { trigger:'enter', type:'all_may_draw', amount:1 },
      'When this enters your Stable, each player (including you) may DRAW a card.','🌸',1,X),

    ...c(MU,'Mage Unicorn',
      { trigger:'enter', type: EFFECTS.SEARCH_DECK, targetType:'magic', addToHand:true, optional:true },
      'When this enters your Stable, you may search the deck for a Magic card, add to hand, shuffle.','🧙',1,X),

    ...c(MU,'Scaled Flying Unicorn',
      { trigger:'enter', type: EFFECTS.ALL_SACRIFICE, targetType:'any', onLeave:{ type:'return_to_hand_self' } },
      'When this enters your Stable, each player (including you) must SACRIFICE a card. If sacrificed or destroyed, return to hand.','🪽',1,X),

    ...c(MA,'Dragon\'s Breath',
      { type: EFFECTS.DESTROY, targetType:'unicorn' },
      'DESTROY a Unicorn card.','💨',3,X),

    ...c(MA,'Dragon\'s Fire',
      { type:'destroy_upgrade_or_sacrifice_downgrade' },
      'DESTROY an Upgrade card or SACRIFICE a Downgrade card.','🔥',3,X),

    ...c(MA,'Dragon Kiss',
      { type:'search_deck_magic_play_immediately' },
      'Search the deck for a Magic card, add to hand. Immediately play it, then shuffle.','💋',2,X),

    ...c(MA,'Dragon-Scorched Stables',
      { type:'all_sacrifice_upgrades_downgrades' },
      'Each player (including you) must SACRIFICE all Upgrade and Downgrade cards in their Stable.','🏚️',1,X),

    ...c(IN,'Neigh, Foul Beast',
      { type: EFFECTS.NEIGH, super:false },
      'Stop a card from being played and send it to the discard pile.','🙅',6,X),

    ...c(UP,'Dragon\'s Blessing',
      { trigger:'passive', type:'downgrades_have_no_effect' },
      'Downgrade cards in your Stable have no effect.','✨',2,X),

    ...c(UP,'Dragon\'s Fortune',
      { trigger:'beginning', type:'sacrifice_self_take_extra_turn', optional:true },
      'At the beginning of your turn, you may SACRIFICE this card, then take another turn.','💰',2,X),

    ...c(UP,'Dragon Protection',
      { trigger:'passive', type:'discard_instead_of_destroy', optional:true },
      'If a card in your Stable would be destroyed, you may DISCARD a card instead.','🛡️',2,X),

    ...c(DN,'Dragon\'s Curse',
      { trigger:'beginning', type: EFFECTS.DISCARD, amount:1 },
      'At the beginning of your turn, DISCARD a card.','🩸',2,X),

    ...c(DN,'Dragon\'s Misfortune',
      { trigger:'beginning', type:'move_hand_card_to_bottom_deck' },
      'At the beginning of your turn, move a card from your hand to the bottom of the deck.','☠️',2,X),

    ...c(DN,'Dragon Skies',
      { trigger:'beginning', type:'move_unicorn_to_deck_draw' },
      'At the beginning of your turn, move a Unicorn from your Stable to the bottom of the deck, then DRAW a card.','☁️',1,X),
  ];
}

// ─── UNICORNS OF LEGEND EXPANSION ────────────────────────────────────────────
function unicornsOfLegendExpansion() {
  const X = 'unicorns_of_legend';
  return [
    ...c(BU,'Baby Dwarficorn',  null,'','⛏️',1,X),
    ...c(BU,'Baby Elficorn',    null,'','🧝',1,X),
    ...c(BU,'Baby Gnomicorn',   null,'','🍄',1,X),
    ...c(BU,'Baby Orcicorn',    null,'','💪',1,X),

    ...c(BS,'Guardsman Unicorn', null,'','🛡️',3,X),
    ...c(BS,'Blacksmith Unicorn',null,'','🔨',3,X),
    ...c(BS,'Innkeeper Unicorn', null,'','🏠',3,X),
    ...c(BS,'Noble Unicorn',     null,'','👑',3,X),

    ...c(MU,'Beast Master Unicorn',
      { trigger:'beginning', type: EFFECTS.NURSERY, optional:true, cost:{ type:'skip_draw' } },
      'At the beginning of your turn, you may bring a Baby Unicorn from the Nursery into your Stable. If you do, skip your Draw phase.','🐾',1,X),

    ...c(MU,'Berserkercorn',
      { trigger:'enter', type: EFFECTS.DESTROY, targetType:'unicorn', optional:true,
        onLeave:{ type:'sacrifice_unicorn_on_destroy' } },
      'When this enters your Stable, you may DESTROY a Unicorn card. If this card is destroyed, SACRIFICE a Unicorn card.','🪓',1,X),

    ...c(MU,'Charming Bardicorn',
      { trigger:'beginning', type:'move_self_steal_and_draw', optional:true },
      'At the beginning of your turn, you may move this card to another player\'s Stable, then STEAL a Unicorn from that player\'s Stable and DRAW a card.','🎵',1,X),

    ...c(MU,'Divine Unicorn',
      { trigger:'enter', type:'look_top_keep_one', amount:3, discardRest:true, optional:true },
      'When this enters your Stable, you may look at top 3 cards of deck, add one to hand, DISCARD the other two.','☀️',1,X),

    ...c(MU,'Dwarficorn Artificer',
      { trigger:'enter', type:'discard_then_search_upgrade_into_stable', optional:true },
      'When this enters your Stable, you may DISCARD a card. If you do, search the deck for an Upgrade card, bring it into your Stable, shuffle.','⚒️',1,X),

    ...c(MU,'Elficorn Scout',
      { trigger:'enter', type:'look_top_return_any_order', amount:3 },
      'When this enters your Stable, look at top 3 cards of deck and return them in any order.','🏹',1,X),

    ...c(MU,'Orcicorn Raider',
      { trigger:'enter', type:'move_downgrade_steal_upgrade', optional:true },
      'When this enters your Stable, you may move a Downgrade from your Stable to another player\'s Stable, then STEAL an Upgrade from that player\'s Stable.','⚔️',1,X),

    ...c(MU,'Paladin Unicorn',
      { trigger:'enter', type: EFFECTS.DESTROY, targetType:'any', optional:true,
        passive:{ type:'cannot_steal' } },
      'When this enters your Stable, you may DESTROY a card. You cannot STEAL cards.','⚔️',1,X),

    ...c(MU,'Rogue Unicorn',
      { trigger:'enter', type:'discard_two_steal_any', optional:true },
      'When this enters your Stable, you may DISCARD 2 cards, then STEAL a card.','🗡️',1,X),

    ...c(MU,'Warlock Unicorn',
      { trigger:'enter', type:'sacrifice_n_destroy_n', optional:true },
      'When this enters your Stable, you may SACRIFICE any number of cards, then DESTROY the same number of cards.','🧙',1,X),

    ...c(MU,'Wizard Unicorn',
      { trigger:'enter', type:'discard_search_magic_play', optional:true },
      'When this enters your Stable, you may DISCARD a card. If you do, search the deck for a Magic card, add to hand, immediately play it, shuffle.','🪄',1,X),

    ...c(MA,'Alignment Change',
      { type:'discard_two_steal_unicorn' },
      'DISCARD 2 cards, then STEAL a Unicorn card.','⚖️',2,X),

    ...c(MA,'Chain Lightning',
      { type:'destroy_then_target_may_destroy' },
      'DESTROY a card in another player\'s Stable. That player may then DESTROY a card.','⚡',2,X),

    ...c(MA,'Fireball',
      { type: EFFECTS.ALL_SACRIFICE, targetType:'unicorn' },
      'Each player (including you) must SACRIFICE a Unicorn card.','🔥',1,X),

    ...c(MA,'Necromancy',
      { type:'sacrifice_unicorn_revive_unicorn' },
      'SACRIFICE a Unicorn card, then bring a Unicorn card from the discard pile directly into your Stable.','💀',1,X),

    ...c(MA,'Prismatic Bray',
      { type:'discard_up_to_two_force_sacrifice', optional:true },
      'DISCARD up to 2 cards, then force up to 2 players to SACRIFICE a Unicorn card.','🌈',2,X),

    ...c(MA,'Raze the Stables',
      { type:'destroy_upgrade_or_sacrifice_downgrade' },
      'DESTROY an Upgrade or SACRIFICE a Downgrade card.','⚔️',3,X),

    ...c(IN,'Neigh, M\'Lord',
      { type: EFFECTS.NEIGH, super:false, neighTarget_may_draw:true },
      'Stop a card from being played. That player may DRAW a card.','🎩',2,X),

    ...c(IN,'Neigh, Peasant',
      { type: EFFECTS.NEIGH, super:false, neighTarget_must_discard:true },
      'Stop a card from being played. That player must DISCARD a card.','👨',2,X),

    ...c(IN,'Neigh, Scoundrel',
      { type: EFFECTS.NEIGH, super:false },
      'Stop a card from being played and send it to the discard pile.','🏴‍☠️',2,X),

    ...c(UP,'Critical Hit',
      { trigger:'on_magic_play', type:'sacrifice_self_replay_magic', optional:true },
      'When you play a Magic card, you may SACRIFICE this card. If you do, return the Magic card to your hand and immediately play it.','⚔️',2,X),

    ...c(UP,'Extradimensional Saddlebag',
      { trigger:'passive', type:'increase_hand_limit', amount:3 },
      'Your hand limit is increased by 3 cards.','🎒',1,X),

    ...c(UP,'Wall of Horns',
      { trigger:'on_unicorn_destroyed', type:'pull_random_from_attacker', optional:true },
      'Each time another player destroys a Unicorn in your Stable, you may pull a card at random from that player\'s hand.','🔱',1,X),

    ...c(DN,'Divine Peace',
      { trigger:'passive', type:'cannot_destroy' },
      'You cannot DESTROY cards.','☮️',2,X),

    ...c(DN,'Hex',
      { trigger:'beginning', type:'skip_draw',
        passive:{ type:'move_to_other_if_hand_empty' } },
      'At the beginning of your turn, skip your Draw phase. If you have no cards in hand, move this card to any other player\'s Stable.','🔮',2,X),

    ...c(DN,'Medieval Sanitation',
      { trigger:'passive', type:'unicorns_are_basic' },
      'Unicorn cards in your Stable are considered Basic Unicorns with no effects.','🪣',2,X),
  ];
}

// ─── RAINBOW APOCALYPSE EXPANSION ────────────────────────────────────────────
function rainbowApocalypseExpansion() {
  const X = 'rainbow_apocalypse';
  return [
    ...c(BU,'Baby Unicorn (Flowers)', null,'','🌸',1,X),
    ...c(BU,'Baby Unicorn (Sparkles)',null,'','✨',1,X),

    ...c(BS,'Horse With An Ice Cream Cone', null,'','🍦',3,X),
    ...c(BS,'Innocent Bunnicorn',           null,'','🐰',3,X),

    ...c(MU,'Adorable Flying Unicorn',
      { trigger:'enter', type: EFFECTS.ALL_SACRIFICE, targetType:'any', onLeave:{ type:'return_to_hand_self' } },
      'When this enters your Stable, each player (including you) must SACRIFICE a card. If sacrificed or destroyed, return to hand.','🥰',1,X),

    ...c(MU,'Angel Unicorn',
      { trigger:'beginning', type:'sacrifice_self_revive_unicorn', optional:true },
      'At the beginning of your turn, you may SACRIFICE this card, then bring a Unicorn from the discard pile into your Stable.','😇',2,X),

    ...c(MU,'Cotton Candy Llamacorn',
      { trigger:'enter', type:'all_sacrifice_unicorn_draw' },
      'When this enters your Stable, each player (including you) must SACRIFICE a Unicorn card, then DRAW a card.','🍬',1,X),

    ...c(MU,'Extremely Destructive Unicorn',
      { trigger:'enter', type: EFFECTS.ALL_SACRIFICE, targetType:'unicorn' },
      'When this enters your Stable, each player (including you) must SACRIFICE a Unicorn card.','💥',2,X),

    ...c(MU,'Extremely Fertile Unicorn',
      { trigger:'beginning', type:'discard_then_nursery', optional:true },
      'At the beginning of your turn, you may DISCARD a card, then bring a Baby Unicorn from the Nursery into your Stable.','🌱',2,X),

    ...c(MU,'Frenchiecorn',
      { trigger:'enter', type:'all_discard_take_one' },
      'When this enters your Stable, each other player must DISCARD a card. Choose one of the discarded cards and add it to your hand.','🥐',1,X),

    ...c(MU,'Glitter Unicorn',
      { trigger:'enter', type:'play_upgrade_from_hand', optional:true },
      'When this enters your Stable, you may bring an Upgrade card from your hand into your Stable.','✨',1,X),

    ...c(MU,'Llamacorn',
      { trigger:'enter', type: EFFECTS.ALL_DISCARD, amount:1 },
      'When this enters your Stable, each player (including you) must DISCARD a card.','🦙',2,X),

    ...c(MU,'Magical Kittencorn',
      { trigger:'passive', type: EFFECTS.PROTECTION, protectsFrom:'magic_destroy' },
      'This card cannot be destroyed by Magic cards.','🐱',2,X),

    ...c(MU,'The Tiniest Unicorn',
      { trigger:'passive', type:'protection_from_unicorn_upgrade_effects' },
      'This card cannot be destroyed by effects of Unicorn or Upgrade cards.','🤏',1,X),

    ...c(MU,'Unicorn of Death',
      { trigger:'beginning', type:'sacrifice_unicorn_destroy_unicorn', optional:true },
      'At the beginning of your turn, you may SACRIFICE a Unicorn card, then DESTROY a Unicorn card.','💀',1,X),

    ...c(MU,'Unicorn of Famine',
      { trigger:'passive', type:'all_hand_limit_reduce', amount:5 },
      'Each player\'s hand limit (including yours) is reduced by 5 cards.','🍂',1,X),

    ...c(MU,'Unicorn of Pestilence',
      { trigger:'enter', type:'discard_n_others_discard_n' },
      'When this enters your Stable, DISCARD any number of cards. Each other player must DISCARD the same number.','☣️',1,X),

    ...c(MU,'Unicorn of War',
      { trigger:'enter', type:'all_may_destroy_unicorn',
        passive:{ type:'cannot_be_destroyed' } },
      'When this enters your Stable, each player (including you) may DESTROY a Unicorn card. This card cannot be destroyed.','⚔️',1,X),

    ...c(MU,'Unicorn Phoenix',
      { trigger:'on_would_sac_destroy', type:'discard_instead', optional:true },
      'If this card would be sacrificed or destroyed, you may DISCARD a card instead.','🔥',2,X),

    ...c(MU,'Unicorn Rainbow Princess',
      { trigger:'enter', type:'choose_players_draw_each' },
      'When this enters your Stable, choose any number of players. DRAW cards equal to chosen players. Each chosen player may DRAW a card.','🌈',1,X),

    ...c(MU,'Zombie Unicorn',
      { trigger:'beginning', type:'discard_unicorn_revive_unicorn_end_turn', optional:true },
      'At the beginning of your turn, you may DISCARD a Unicorn card, then bring a Unicorn from discard into Stable. If you do, immediately end your turn.','🧟',2,X),

    ...c(MA,'A Cute Attack',
      { type:'destroy_three_add_three_babies' },
      'Choose another player. DESTROY 3 Unicorn cards in that player\'s Stable and bring 3 Baby Unicorn cards from the Nursery into that player\'s Stable.','🥺',2,X),

    ...c(MA,'Fire and Brimstone',
      { type:'apocalypse_sacrifice_all_destroy_each_search', searchFor:'Unicorn Phoenix' },
      'SACRIFICE all your Unicorns, then DESTROY a Unicorn in each other player\'s Stable. Search deck for a Unicorn Phoenix card, bring it into your Stable.','🌋',1,X),

    ...c(MA,'Unicorns of the Apocalypse',
      { type:'sacrifice_four_search_four' },
      'SACRIFICE 4 Unicorn cards, then search the deck for 4 Unicorn cards and bring them into your Stable. Shuffle the deck.','🌪️',1,X),

    ...c(MA,'Plague of Death',
      { type:'sacrifice_n_destroy_n' },
      'SACRIFICE any number of cards, then DESTROY the same number of cards.','💀',1,X),

    ...c(MA,'Spray Bottle of Youth',
      { type:'destroy_each_opponent_unicorn_offer_babies' },
      'DESTROY a Unicorn card in each other player\'s Stable. Each other player may bring a Baby Unicorn from the Nursery into their Stable.','💦',1,X),

    ...c(MA,'Unicorn Nap',
      { type: EFFECTS.SKIP_TURN, targetOwner:'opponent' },
      'Force another player to skip their next turn.','😴',2,X),

    ...c(MA,'Zombie Apocalypse',
      { type:'apocalypse_sacrifice_all_destroy_each_search', searchFor:'Zombie Unicorn' },
      'SACRIFICE all your Unicorns, then DESTROY a Unicorn in each other player\'s Stable. Search deck for Zombie Unicorn, bring into Stable.','🧟',1,X),

    ...c(IN,'Neigh, Thank You',
      { type: EFFECTS.NEIGH, super:false, both_may_draw:true },
      'Stop a card from being played. Both you and that player may DRAW a card.','🙏',3,X),

    ...c(UP,'Rainbow Sprinkles',
      { trigger:'beginning', type:'draw_three_end_turn', optional:true },
      'At the beginning of your turn, you may DRAW 3 cards. If you do, immediately end your turn.','🌈',2,X),

    ...c(UP,'Special Delivery',
      { trigger:'beginning', type:'nursery_skip_action', optional:true },
      'At the beginning of your turn, you may bring a Baby Unicorn from the Nursery into your Stable. If you do, skip your Action phase.','📦',2,X),

    ...c(DN,'Tiny Hooves',
      { trigger:'passive', type:'reduce_hand_limit', amount:4 },
      'Your hand limit is reduced by 4 cards.','🐾',1,X),
  ];
}

// ─── ADVENTURES EXPANSION ────────────────────────────────────────────────────
function adventuresExpansion() {
  const X = 'adventures';
  return [
    ...c(BU,'Baby Unicorn (Fisherman)', null,'','🎣',1,X),
    ...c(BU,'Baby Unicorn (Forest)',    null,'','🌲',1,X),
    ...c(BU,'Baby Unicorn (Pirate)',    null,'','🏴‍☠️',1,X),
    ...c(BU,'Baby Unicorn (Safari)',    null,'','🦁',1,X),

    ...c(BS,'Eager Adventurer Unicorn', null,'','🎒',3,X),
    ...c(BS,'Glamping Unicorn',         null,'','⛺',3,X),
    ...c(BS,'Indoor Rockclimber Unicorn',null,'','🧗',3,X),
    ...c(BS,'Land Lubber Unicorn',      null,'','🗺️',3,X),

    ...c(MU,'Bungee Jumping Unicorn',
      { trigger:'on_leave', type:'choice_sacrifice_downgrade_or_return_hand', optional:true },
      'If sacrificed or destroyed, you may: SACRIFICE a Downgrade card OR return this card to your hand.','🪂',1,X),

    ...c(MU,'Cutthroat Captain Unicorn',
      { trigger:'enter', type:'choice_steal_baby_or_revive_basic', optional:true },
      'When this enters your Stable, you may: STEAL a Baby Unicorn card OR bring a Basic Unicorn from the discard pile into your Stable.','🏴‍☠️',1,X),

    ...c(MU,'Extreme Adventurer Unicorn',
      { trigger:'beginning', type: EFFECTS.DRAW, amount:1, optional:true,
        passive:{ type:'block_basic_unicorns_own_stable' } },
      'Basic Unicorn cards cannot enter your Stable. At the beginning of your turn, you may DRAW a card.','🏔️',1,X),

    ...c(MU,'Fearless Unicorn',
      { trigger:'on_leave', type: EFFECTS.FROM_DISCARD, targetType:'instant', addToHand:true, optional:true },
      'If sacrificed or destroyed, you may add an Instant card from the discard pile to your hand.','😤',1,X),

    ...c(MU,'First Mer-mate Unicorn',
      { trigger:'on_leave', type:'choice_draw_two_or_play_basic', optional:true },
      'If sacrificed or destroyed, you may: DRAW 2 cards OR bring a Basic Unicorn from your hand into your Stable.','🧜',1,X),

    ...c(MU,'Fisherman Unicorn',
      { trigger:'enter', type:'look_hand_take_one', optional:true },
      'When this enters your Stable, you may look at another player\'s hand. Choose a card and add it to your hand.','🎣',1,X),

    ...c(MU,'Hornswoggler Unicorn',
      { trigger:'enter', type:'choice_discard_hand_draw3_or_trade_hands', optional:true },
      'When this enters your Stable, you may: DISCARD your hand, then DRAW 3 cards OR trade hands with any other player.','🤠',1,X),

    ...c(MU,'Pillaging Pirate Unicorn',
      { trigger:'enter', type:'choice_steal_upgrade_or_move_downgrade', optional:true },
      'When this enters your Stable, you may: STEAL an Upgrade card OR move a Downgrade from your Stable to another player\'s Stable.','🏴‍☠️',1,X),

    ...c(MU,'Salty Seadogicorn',
      { trigger:'enter', type:'choice_force_all_discard_or_draw', optional:true },
      'When this enters your Stable, you may: Force each other player to DISCARD a card OR DRAW a card.','⚓',1,X),

    ...c(MU,'Stowaway Unicorn',
      { trigger:'enter', type:'draw_reveal_if_unicorn_upgrade_downgrade_into_stable', optional:true },
      'When this enters your Stable, you may DRAW a card and reveal it. If it is a Unicorn, Upgrade, or Downgrade card, bring it into your Stable.','🛳️',1,X),

    ...c(MU,'Vagabond Unicorn',
      { trigger:'beginning', type:'discard_pull_random_from_opponent', optional:true },
      'At the beginning of your turn, you may DISCARD a card, then pull a card at random from another player\'s hand.','🎒',1,X),

    ...c(MU,'Survivalist Unicorn',
      { trigger:'beginning', type:'discard_then_sacrifice_downgrade', optional:true },
      'At the beginning of your turn, you may DISCARD a card, then SACRIFICE a Downgrade card.','🏕️',1,X),

    ...c(MA,'Glowing Horn',
      { type:'choice_sacrifice_destroy_or_revive_from_discard' },
      'SACRIFICE a card, then DESTROY a card OR bring a card from the discard pile into your Stable.','✨',1,X),

    ...c(MA,'Metal Detector',
      { type:'choice_draw3_discard1_or_add_from_discard' },
      'DRAW 3 cards and DISCARD a card OR add a card from the discard pile to your hand.','🔍',2,X),

    ...c(MA,'Mysterious Compass',
      { type:'choice_discard3_extra_turn_or_move_steal_unicorn' },
      'DISCARD 3 cards, then take another turn OR move a Unicorn from your Stable to another player\'s Stable, then STEAL a Unicorn from that player\'s Stable.','🧭',1,X),

    ...c(MA,'Silver Tongue',
      { type:'choice_reveal_all_hands_or_take_from_all' },
      'Force each other player to reveal their hand to you OR force each other player to give you a card from their hand.','🪙',1,X),

    ...c(MA,'The Great Baby Heist',
      { type:'discard_two_bring_two_babies' },
      'DISCARD 2 cards, then bring 2 Baby Unicorn cards from the Nursery into your Stable.','👶',2,X),

    ...c(MA,'Unicorn Shovel',
      { type:'choice_revive_unicorn_or_two_unicorns_to_hand' },
      'Bring a Unicorn card from the discard pile into your Stable OR add 2 Unicorn cards from the discard pile to your hand.','⛏️',1,X),

    ...c(IN,'Fishing Rod',
      { type:'intercept_steal_into_your_stable' },
      'Play when another player tries to STEAL a card. Move the card that would be stolen into your Stable instead.','🎣',2,X),

    ...c(IN,'Flare Gun',
      { type:'target_skip_beginning_and_draw' },
      'Play at the beginning of another player\'s turn. That player must skip their Beginning and Draw phases.','🔫',2,X),

    ...c(IN,'Neigh, Mate!',
      { type: EFFECTS.NEIGH, super:false },
      'Stop a card from being played and send it to the discard pile.','🤙',3,X),

    ...c(IN,'Unicorn Net',
      { type:'intercept_sacrifice_or_destroy_add_to_hand' },
      'Play when any player tries to SACRIFICE or DESTROY a card. Add that card to your hand instead.','🕸️',2,X),

    ...c(UP,'Ancient Ritual',
      { trigger:'beginning', type:'sacrifice_unicorn_draw_three', optional:true },
      'At the beginning of your turn, you may SACRIFICE a Unicorn card, then DRAW 3 cards.','🕯️',1,X),

    ...c(UP,'Pit Covered in Leaves',
      { trigger:'beginning', type:'sacrifice_self_steal_unicorn', optional:true },
      'At the beginning of your turn, you may SACRIFICE this card, then STEAL a Unicorn card.','🍂',2,X),

    ...c(UP,'Royal Hooves',
      { trigger:'beginning', type:'pull_random_instead_of_draw', optional:true },
      'At the beginning of your turn, you may pull a card at random from another player\'s hand instead of drawing for your Draw phase.','👑',1,X),

    ...c(UP,'Unicorn Survival Kit',
      { trigger:'on_sac_or_destroy', type:'discard_two_instead', optional:true },
      'Each time one of your Unicorn cards would be sacrificed or destroyed, you may DISCARD 2 cards instead.','🎒',1,X),

    ...c(DN,'Broken Sundial',
      { trigger:'passive', type:'skip_beginning_phase' },
      'Skip your Beginning of Turn phase.','⏰',1,X),

    ...c(DN,'Extremely Small Backpack',
      { trigger:'on_draw', type:'discard_after_draw',
        passive:{ type:'move_to_other_if_hand_empty' } },
      'Each time you DRAW any number of cards, DISCARD a card. If you have no cards in hand, move this card to another player\'s Stable.','🎒',1,X),

    ...c(DN,'The Black Spot',
      { trigger:'passive', type:'cannot_win_with_basic' },
      'You cannot win the game if you have a Basic Unicorn card in your Stable.','⚫',1,X),

    ...c(DN,'Unicorn Overboard',
      { trigger:'on_sac_or_destroy', type: EFFECTS.DISCARD, amount:1 },
      'Each time one of your Unicorn cards is sacrificed or destroyed, DISCARD a card.','🌊',1,X),
  ];
}

// ─── NSFW EXPANSION ──────────────────────────────────────────────────────────
function nsfwExpansion() {
  const X = 'nsfw';
  return [
    ...c(BU,'Shotgun Baby Unicorn',  null,'','🔫',1,X),
    ...c(BU,'Bye Bye Baby Unicorn',  null,'','👋',1,X),
    ...c(BU,'Upside Down Baby Unicorn',null,'','🙃',1,X),
    ...c(BU,'Dumpster Baby Unicorn', null,'','🗑️',1,X),
    ...c(BU,'Tasty Baby Unicorn',    null,'','😋',1,X),
    ...c(BU,'Cannibal Baby Unicorn', null,'','🍽️',1,X),

    ...c(BS,'Wasted White Unicorn',  null,'','🥴',3,X),
    ...c(BS,'Horse With A Dildo',    null,'','🐴',3,X),
    ...c(BS,'Stoner Unicorn',        null,'','🌿',3,X),
    ...c(BS,'Single Unicorn',        null,'','😔',3,X),

    ...c(MU,'Bear Daddy Unicorn',
      { trigger:'enter', type: EFFECTS.SEARCH_DECK, nameContains:'Twinkicorn', addToHand:true, optional:true },
      'When this enters your Stable, you may search the deck for a Twinkicorn card, add to hand, shuffle.','🐻',1,X),

    ...c(MU,'Twinkicorn',
      { trigger:'enter', type: EFFECTS.SEARCH_DECK, nameContains:'Bear Daddy Unicorn', addToHand:true, optional:true },
      'When this enters your Stable, you may search the deck for a Bear Daddy Unicorn card, add to hand, shuffle.','✨',1,X),

    ...c(MU,'Straight But Curious Unicorn',
      { trigger:'enter', type:'look_top_return_same_order', amount:3, optional:true },
      'When this enters your Stable, you may look at top 3 cards of deck, then return them in the same order.','🤔',1,X),

    ...c(MU,'Cult Leader Unicorn',
      { trigger:'enter', type: EFFECTS.ALL_SACRIFICE, targetType:'unicorn' },
      'When this enters your Stable, each player (including you) must SACRIFICE a Unicorn card.','🕯️',1,X),

    ...c(MU,'The Bitchiest Unicorn',
      { trigger:'beginning', type:'force_opponent_discard', amount:1, optional:true,
        passive:{ type:'requires_basic_in_stable' } },
      'You can only play this if there is a Basic Unicorn in your Stable. At the beginning of your turn, you may force another player to DISCARD a card.','😤',1,X),

    ...c(MU,'Polyamorous Unicorn',
      { trigger:'beginning', type:'move_self_steal_unicorn', optional:true },
      'At the beginning of your turn, you may move this card to another player\'s Stable, then STEAL a Unicorn from that player\'s Stable.','💕',1,X),

    ...c(MU,'Naked Narwhal',
      { trigger:'enter', type:'steal_basic_temp', onLeave:{ type:'return_stolen_basic' } },
      'When this enters your Stable, STEAL a Basic Unicorn card. If this card leaves your Stable, return that Basic Unicorn card.','🐟',1,X),

    ...c(MU,'Free Candy Unicorn',
      { trigger:'enter', type:'steal_baby_temp', onLeave:{ type:'return_stolen_baby' } },
      'When this enters your Stable, STEAL a Baby Unicorn card. If this card leaves your Stable, return that Baby Unicorn card.','🍬',1,X),

    ...c(MU,'Horny Flying Unicorn',
      { trigger:'enter', type: EFFECTS.FROM_DISCARD, targetType:'neigh', addToHand:true, optional:true,
        onLeave:{ type:'return_to_hand_self' } },
      'When this enters your Stable, you may add a Neigh card from discard to hand. If sacrificed or destroyed, return to hand.','😈',1,X),

    ...c(MA,'Fuck. Marry. Kill',
      { type:'force_discard_give_card_destroy_unicorn' },
      'Force another player to DISCARD a card, give another player a card from your hand, then DESTROY a Unicorn card.','💍',2,X),

    ...c(MA,'Unicorn Hangover',
      { type: EFFECTS.SKIP_TURN, targetOwner:'opponent' },
      'Force another player to skip their next turn.','🤢',2,X),

    ...c(MA,'Unicorgy',
      { type:'draw_equal_to_basics_in_stable' },
      'DRAW a number of cards equal to the number of Basic Unicorn cards in your Stable.','🎉',2,X),

    ...c(MA,'Rainbow Shitstorm',
      { type:'all_sacrifice_discard_shuffle_deal5' },
      'Each player must SACRIFICE a card and DISCARD their hand. Shuffle discard into deck, then deal 5 cards to each player.','🌈',1,X),

    ...c(MA,'Safe Sex',
      { type:'all_return_baby_to_nursery' },
      'Each player (including you) must return a Baby Unicorn card from their Stable to the Nursery.','🔒',1,X),

    ...c(IN,'Hell Neigh!',
      { type: EFFECTS.NEIGH, super:false },
      'Stop a card from being played and send it to the discard pile.','😈',2,X),

    ...c(IN,'Neigh, Bitch!',
      { type: EFFECTS.NEIGH, super:false },
      'Stop a card from being played and send it to the discard pile.','😤',2,X),

    ...c(IN,'Neigh, Motherfucker!',
      { type: EFFECTS.NEIGH, super:false, neighTarget_must_discard:true },
      'Stop a card from being played. That player must DISCARD a card.','🤬',2,X),

    ...c(UP,'Pony Play',
      { trigger:'beginning', type:'pull_random_skip_draw', optional:true },
      'At the beginning of your turn, you may pull a card at random from another player\'s hand. If you do, skip your Draw phase.','🐴',2,X),

    ...c(UP,'Dominatrix Whip',
      { trigger:'beginning', type:'move_unicorn_any_stable_not_own', optional:true },
      'At the beginning of your turn, you may move a Unicorn card from any player\'s Stable to any other player\'s Stable. You cannot move that card to your own Stable.','⛓️',2,X),

    ...c(UP,'Blow Up Unicorn',
      { trigger:'on_sac_or_destroy', type:'sacrifice_self_instead', optional:true },
      'If a Unicorn in your Stable would be sacrificed or destroyed, you may SACRIFICE this card instead.','💥',1,X),

    ...c(DN,'Autoerotic Asphyxiation',
      { trigger:'beginning', type: EFFECTS.DISCARD, amount:1 },
      'At the beginning of your turn, DISCARD a card.','😮‍💨',2,X),

    ...c(DN,'Unicorn Butt Plug',
      { trigger:'passive', type:'reduce_hand_limit', amount:4 },
      'Your hand limit is reduced by 4 cards.','🔌',2,X),
  ];
}

// ─── CHRISTMAS EXPANSION ──────────────────────────────────────────────────────
function christmasExpansion() {
  const X = 'christmas';
  return [
    ...c(BU,'Baby Unicorn (Elf)',       null,'','🧝',1,X),
    ...c(BU,'Baby Unicorn (Gingerbread)',null,'','🍪',1,X),
    ...c(BU,'Baby Unicorn (Present)',   null,'','🎁',1,X),

    ...c(BS,'Fa La Llamacorn',    null,'','🦙',1,X),
    ...c(BS,'Mariah Karaokecorn', null,'','🎤',1,X),
    ...c(BS,'Silly Chilly Unicorn',null,'','🌨️',1,X),
    ...c(BS,'Sugar Crash Unicorn',null,'','🍬',1,X),

    ...c(MU,'Festive Flying Unicorn',
      { trigger:'enter', type:'pull_random_hand', optional:true, onLeave:{ type:'return_to_hand_self' } },
      'When this enters your Stable, you may pull a card at random from another player\'s hand. If sacrificed or destroyed, return to hand.','🎄',1,X),

    ...c(MU,'Flying Krampuscorn',
      { trigger:'enter', type:'steal_baby', optional:true, onLeave:{ type:'return_to_hand_self' } },
      'When this enters your Stable, you may STEAL a Baby Unicorn card. If sacrificed or destroyed, return to hand.','😈',1,X),

    ...c(MU,'Friendly Snowmancorn',
      { trigger:'beginning', type: EFFECTS.DRAW, amount:1, optional:true,
        passive:{ type:'sacrifice_self_on_steal_or_destroy' } },
      'At the beginning of your turn, you may DRAW a card. If you STEAL or DESTROY another card, SACRIFICE this card.','⛄',1,X),

    ...c(MU,'Helper Elficorn',
      { trigger:'beginning', type: EFFECTS.DRAW, amount:1, optional:true,
        condition:'four_or_fewer_unicorns' },
      'At the beginning of your turn, if you have 4 or fewer Unicorn cards in your Stable, you may DRAW a card.','🧝',1,X),

    ...c(MU,'Procrastinating Shoppercorn',
      { trigger:'enter', type:'discard_look_top_three_keep_one', optional:true },
      'When this enters your Stable, you may DISCARD a card and look at top 3 cards of deck. Add one to hand, DISCARD the other two.','🛍️',1,X),

    ...c(MU,'Unicorn Caroler',
      { trigger:'passive', type:'on_neigh_take_card_from_neigher' },
      'Each time another player plays a Neigh card when you try to play a card, that player must give you a card from their hand.','🎶',1,X),

    ...c(MU,'White Elephantcorn',
      { trigger:'enter', type:'move_downgrade_to_opponent', optional:true },
      'When this enters your Stable, you may move a Downgrade from your Stable to another player\'s Stable.','🐘',1,X),

    ...c(MU,'Winter Wondercorn',
      { trigger:'on_upgrade_enter', type: EFFECTS.DRAW, amount:1 },
      'Each time an Upgrade card enters your Stable, DRAW a card.','❄️',1,X),

    ...c(MA,'Gift Receipt',
      { type:'move_own_card_pull_from_that_player' },
      'Move a card in your Stable to another player\'s Stable, then pull a card from that player\'s hand.','🎁',2,X),

    ...c(MA,'Nog Wild',
      { type:'discard_n_draw_n_extra_turn' },
      'DISCARD any number of cards from your hand, then DRAW the same number of cards. Take another turn.','🥛',2,X),

    ...c(MA,'Silver Lining',
      { type:'sacrifice_revive_upgrade_from_discard' },
      'SACRIFICE a card, then bring an Upgrade card from the discard pile into your Stable.','🌟',2,X),

    ...c(IN,'Jingle All The Neigh',
      { type: EFFECTS.NEIGH, super:false, you_may_draw:true },
      'Stop a card from being played. You may DRAW a card.','🔔',4,X),

    ...c(UP,'Gift Inspector',
      { trigger:'beginning', type:'look_top_two_return_any_order', optional:true },
      'At the beginning of your turn, you may look at top 2 cards of deck, then return them in any order.','🎁',2,X),

    ...c(UP,'Gingerbread Stable',
      { trigger:'on_unicorn_enter', type: EFFECTS.DRAW, amount:1, optional:true },
      'Each time a Unicorn card enters your Stable, you may DRAW a card.','🍪',1,X),

    ...c(UP,'Ugly Holiday Sweater',
      { trigger:'passive', type:'unicorns_cannot_be_stolen' },
      'Your Unicorn cards cannot be stolen.','🧶',1,X),

    ...c(DN,'Humbug',
      { trigger:'passive', type:'block_magical_unicorns' },
      'Magical Unicorn cards cannot enter your Stable.','😒',1,X),

    ...c(DN,'Naughty List',
      { trigger:'on_steal_or_destroy', type: EFFECTS.DISCARD, amount:1 },
      'Each time you STEAL or DESTROY a card, DISCARD a card.','📋',1,X),

    ...c(DN,'Oh, Deer',
      { trigger:'passive', type:'unicorns_are_reindeer' },
      'All of your Unicorns are considered Reindeer. Cards that affect Unicorn cards do not affect your Reindeer.','🦌',1,X),

    ...c(DN,'Uneaten Fruitcake',
      { trigger:'passive', type:'cannot_win' },
      'You cannot win the game if Uneaten Fruitcake is in your Stable.','🎂',2,X),
  ];
}

// ─── NIGHTMARES EXPANSION ─────────────────────────────────────────────────────
function nightmaresExpansion() {
  const X = 'nightmares';
  return [
    ...c(BU,'Baby Unicorn (Ghost)',
      { trigger:'on_sac_destroy_return_hand', type:'return_to_nursery_instead' },
      'If this card would be sacrificed, destroyed, or returned to hand, return it to the Nursery instead.','👻',1,X),
    ...c(BU,'Baby Unicorn (Horror)',
      { trigger:'on_sac_destroy_return_hand', type:'return_to_nursery_instead' },
      'If this card would be sacrificed, destroyed, or returned to hand, return it to the Nursery instead.','😱',1,X),
    ...c(BU,'Baby Unicorn (Look Back)',
      { trigger:'on_sac_destroy_return_hand', type:'return_to_nursery_instead' },
      'If this card would be sacrificed, destroyed, or returned to hand, return it to the Nursery instead.','👀',1,X),

    ...c(BS,'Basic Unicorn', null,'','🦄',3,X),
    ...c(BS,'Basic Unicorn', null,'','🦄',3,X),
    ...c(BS,'Basic Unicorn', null,'','🦄',3,X),
    ...c(BS,'Basic Unicorn', null,'','🦄',3,X),

    ...c(MU,'Chainsaw Massicorn',
      { trigger:'enter', type:'draw_per_basic_in_stable', optional:true },
      'When this enters your Stable, you may DRAW a card for each Basic Unicorn card in your Stable.','🪚',1,X),

    ...c(MU,'Clairvoyant Unicorn',
      { trigger:'beginning', type: EFFECTS.DRAW, amount:1, optional:true,
        passive:{ type:'hand_visible' } },
      'Your hand must be visible to all players. At the beginning of your turn, you may DRAW a card.','🔮',1,X),

    ...c(MU,'Dancing Clownicorn',
      { trigger:'enter', type:'discard_two_return_all_opponents_one', optional:true },
      'When this enters your Stable, you may DISCARD 2 cards, then return a card in each other player\'s Stable to their hand.','🤡',1,X),

    ...c(MU,'Demonicorn',
      { trigger:'on_destroyed', type:'remove_from_game', optional:true },
      'If this card is destroyed, you may remove a card in any player\'s Stable from the game.','😈',1,X),

    ...c(MU,'Jack the Reapercorn',
      { trigger:'enter', type:'draw_if_neigh_draw_again' },
      'When this enters your Stable, DRAW a card. If that card is a Neigh card, you may reveal it and DRAW a second card.','🔪',1,X),

    ...c(MU,'Phantom Unicorn',
      { trigger:'passive', type:'cannot_be_sacrificed_or_destroyed' },
      'This card cannot be sacrificed or destroyed.','👻',1,X),

    ...c(MU,'Playful Puppet Unicorn',
      { trigger:'enter', type:'move_downgrade_to_opponent', optional:true },
      'When this enters your Stable, you may move a Downgrade from your Stable to another player\'s Stable.','🪆',1,X),

    ...c(MU,'Sweet Old Ladycorn',
      { trigger:'passive', type: EFFECTS.COUNT_AS_TWO,
        onLeave:{ type:'sacrifice_a_card' } },
      'This card counts for 2 Unicorns. If this card is sacrificed or destroyed, SACRIFICE a card.','👵',1,X),

    ...c(MU,'Unicorn Slasher',
      { trigger:'enter', type:'discard_remove_from_game', optional:true },
      'When this enters your Stable, you may DISCARD a card, then remove a card in any player\'s Stable from the game.','🔪',1,X),

    ...c(MU,'Vengeful Unicorn',
      { trigger:'enter', type:'sacrifice_basic_draw_three', optional:true },
      'When this enters your Stable, you may SACRIFICE a Basic Unicorn card, then DRAW 3 cards.','😤',1,X),

    ...c(MU,'Winged Horrorcorn',
      { trigger:'on_leave', type:'look_hand_take_one', optional:true },
      'If sacrificed or destroyed, you may look at another player\'s hand. Choose a card and add it to your hand.','🦇',1,X),

    ...c(MA,"HEEEEERE'S STABBY",
      { type:'remove_from_game' },
      'Remove a card in any player\'s Stable from the game.','🪓',3,X),

    ...c(MA,'Possession',
      { type:'discard_then_steal' },
      'DISCARD a card, then STEAL a card.','👁️',1,X),

    ...c(MA,'Reanimation',
      { type:'revive_basic_draw' },
      'Bring a Basic Unicorn card from the discard pile into your Stable, then DRAW a card.','🧟',2,X),

    ...c(MA,'Supernatural Selection',
      { type:'destroy_all_basics_one_player' },
      'Choose any player. DESTROY all Basic Unicorn cards in that player\'s Stable.','⚡',2,X),

    ...c(MA,'The Cornjuring',
      { type:'search_nightmare_downgrade_into_stable' },
      'Search the deck for a Nightmare Downgrade card and bring it into any player\'s Stable, then shuffle.','🌽',2,X),

    ...c(DN,'Nightmare: Buried Alive',
      { trigger:'beginning', type:'sacrifice_unicorn_or_self_return',
        passive:{ type:'return_if_no_unicorns' } },
      'At the beginning of your turn, SACRIFICE a Unicorn card. If you have no Unicorn cards, return this card to your hand.','⚰️',1,X),

    ...c(DN,'Nightmare: Currently Indisposed',
      { trigger:'enter', type: EFFECTS.SACRIFICE, targetType:'unicorn',
        passive:{ type:'cannot_win' } },
      'When this enters your Stable, SACRIFICE a Unicorn card. You cannot win the game if this card is in your Stable.','🛑',1,X),

    ...c(DN,'Nightmare: Existential Dread',
      { trigger:'beginning', type:'steal_downgrade' },
      'At the beginning of your turn, STEAL a Downgrade card.','😰',1,X),

    ...c(DN,'Nightmare: Exorcise Regimen',
      { trigger:'enter', type:'discard_hand_draw_one',
        passive:{ type:'reduce_hand_limit', amount:3 } },
      'When this enters your Stable, DISCARD your hand, then DRAW a card. Your hand limit is reduced by 3 cards.','😤',1,X),

    ...c(UP,'Ghost Guide',
      { trigger:'beginning', type:'draw_reveal_if_upgrade_downgrade_into_stable', optional:true },
      'At the beginning of your turn, you may DRAW a card and reveal it. If it is an Upgrade or Downgrade card, bring it into your Stable.','👻',1,X),

    ...c(UP,'Magic Elixir',
      { trigger:'on_sac_or_destroy', type:'discard_instead', optional:true },
      'If a card in your Stable would be sacrificed or destroyed, you may DISCARD a card instead.','⚗️',2,X),

    ...c(UP,'Paranormal Affection',
      { trigger:'enter', type: EFFECTS.DRAW, amount:2, optional:true,
        passive:{ type:'upgrades_cannot_be_destroyed' } },
      'When this enters your Stable, you may DRAW 2 cards. Upgrade cards in your Stable cannot be destroyed.','💜',2,X),

    ...c(UP,'Poltergeist Swipe',
      { trigger:'beginning', type:'skip_draw_pull_random', optional:true },
      'At the beginning of your turn, you may skip your Draw phase. If you do, pull a card at random from another player\'s hand.','👻',1,X),

    ...c(UP,'Saved by the Sigil',
      { trigger:'passive', type:'block_downgrades_self_protected' },
      'Downgrade cards cannot enter your Stable. This card cannot be sacrificed or destroyed.','🔮',2,X),

    ...c(UP,'Strange Craft Project',
      { trigger:'beginning', type:'discard_three_remove_from_game', optional:true },
      'At the beginning of your turn, you may DISCARD 3 cards, then remove a card in any player\'s Stable from the game.','🎨',1,X),

    ...c(IN,'Hex Neigh',
      { type:'neigh_remove_from_game' },
      'Stop a card from being played and remove it from the game.','☠️',4,X),
  ];
}

const EXPANSIONS = {
  dragons:            { id:'dragons',            name:'🐲 Dragons',            color:'#ff5533', ageRating:'14+', cardCount:29, desc:'Dragoncorns, dragon curses, and fire-breathing chaos.', cards: dragonsExpansion },
  unicorns_of_legend: { id:'unicorns_of_legend', name:'⭐ Unicorns of Legend', color:'#4fb8ff', ageRating:'14+', cardCount:35, desc:'Mythological hero unicorns with RPG-style abilities.',   cards: unicornsOfLegendExpansion },
  rainbow_apocalypse: { id:'rainbow_apocalypse', name:'🌈 Rainbow Apocalypse', color:'#9b59b6', ageRating:'14+', cardCount:36, desc:'The Four Unicorns of the Apocalypse vs Rainbow Sprinkles.', cards: rainbowApocalypseExpansion },
  adventures:         { id:'adventures',         name:'⚔️ Adventures',         color:'#f39c12', ageRating:'14+', cardCount:38, desc:'Pirates, fishermen, and survivalist unicorns.',            cards: adventuresExpansion },
  nsfw:               { id:'nsfw',               name:'🔞 NSFW',               color:'#ff4fa3', ageRating:'18+', cardCount:32, desc:'Adults-only raunchy unicorns and spicy mechanics.', adult:true, cards: nsfwExpansion },
  christmas:          { id:'christmas',           name:'🎄 Christmas',          color:'#c0392b', ageRating:'14+', cardCount:24, desc:'Holiday-themed cards, gifts, and Krampus unicorns.',       cards: christmasExpansion },
  nightmares:         { id:'nightmares',          name:'👻 Nightmares',         color:'#6c3483', ageRating:'14+', cardCount:35, desc:'Horror unicorns, curses, and things removed from the game entirely.', cards: nightmaresExpansion },
};

function getExpansionCards(ids = []) {
  const out = [];
  if (!Array.isArray(ids)) return out;
  for (const id of ids) {
    if (typeof id === 'string' && EXPANSIONS[id]) out.push(...EXPANSIONS[id].cards());
  }
  return out;
}

module.exports = { EXPANSIONS, getExpansionCards };
