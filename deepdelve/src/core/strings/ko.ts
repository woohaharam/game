/**
 * Korean strings.
 *
 * Typed against the English key set, so a key added there and forgotten here is
 * a compile error rather than an `undefined` in the interface.
 *
 * Two things are translated rather than transliterated. Monster and zone names
 * are written as Korean fantasy names — 무덤쥐, 잉걸불 심층 — instead of
 * phonetic renderings of the English, which read as noise. And numbers are
 * grouped in fours (만, 억, 조) rather than threes; see `formatKorean`.
 */
import type { StringKey } from './en';

export const ko: Record<StringKey, string> = {
  'game.title': '딥델브 — 방치형 던전 RPG',
  'game.description': '방치형 판타지 던전 RPG. 끝없이 내려가세요.',

  'tab.upgrades': '강화',
  'tab.party': '동료',
  'tab.descend': '심연',

  'combat.floor': '{n}층',
  'combat.damage': '공격력 ',
  'combat.perSecond': '/초',
  'combat.blessed': '축복 {time}',
  'combat.killProgress': '{done} / {total}',
  'effect.floorCleared': '{n}층 돌파',
  'effect.descended': '하강 완료 · 유물 +{relics}',

  'boost.blessing': '▶ 축복 · {minutes}분간 2배',
  'boost.chest': '▶ 상자 · {amount}',

  'shop.level': 'Lv {n}',
  'shop.maxed': '최대',
  'shop.quantityMax': '최대',
  'party.hint': '동료는 스스로 싸우며 결코 멈추지 않습니다.',
  'party.damage': '초당 피해 +{amount}.',

  'descend.title': '이 회차를 내려놓기',
  'descend.body':
    '지금까지의 여정을 포기하고 유물을 얻습니다. 유물 하나마다 피해와 골드가 영구히 25%씩 늘어나며, 이번 회차뿐 아니라 이후 모든 회차에 적용됩니다.',
  'descend.relics': '유물',
  'descend.button': '심연으로 내려가기',
  'descend.ready': '골드와 강화, 동료는 사라집니다. 유물은 남습니다.',
  'descend.locked': '{n}층을 돌파하면 열립니다.',
  'descend.confirm':
    '심연으로 내려갈까요? 이번 회차의 골드와 강화, 동료를 잃습니다. 유물은 그대로 유지됩니다.',

  'stats.title': '이 세이브',
  'stats.deepest': '최고 도달 층',
  'stats.descents': '하강 횟수',
  'stats.kills': '처치 수',
  'stats.guardiansFelled': '수호자 처치',
  'stats.guardiansEscaped': '수호자 놓침',
  'stats.goldEarned': '획득 골드',
  'stats.timePlayed': '탐험 시간',

  'settings.notation': '숫자 표기: {mode}',
  'settings.language': '언어: 한국어',
  'settings.soundOn': '소리: 켬',
  'settings.soundOff': '소리: 끔',
  'settings.wipe': '세이브 삭제',
  'settings.wipeConfirm': '이 세이브를 완전히 삭제할까요?',

  'notation.suffix': 'K·M·B',
  'notation.scientific': '지수',
  'notation.korean': '만·억·조',

  'offline.title': '자리를 비운 동안',
  'offline.away': '{duration} 동안 자리를 비웠습니다.',
  'offline.gold': '골드',
  'offline.kills': '처치',
  'offline.floors': '층',
  'offline.cap': '일행은 자리를 비운 사이 최대 8시간까지만 나아갈 수 있습니다.',
  'offline.double': '▶ 2배로 받기',
  'offline.continue': '계속하기',

  'zone.0': '이끼 낀 납골당',
  'zone.1': '백골의 회랑',
  'zone.2': '잉걸불 심층',
  'zone.3': '물에 잠긴 금고',
  'zone.4': '그림자 첨탑',
  'zone.5': '침묵의 주조소',
  'zone.6': '눈물의 정원',
  'zone.7': '흑요석 벌판',
  'zone.deeper': '{zone} · 더 깊은 곳 {lap}',

  'monster.0.0': '무덤쥐',
  'monster.0.1': '묘지 이끼',
  'monster.0.2': '창백한 딱정벌레',
  'monster.1.0': '덜그럭 해골',
  'monster.1.1': '백골 궁수',
  'monster.1.2': '금 간 기사',
  'monster.2.0': '잿빛 임프',
  'monster.2.1': '불씨 사냥개',
  'monster.2.2': '용암 민달팽이',
  'monster.3.0': '익사한 노예',
  'monster.3.1': '암초 잠복자',
  'monster.3.2': '따개비 오우거',
  'monster.4.0': '그림자',
  'monster.4.1': '거울 망령',
  'monster.4.2': '밤에 피는 꽃',
  'monster.5.0': '녹슨 자동인형',
  'monster.5.1': '증기 골렘',
  'monster.5.2': '풀려난 톱니',
  'monster.6.0': '가시덩굴',
  'monster.6.1': '우는 드리아드',
  'monster.6.2': '수액 괴물',
  'monster.7.0': '유리 추적자',
  'monster.7.1': '흑요석 아귀',
  'monster.7.2': '공허의 파편',

  'guardian.0': '무덤지기',
  'guardian.1': '납골왕',
  'guardian.2': '잿불턱',
  'guardian.3': '익사한 성가대',
  'guardian.4': '당신 자신의 그림자',
  'guardian.5': '시원의 자동인형',
  'guardian.6': '우는 뿌리',
  'guardian.7': '유리 폭군',

  'upgrade.blade.name': '벼린 검날',
  'upgrade.blade.desc': '타격당 피해 +2.',
  'upgrade.swiftness.name': '날랜 발놀림',
  'upgrade.swiftness.desc': '초당 타격 +0.08.',
  'upgrade.precision.name': '매서운 눈',
  'upgrade.precision.desc': '치명타 확률 +0.5%.',
  'upgrade.ferocity.name': '맹렬함',
  'upgrade.ferocity.desc': '치명타 피해 +0.15배.',
  'upgrade.greed.name': '탐욕스러운 손',
  'upgrade.greed.desc': '처치할 때마다 골드 +7%.',
  'upgrade.tome.name': '고대의 서',
  'upgrade.tome.desc': '모든 피해 +12%.',

  'companion.torchbearer.name': '미라, 횃불잡이',
  'companion.houndmaster.name': '브람, 사냥개지기',
  'companion.runesmith.name': '세이블, 룬대장장이',
  'companion.revenant.name': '케스트, 망령',
  'companion.archivist.name': '오둔, 서고지기',

  'duration.day': '일',
  'duration.hour': '시간',
  'duration.minute': '분',
  'duration.second': '초',
};
