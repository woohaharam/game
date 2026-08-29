/**
 * Korean strings.
 *
 * Typed against the English key set, so a key added there and forgotten here is
 * a compile error rather than `undefined` in the interface.
 *
 * Two things are translated rather than transliterated. The forms are written
 * as Korean words for the things themselves — 모래알, 잉걸, 은하 — rather than
 * phonetic renderings of the English, which read as noise. And numbers are
 * grouped in fours (만, 억, 조) rather than threes; see `formatKorean`.
 */
import type { StringKey } from './en';

export const ko: Record<StringKey, string> = {
  'game.title': '돌멩이 키우기',
  'game.description': '모래알 하나를 은하로 키우는 방치형 게임.',

  'tab.upgrades': '연마',
  'tab.party': '궤도',
  'tab.descend': '압축',

  'stone.stage': '{n}단계',
  'stone.absorbing': '흡수 중',
  'stone.rate': '흡수력 ',
  'stone.perSecond': '/초',
  'stone.blessed': '축복 {time}',
  'stone.progress': '{done} / {total}',
  'stone.mass': '무게',

  'effect.stageReached': '{n}단계',
  'effect.becameForm': '{form}이(가) 되었다',
  'effect.compressed': '압축 완료 · 결정 +{crystals}',

  'boost.blessing': '▶ 축복 · {minutes}분간 2배',
  'boost.chest': '▶ 광맥 · {amount}',

  'shop.autoDelve': '자동 연마',
  'shop.autoDelveOn': '켬',
  'shop.autoDelveOff': '끔',
  'shop.autoDelveHint': '가장 싼 연마를 자동으로 구매합니다. 자리를 비운 동안에도 작동합니다.',
  'shop.autoDelveLocked': '첫 압축 이후 열립니다.',
  'shop.level': 'Lv {n}',
  'shop.maxed': '최대',
  'shop.quantityMax': '최대',
  'party.hint': '궤도체는 스스로 돌을 먹이며 결코 멈추지 않습니다.',
  'party.damage': '초당 흡수 +{amount}.',

  'descend.title': '돌을 무너뜨리기',
  'descend.body':
    '지금까지 키운 것을 전부 결정으로 압축합니다. 결정 하나마다 흡수력과 가루가 영구히 25%씩 늘어나며, 이번 돌뿐 아니라 이후 모든 돌에 적용됩니다.',
  'descend.relics': '결정',
  'descend.button': '압축하기',
  'descend.ready': '가루와 연마, 궤도체는 사라집니다. 결정은 남습니다.',
  'descend.locked': '{n}단계에 도달하면 열립니다.',
  'descend.confirm':
    '압축할까요? 이 돌의 가루와 연마, 궤도체를 잃습니다. 결정은 그대로 유지됩니다.',

  'stats.title': '이 세이브',
  'stats.deepest': '최고 단계',
  'stats.descents': '압축 횟수',
  'stats.kills': '흡수한 조각',
  'stats.guardiansFelled': '도달한 단계',
  'stats.goldEarned': '모은 가루',
  'stats.timePlayed': '키운 시간',

  'settings.notation': '숫자 표기: {mode}',
  'settings.language': '언어: 한국어',
  'settings.soundOn': '소리: 켬',
  'settings.soundOff': '소리: 끔',
  'settings.export': '세이브 코드 복사',
  'settings.import': '세이브 코드 불러오기',
  'settings.exportPrompt': '세이브 코드입니다. 안전한 곳에 복사해 두세요.',
  'settings.importPrompt': '세이브 코드를 붙여넣으세요.',
  'settings.importConfirm': '붙여넣은 세이브로 교체할까요? 현재 돌은 사라집니다.',
  'settings.importOk': '세이브를 불러왔습니다.',
  'settings.importBad': '코드가 손상되었거나 잘렸습니다. 아무것도 변경하지 않았습니다.',
  'settings.copied': '세이브 코드를 복사했습니다.',
  'settings.wipe': '세이브 삭제',
  'settings.wipeConfirm': '이 세이브를 완전히 삭제할까요?',

  'boot.failed': '게임을 시작할 수 없습니다.',
  'boot.failedHint': '세이브를 지우면 대개 해결됩니다. 진행 상황은 사라집니다.',
  'boot.erase': '세이브 삭제 후 새로고침',

  'a11y.enemyHealth': '조각 흡수도',
  'a11y.floorProgress': '단계 진행도',

  'notation.suffix': 'K·M·B',
  'notation.scientific': '지수',
  'notation.korean': '만·억·조',

  'offline.title': '자리를 비운 동안',
  'offline.away': '{duration} 동안 자리를 비웠습니다.',
  'offline.gold': '가루',
  'offline.kills': '조각',
  'offline.floors': '단계',
  'offline.cap': '돌은 자리를 비운 사이 최대 8시간까지만 조각을 끌어당깁니다.',
  'offline.double': '▶ 2배로 받기',
  'offline.continue': '계속하기',

  'form.0': '모래알',
  'form.1': '자갈',
  'form.2': '돌멩이',
  'form.3': '조약돌',
  'form.4': '바위',
  'form.5': '거석',
  'form.6': '암반',
  'form.7': '언덕',
  'form.8': '산',
  'form.9': '산맥',
  'form.10': '대륙',
  'form.11': '운석',
  'form.12': '소행성',
  'form.13': '위성',
  'form.14': '행성',
  'form.15': '거대행성',
  'form.16': '갈색왜성',
  'form.17': '항성',
  'form.18': '초신성',
  'form.19': '은하',
  'form.beyond': '{form} · 제{lap}우주',

  'fragment.0': '먼지',
  'fragment.1': '파편',
  'fragment.2': '조각',
  'fragment.3': '덩어리',
  'fragment.4': '핵',

  'upgrade.blade.name': '중력정',
  'upgrade.blade.desc': '한 번 끌어당길 때 무게 +2.',
  'upgrade.swiftness.name': '인력 속도',
  'upgrade.swiftness.desc': '초당 끌어당기기 +0.08.',
  'upgrade.precision.name': '공명',
  'upgrade.precision.desc': '공명 확률 +0.5%.',
  'upgrade.ferocity.name': '진폭',
  'upgrade.ferocity.desc': '공명 위력 +0.15배.',
  'upgrade.greed.name': '체',
  'upgrade.greed.desc': '조각마다 가루 +7%.',
  'upgrade.tome.name': '밀도',
  'upgrade.tome.desc': '모든 흡수 +12%.',

  'companion.torchbearer.name': '먼지 구름',
  'companion.houndmaster.name': '얼음 껍질',
  'companion.runesmith.name': '금속 핵',
  'companion.revenant.name': '파편대',
  'companion.archivist.name': '고리계',

  'mass.gram': 'g',
  'mass.kilogram': 'kg',
  'mass.tonne': 't',
  'mass.kilotonne': 'kt',
  'mass.megatonne': 'Mt',
  'mass.gigatonne': 'Gt',
  'mass.earth': ' 지구',
  'mass.sun': ' 태양',
  'mass.galaxy': ' 은하',

  'duration.day': '일',
  'duration.hour': '시간',
  'duration.minute': '분',
  'duration.second': '초',
};
