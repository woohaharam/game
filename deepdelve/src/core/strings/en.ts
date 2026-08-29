/**
 * English strings, and the source of truth for the key set.
 *
 * The key union is derived from this table, so every other locale is checked
 * against it at compile time: a missing translation is a type error rather than
 * a `undefined` rendered into the interface.
 */
export const en = {
  'game.title': 'DeepDelve — an idle dungeon RPG',
  'game.description': 'An idle fantasy dungeon RPG. Descend forever.',

  'tab.upgrades': 'Upgrades',
  'tab.party': 'Party',
  'tab.descend': 'Descend',

  'combat.floor': 'Floor {n}',
  // The surrounding spaces are part of the string: English sets "Damage 31 /
  // sec", Korean sets "공격력 31/초" with no space before the unit.
  'combat.damage': 'Damage ',
  'combat.perSecond': ' / sec',
  'combat.blessed': 'blessed {time}',
  'combat.killProgress': '{done} / {total}',
  'effect.floorCleared': 'Floor {n} cleared',
  'effect.descended': 'Descended · +{relics} relics',

  // Minutes rather than a formatted duration: the reward is always a round
  // number of them, and `formatDuration` keeps both units for the sake of a
  // countdown that must not jitter, which renders this as "5m 00s".
  'boost.blessing': '▶ Blessing · 2× for {minutes}m',
  'boost.chest': '▶ Chest · {amount}',

  'shop.level': 'Lv {n}',
  'shop.maxed': 'MAX',
  'shop.quantityMax': 'MAX',
  'party.hint': 'Companions fight on their own and never stop.',
  'party.damage': '+{amount} damage per second.',

  'descend.title': 'Leave the run behind',
  'descend.body':
    'Surrender this run to keep its relics. Every relic is a permanent +25% to damage and gold, on this run and every run after it.',
  'descend.relics': 'relics',
  'descend.button': 'Descend',
  'descend.ready': 'Gold, upgrades and companions are lost. Relics are not.',
  'descend.locked': 'Clear floor {n} to unlock descending.',
  'descend.confirm':
    'Descend? This run’s gold, upgrades and companions are lost. Relics are kept.',

  'stats.title': 'This save',
  'stats.deepest': 'Deepest floor',
  'stats.descents': 'Descents',
  'stats.kills': 'Kills',
  'stats.guardiansFelled': 'Guardians felled',
  'stats.guardiansEscaped': 'Guardians escaped',
  'stats.goldEarned': 'Gold earned',
  'stats.timePlayed': 'Time delved',

  'settings.notation': 'Numbers: {mode}',
  'settings.language': 'Language: English',
  'settings.soundOn': 'Sound: on',
  'settings.soundOff': 'Sound: off',
  'settings.wipe': 'Erase save',
  'settings.wipeConfirm': 'Erase this save permanently?',

  'notation.suffix': 'suffix',
  'notation.scientific': 'scientific',
  'notation.korean': '만·억·조',

  'offline.title': 'While you were away',
  'offline.away': 'You were gone {duration}.',
  'offline.gold': 'Gold',
  'offline.kills': 'Kills',
  'offline.floors': 'Floors',
  'offline.cap': 'The party can only press on for eight hours unattended.',
  'offline.double': '▶ Double it',
  'offline.continue': 'Continue',

  'zone.0': 'Mossy Crypt',
  'zone.1': 'Bone Halls',
  'zone.2': 'Ember Deep',
  'zone.3': 'Drowned Vault',
  'zone.4': 'Shadowspire',
  'zone.5': 'Silent Foundry',
  'zone.6': 'Weeping Gardens',
  'zone.7': 'Obsidian Reach',
  'zone.deeper': '{zone} · Deeper {lap}',

  'monster.0.0': 'Crypt Rat',
  'monster.0.1': 'Grave Moss',
  'monster.0.2': 'Pale Beetle',
  'monster.1.0': 'Rattling Bones',
  'monster.1.1': 'Bone Archer',
  'monster.1.2': 'Cracked Knight',
  'monster.2.0': 'Ash Imp',
  'monster.2.1': 'Cinder Hound',
  'monster.2.2': 'Magma Slug',
  'monster.3.0': 'Drowned Thrall',
  'monster.3.1': 'Reef Lurker',
  'monster.3.2': 'Barnacle Ogre',
  'monster.4.0': 'Shade',
  'monster.4.1': 'Mirror Wraith',
  'monster.4.2': 'Nightbloom',
  'monster.5.0': 'Rust Automaton',
  'monster.5.1': 'Steam Golem',
  'monster.5.2': 'Loose Cog',
  'monster.6.0': 'Thornling',
  'monster.6.1': 'Weeping Dryad',
  'monster.6.2': 'Sap Horror',
  'monster.7.0': 'Glass Stalker',
  'monster.7.1': 'Obsidian Maw',
  'monster.7.2': 'Void Shard',

  'guardian.0': 'The Grave Warden',
  'guardian.1': 'Ossuary King',
  'guardian.2': 'Cinderjaw',
  'guardian.3': 'The Drowned Choir',
  'guardian.4': 'Your Own Shadow',
  'guardian.5': 'Prime Automaton',
  'guardian.6': 'The Weeping Root',
  'guardian.7': 'Glass Tyrant',

  'upgrade.blade.name': 'Sharpened Blade',
  'upgrade.blade.desc': '+2 damage per strike.',
  'upgrade.swiftness.name': 'Swift Footing',
  'upgrade.swiftness.desc': '+0.08 strikes per second.',
  'upgrade.precision.name': 'Keen Eye',
  'upgrade.precision.desc': '+0.5% chance to strike critically.',
  'upgrade.ferocity.name': 'Ferocity',
  'upgrade.ferocity.desc': '+0.15× critical damage.',
  'upgrade.greed.name': 'Greedy Hands',
  'upgrade.greed.desc': '+7% gold from every kill.',
  'upgrade.tome.name': 'Ancient Tome',
  'upgrade.tome.desc': '+12% to all damage.',

  'companion.torchbearer.name': 'Mira, Torchbearer',
  'companion.houndmaster.name': 'Bram, Houndmaster',
  'companion.runesmith.name': 'Sable, Runesmith',
  'companion.revenant.name': 'Kest, The Revenant',
  'companion.archivist.name': 'Oduun, The Archivist',

  'duration.day': 'd',
  'duration.hour': 'h',
  'duration.minute': 'm',
  'duration.second': 's',
} as const;

export type StringKey = keyof typeof en;
