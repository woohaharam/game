/**
 * English strings, and the source of truth for the key set.
 *
 * The key union is derived from this table, so every other locale is checked
 * against it at compile time: a missing translation is a type error rather than
 * `undefined` rendered into the interface.
 */
export const en = {
  'game.title': 'Pebble to Planet — an idle growing game',
  'game.description': 'Grow a grain of sand into a galaxy. An idle game.',

  'tab.upgrades': 'Refine',
  'tab.party': 'Orbit',
  'tab.descend': 'Compress',

  'stone.stage': 'Stage {n}',
  'stone.absorbing': 'Absorbing',
  'stone.rate': 'Absorbing ',
  'stone.perSecond': '/ sec',
  'stone.blessed': 'blessed {time}',
  'stone.progress': '{done} / {total}',
  'stone.mass': 'Mass',

  'effect.stageReached': 'Stage {n}',
  'effect.becameForm': 'Now a {form}',
  'effect.compressed': 'Compressed · +{crystals} crystals',

  'boost.blessing': '▶ Bless · 2× for {minutes}m',
  'boost.chest': '▶ Cache · {amount}',

  'shop.autoDelve': 'Auto-refine',
  'shop.autoDelveOn': 'on',
  'shop.autoDelveOff': 'off',
  'shop.autoDelveHint': 'Spends dust on the cheapest upgrade available, here and while away.',
  'shop.autoDelveLocked': 'Unlocked by your first compression.',
  'shop.level': 'Lv {n}',
  'shop.maxed': 'MAX',
  'shop.quantityMax': 'MAX',
  'party.hint': 'Orbiters feed the stone on their own and never stop.',
  'party.damage': '+{amount} absorbed per second.',

  'descend.title': 'Collapse the stone',
  'descend.body':
    'Compress everything you have grown into crystal. Every crystal is a permanent +25% to absorption and dust, on this stone and every stone after it.',
  'descend.relics': 'crystals',
  'descend.button': 'Compress',
  'descend.ready': 'Dust, refinements and orbiters are lost. Crystals are not.',
  'descend.locked': 'Reach stage {n} to unlock compression.',
  'descend.confirm':
    'Compress? This stone’s dust, refinements and orbiters are lost. Crystals are kept.',

  'stats.title': 'This save',
  'stats.deepest': 'Highest stage',
  'stats.descents': 'Compressions',
  'stats.kills': 'Fragments absorbed',
  'stats.guardiansFelled': 'Stages reached',
  'stats.goldEarned': 'Dust gathered',
  'stats.timePlayed': 'Time growing',

  'settings.notation': 'Numbers: {mode}',
  'settings.language': 'Language: English',
  'settings.soundOn': 'Sound: on',
  'settings.soundOff': 'Sound: off',
  'settings.export': 'Copy save code',
  'settings.import': 'Load save code',
  'settings.exportPrompt': 'Your save code. Copy it somewhere safe.',
  'settings.importPrompt': 'Paste a save code.',
  'settings.importConfirm': 'Replace this save with the pasted one? The current stone is lost.',
  'settings.importOk': 'Save loaded.',
  'settings.importBad': 'That code is damaged or incomplete. Nothing was changed.',
  'settings.copied': 'Save code copied.',
  'settings.wipe': 'Erase save',
  'settings.wipeConfirm': 'Erase this save permanently?',

  'boot.failed': 'The game could not start.',
  'boot.failedHint': 'Erasing the save usually fixes this. Progress will be lost.',
  'boot.erase': 'Erase save and reload',

  'a11y.enemyHealth': 'Fragment absorption',
  'a11y.floorProgress': 'Stage progress',

  'notation.suffix': 'suffix',
  'notation.scientific': 'scientific',
  'notation.korean': '만·억·조',

  'offline.title': 'While you were away',
  'offline.away': 'You were gone {duration}.',
  'offline.gold': 'Dust',
  'offline.kills': 'Fragments',
  'offline.floors': 'Stages',
  'offline.cap': 'The stone can only draw fragments for eight hours unattended.',
  'offline.double': '▶ Double it',
  'offline.continue': 'Continue',

  'form.0': 'Grain of Sand',
  'form.1': 'Gravel',
  'form.2': 'Pebble',
  'form.3': 'Cobblestone',
  'form.4': 'Boulder',
  'form.5': 'Megalith',
  'form.6': 'Bedrock',
  'form.7': 'Hill',
  'form.8': 'Mountain',
  'form.9': 'Mountain Range',
  'form.10': 'Continent',
  'form.11': 'Meteor',
  'form.12': 'Asteroid',
  'form.13': 'Moon',
  'form.14': 'Planet',
  'form.15': 'Gas Giant',
  'form.16': 'Brown Dwarf',
  'form.17': 'Star',
  'form.18': 'Supernova',
  'form.19': 'Galaxy',
  'form.beyond': '{form} · Universe {lap}',

  'fragment.0': 'Dust',
  'fragment.1': 'Shard',
  'fragment.2': 'Fragment',
  'fragment.3': 'Lump',
  'fragment.4': 'Core',

  'upgrade.blade.name': 'Gravity Well',
  'upgrade.blade.desc': '+2 mass drawn per pull.',
  'upgrade.swiftness.name': 'Pull Rate',
  'upgrade.swiftness.desc': '+0.08 pulls per second.',
  'upgrade.precision.name': 'Resonance',
  'upgrade.precision.desc': '+0.5% chance of a resonant pull.',
  'upgrade.ferocity.name': 'Amplitude',
  'upgrade.ferocity.desc': '+0.15× resonant pull strength.',
  'upgrade.greed.name': 'Sieve',
  'upgrade.greed.desc': '+7% dust from every fragment.',
  'upgrade.tome.name': 'Density',
  'upgrade.tome.desc': '+12% to all absorption.',

  'companion.torchbearer.name': 'Dust Cloud',
  'companion.houndmaster.name': 'Ice Shell',
  'companion.runesmith.name': 'Metal Core',
  'companion.revenant.name': 'Debris Belt',
  'companion.archivist.name': 'Ring System',

  'mass.gram': 'g',
  'mass.kilogram': 'kg',
  'mass.tonne': 't',
  'mass.kilotonne': 'kt',
  'mass.megatonne': 'Mt',
  'mass.gigatonne': 'Gt',
  'mass.earth': ' Earths',
  'mass.sun': ' Suns',
  'mass.galaxy': ' Galaxies',

  'duration.day': 'd',
  'duration.hour': 'h',
  'duration.minute': 'm',
  'duration.second': 's',
} as const;

export type StringKey = keyof typeof en;
