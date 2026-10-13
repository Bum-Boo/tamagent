// 스포츠 중계. 세션에서 일어나는 일을 두 목소리가 번갈아 해설한다.
// 0번은 차분한 캐스터, 1번은 흥분한 해설. 문구는 순서대로 돌려 쓴다.
import type { CastEntry } from '../types'
import type { Language } from './i18n'
import { singleLine } from './agents'

export type CastLine = CastEntry
export type VoiceLine = [number, string]
export type VoicePack = { voices: string[]; lines: Partial<Record<CastEvent['kind'], VoiceLine[]>> }
export type CastEvent =
  | { kind: 'start'; tool: string }
  | { kind: 'burst'; tool: string; count: number }
  | { kind: 'error'; tool: string }
  | { kind: 'danger'; tool: string }
  | { kind: 'denied'; tool: string }
  | { kind: 'turn'; seconds: number; tools: number }
  | { kind: 'spawn'; description: string }
  | { kind: 'enter'; agent: string; detail: string }
  | { kind: 'failed'; label: string }
  | { kind: 'waiting'; label: string }
  | { kind: 'hit'; label: string; hits: number }
  | { kind: 'rage'; label: string }
  | { kind: 'past'; label: string }
  | { kind: 'sleep' }
  | { kind: 'wake' }

export const BURSTS = [5, 10, 20, 40]
export const MIN_GAP_MS = 2500
export const MAX_LINES = 30
const URGENT = new Set<CastEvent['kind']>(['error', 'danger', 'denied', 'hit', 'rage', 'past'])

const KINDS: CastEvent['kind'][] = ['start', 'burst', 'error', 'danger', 'denied', 'turn', 'spawn', 'enter', 'failed', 'waiting', 'hit', 'rage', 'past', 'sleep', 'wake']
const MAX_VOICES = 6

// 내장 목소리. 0번은 차분한 캐스터, 1번은 흥분한 해설.
const KO: VoicePack = { voices: ['캐스터', '해설'], lines: {
  start: [[0, '{tool}로 턴을 엽니다.'], [0, '첫 수는 {tool}.']],
  burst: [[1, '{tool} {count}연타! 멈출 줄 모릅니다!'], [1, '{tool}만 벌써 {count}번째!']],
  error: [[1, '앗, {tool} 실패! 펫이 울상입니다.'], [1, '{tool} 실패! 다시 일어설 수 있을까요?']],
  danger: [[1, '위험한 명령 등장! 펫이 기겁했습니다!'], [1, '{tool}에서 위험 신호! 관중석이 술렁입니다!']],
  denied: [[0, '심판이 {tool} 호출을 막았습니다.'], [0, '{tool}, 반칙으로 무효.']],
  turn: [[0, '{seconds}초, 도구 {tools}회로 턴 마무리.'], [0, '턴 종료. {seconds}초 동안 도구 {tools}회.']],
  spawn: [[1, '서브에이전트 투입! {description}'], [1, '교체 선수 등장: {description}']],
  enter: [[0, '{agent} 선수, {detail} 시작.'], [0, '{agent}, 경기장 입장. {detail}']],
  failed: [[1, '{label}, 수정 요청! 코너로 돌아갑니다.']],
  waiting: [[0, '{label}, 검토 대기 중.']],
  hit: [[1, '{label} 보스에게 히트! 누적 {hits}방!'], [1, '{label}에 한 방 더! {hits}히트!']],
  rage: [[1, '{label} 보스 분노 모드! 24시간 남았습니다!']],
  past: [[0, '{label} 마감이 지났습니다. 보스가 떠났습니다.']],
  sleep: [[0, '조용하네요. 펫이 잠들었습니다.'], [0, '경기 중단. 펫은 꿈나라.']],
  wake: [[1, '펫 기상! 경기 재개!']],
} }
const EN: VoicePack = { voices: ['Caster', 'Color'], lines: {
  start: [[0, '{tool} opens the turn.'], [0, 'First move: {tool}.']],
  burst: [[1, '{tool} x{count}! No signs of slowing down!'], [1, 'That is {count} {tool} calls already!']],
  error: [[1, 'Oh no, {tool} failed! The pet looks sick.'], [1, '{tool} failed! Can it get back up?']],
  danger: [[1, 'A dangerous command! The pet is terrified!'], [1, 'Danger sign from {tool}! The crowd gasps!']],
  denied: [[0, 'The referee blocked that {tool} call.'], [0, '{tool}: foul, no play.']],
  turn: [[0, '{seconds}s and {tools} tool calls to close the turn.'], [0, 'Turn over. {tools} tools in {seconds}s.']],
  spawn: [[1, 'Subagent in! {description}'], [1, 'Substitution: {description}']],
  enter: [[0, '{agent} steps up: {detail}.'], [0, '{agent} enters the arena. {detail}']],
  failed: [[1, '{label} sent back for changes!']],
  waiting: [[0, '{label} is waiting for review.']],
  hit: [[1, 'A hit on {label}! {hits} total!'], [1, 'Another blow to {label}! {hits} hits!']],
  rage: [[1, '{label} is enraged! 24 hours left!']],
  past: [[0, '{label} is past due. The boss has left.']],
  sleep: [[0, 'All quiet. The pet fell asleep.'], [0, 'Play paused. The pet is dreaming.']],
  wake: [[1, 'The pet is up! Play resumes!']],
} }
export const builtinPack = (language: Language) => language === 'ko' ? KO : EN

