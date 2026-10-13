// 화면 문구. language 설정이 auto면 LC_ALL → LC_MESSAGES → LANG 순으로 보고, ko로 시작하면 한국어, 그 밖은 영어.

export type Language = 'ko' | 'en'

const STRINGS = {
  ko: {
    me: '나 Claude',
    idle: '대기',
    session: '이 세션',
    external: '외부',
    subagents: '서브에이전트',
    command: 'Tamagent 에이전트 패널 열기',
    opened: 'Tamagent 패널을 열었어요.',
    narrow: '터미널을 넓히면 Tamagent 패널이 보여요.',
    showCharacters: '캐릭터로 보기',
    showList: '목록으로 보기',
    loading: '불러오는 중…',
    locale: 'ko-KR',
    boss: '보스전',
    reactError: '앗, 실패!',
    reactDanger: '위험 명령!',
    reactDenied: '차단됨',
    reactDone: '완료!',
    asleep: 'zZ',
    dangerToast: 'Tamagent: 위험해 보이는 명령에 펫이 놀랐어요',
    rageToast: (label: string) => `Tamagent: ${label} 마감 24시간 전, 보스 분노 모드`,
    castOn: '중계를 켰어요.',
    castOff: '중계를 껐어요. /tama cast 로 다시 켜요.',
    hideCast: '중계 끄기',
    hit: 'HIT!',
    voiceSet: (name: string, voices: string[]) => `목소리 팩 ${name}: ${voices.join(', ')}`,
    voiceDefault: '기본 목소리로 돌아왔어요.',
    voiceUsage: '/tama voice <팩 이름> 또는 /tama voice default',
    now: '지금 하는 일',
    quiet: '지금은 조용해요.',
    focus: '하는 일만',
    showAll: '모두 보기',
    resting: (count: number) => `쉬는 중 ${count}`,
  },
  en: {
    me: 'Me (Claude)',
    idle: 'idle',
    session: 'This session',
    external: 'External',
    subagents: 'Subagents',
    command: 'Open the Tamagent agent panel',
    opened: 'Opened the Tamagent panel.',
    narrow: 'Widen the terminal to see the Tamagent panel.',
    showCharacters: 'Characters',
    showList: 'List',
    loading: 'Loading…',
    locale: 'en-US',
    boss: 'Boss fight',
    reactError: 'Ouch, failed!',
    reactDanger: 'Danger!',
    reactDenied: 'Blocked',
    reactDone: 'Done!',
    asleep: 'zZ',
    dangerToast: 'Tamagent: the pet panicked at a dangerous-looking command',
    rageToast: (label: string) => `Tamagent: ${label} is due in 24 hours, boss enraged`,
    castOn: 'Commentary on.',
    castOff: 'Commentary off. /tama cast turns it back on.',
    hideCast: 'Mute',
    hit: 'HIT!',
    voiceSet: (name: string, voices: string[]) => `Voice pack ${name}: ${voices.join(', ')}`,
    voiceDefault: 'Back to the default voices.',
    voiceUsage: '/tama voice <pack name> or /tama voice default',
    now: 'Happening now',
    quiet: 'All quiet.',
    focus: 'Active only',
    showAll: 'Show all',
    resting: (count: number) => `${count} resting`,
  },
} as const

export type Strings = (typeof STRINGS)[Language]

export const stringsOf = (language: Language): Strings => STRINGS[language]

export const updatedText = (language: Language, time: string, seconds: number) =>
  language === 'ko' ? `${time} 갱신 · ${seconds}초마다` : `Updated ${time} · every ${seconds}s`

export const moreText = (language: Language, count: number) =>
  language === 'ko' ? `+${count}명 더 · 목록에서 보기` : `+${count} more · see List`

// setting: 'auto' | 'ko' | 'en'; locales: LC_ALL, LC_MESSAGES, LANG 순서
export const resolveLanguage = (setting: string, locales: (string | undefined)[]): Language => {
  if (setting === 'ko' || setting === 'en') return setting
  const locale = locales.find(value => value && value !== 'C' && value !== 'POSIX') ?? ''
  return /^ko\b|^ko[_-]/i.test(locale) ? 'ko' : 'en'
}
