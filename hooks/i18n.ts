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
    switchCharacters: '캐릭터 바꾸기',
    resetCharacters: '기본 배정으로',
    loading: '불러오는 중…',
    locale: 'ko-KR',
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
    switchCharacters: 'Switch characters',
    resetCharacters: 'Default characters',
    loading: 'Loading…',
    locale: 'en-US',
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