// 사용자 목소리 팩. voices는 1~6명, lines는 종류별 [목소리 번호, 문구] 배열. 빠진 종류는 내장 문구로 채운다.
export function parseVoicePack(text: string): VoicePack {
  const raw = JSON.parse(text) as Record<string, unknown>
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('voice pack must be a JSON object')
  if (!Array.isArray(raw.voices) || !raw.voices.length || raw.voices.length > MAX_VOICES) throw new Error(`voice pack needs 1–${MAX_VOICES} voices`)
  const voices = raw.voices.map(one => typeof one === 'string' ? singleLine(one) : '')
  if (voices.some(name => !name)) throw new Error('every voice needs a nonempty name')
  const lines: VoicePack['lines'] = {}
  const rawLines = raw.lines && typeof raw.lines === 'object' && !Array.isArray(raw.lines) ? raw.lines as Record<string, unknown> : {}
  for (const kind of KINDS) {
    const entries = rawLines[kind]
    if (!Array.isArray(entries)) continue
    const valid = entries.flatMap((entry: unknown): VoiceLine[] => {
      if (!Array.isArray(entry) || entry.length !== 2) return []
      const [voice, line] = entry as unknown[]
      if (typeof voice !== 'number' || !Number.isInteger(voice) || voice < 0 || voice >= voices.length) return []
      if (typeof line !== 'string' || !singleLine(line)) return []
      return [[voice, singleLine(line)]]
    })
    if (valid.length) lines[kind] = valid
  }
  if (!Object.keys(lines).length) throw new Error('voice pack has no usable lines')
  return { voices, lines }
}

const fill = (template: string, event: CastEvent) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = (event as unknown as Record<string, unknown>)[key]
    return value === undefined ? '' : String(value)
  })

export class Sportscaster {
  private lines: CastLine[] = []
  private pick = 0
  private readonly toolCounts = new Map<string, number>()
  private turnTools = 0
  private pack: VoicePack | undefined

  constructor(private language: Language, private readonly casters: string[], pack?: VoicePack) {
    this.pack = pack
  }

  setLanguage(language: Language) {
    this.language = language
  }

  setPack(pack: VoicePack | undefined) {
    this.pack = pack
  }

  get hasPack() {
    return this.pack !== undefined
  }

  // 목소리 이름. 팩의 이름 위에 casters 설정이 앞에서부터 덮어쓴다.
  get voices(): string[] {
    const base = (this.pack ?? builtinPack(this.language)).voices
    return base.map((name, index) => this.casters[index] || name)
  }

  get recent(): readonly CastLine[] {
    return this.lines
  }

  get toolsThisTurn() {
    return this.turnTools
  }

  commentary(event: CastEvent): { voice: number; text: string } {
    const fallback = builtinPack(this.language)
    const lines = this.pack?.lines[event.kind] ?? fallback.lines[event.kind] ?? []
    const [voice, template] = lines[this.pick % lines.length] ?? [0, '']
    this.pick += 1
    return { voice: Math.min(voice, this.voices.length - 1), text: fill(template, event) }
  }

  // 너무 자주 떠들지 않는다. 급한 일(실패·위험·히트)은 바로, 나머지는 2.5초 간격. 같은 말은 두 번 하지 않는다.
  say(event: CastEvent, now: number): CastLine | undefined {
    const last = this.lines.at(-1)
    if (last && !URGENT.has(event.kind) && now - last.at < MIN_GAP_MS) return undefined
    const line = { at: now, ...this.commentary(event) }
    if (!line.text || (last && last.text === line.text)) return undefined
    this.lines = [...this.lines.slice(-(MAX_LINES - 1)), line]
    return line
  }

  // 턴의 첫 도구는 '시작', 같은 도구가 5·10·20·40번째면 '연타'.
  toolCalled(tool: string, now: number): CastLine | undefined {
    this.turnTools += 1
    const count = (this.toolCounts.get(tool) ?? 0) + 1
    this.toolCounts.set(tool, count)
    if (this.turnTools === 1) return this.say({ kind: 'start', tool }, now)
    if (BURSTS.includes(count)) return this.say({ kind: 'burst', tool, count }, now)
    return undefined
  }

  newTurn() {
    this.turnTools = 0
    this.toolCounts.clear()
  }

  reset() {
    this.lines = []
    this.pick = 0
    this.newTurn()
  }
}
