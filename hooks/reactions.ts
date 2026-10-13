// 메인 에이전트 펫. 도구가 실패하면 아프고, 위험한 명령이 보이면 놀라고, 가만히 있으면 잠든다.
// 반응은 보여 주기만 한다. 호출을 막거나 바꾸지 않는다.
import type { AgentState, ReactionEntry } from '../types'

export type ReactionKind = ReactionEntry['kind']
export type Reaction = ReactionEntry
export type Mood = { state: AgentState; detail?: string }

const DURATION: Record<ReactionKind, number> = { error: 6000, danger: 8000, denied: 6000, done: 4000 }
const STATE: Record<ReactionKind, AgentState> = { error: 'failed', danger: 'failed', denied: 'failed', done: 'idle' }

// 펫이 놀라는 기본 패턴. 되돌리기 어려운 삭제·강제 푸시·디스크 덮어쓰기 계열. 차단 규칙이 아니다.
const DANGERS: RegExp[] = [
  // rm에 재귀(-r/-R/--recursive)와 강제(-f/--force)가 어느 순서·어느 묶음으로든 같이 오면
  /(^|[\s;&|(`])(sudo\s+)?rm\s+(?=(?:-{1,2}[^\s-][^\s]*\s+)*(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(?=\s|$))(?=(?:-{1,2}[^\s-][^\s]*\s+)*(?:-[a-zA-Z]*f[a-zA-Z]*|--force)(?=\s|$))/,
  /\bgit\s+push\b[^\n|;&]*(\s--force\b|\s-f\b|\s--force-with-lease\b)/,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|checkout\s+--\s+\.|branch\s+-D\b|stash\s+(drop|clear))/,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /(^|[\s;&|(`])(sudo\s+)?(mkfs(\.[a-z0-9]+)?\b|dd\s+if=|shred\b)/,
  /\bchmod\s+-R\s+[0-7]*777\s+\//,
  />\s*\/dev\/(sd|nvme|disk)/,
  /\btruncate\s+-s\s*0\b/,
]

export class Pet {
  private reaction: Reaction | null = null
  private lastActive = 0
  private sleeping = false

  constructor(private readonly sleepMs: number, private readonly extraDanger?: RegExp) {}

  // 사용자 추가 정규식. 잘못된 정규식은 오류 문구만 남기고 무시한다.
  static parseDanger(extra: string): { pattern?: RegExp; error?: string } {
    const source = extra.trim()
    if (!source) return {}
    try {
      return { pattern: new RegExp(source, 'm') }
    } catch (error) {
      return { error: `danger: ${error instanceof Error ? error.message : 'invalid regular expression'}` }
    }
  }

  static bashCommand(e: { tool: string; command?: unknown }) {
    return e.tool === 'Bash' && typeof e.command === 'string' ? e.command : undefined
  }

  isDanger(command: string) {
    return DANGERS.some(pattern => pattern.test(command)) || (this.extraDanger ? this.extraDanger.test(command) : false)
  }

  // 무언가 했다. 자고 있었다면 깨어나고 true를 돌려준다.
  touch(now: number) {
    this.lastActive = now
    const woke = this.sleeping
    this.sleeping = false
    return woke
  }

  // 오래 조용하면 잠든다. 막 잠든 순간에만 true.
  settle(now: number) {
    if (this.sleeping || this.lastActive === 0 || now - this.lastActive < this.sleepMs) return false
    this.sleeping = true
    return true
  }

  get isAsleep() {
    return this.sleeping
  }

  react(kind: ReactionKind, tool: string, now: number): Reaction {
    this.reaction = { kind, tool, until: now + DURATION[kind] }
    return this.reaction
  }

  current(now: number): Reaction | null {
    return this.reaction && this.reaction.until > now ? this.reaction : null
  }

  // 화면에 보일 상태. 반응 > 잠 > 평소 순.
  mood(now: number, text: Record<ReactionKind, string> & { asleep: string }): Mood | undefined {
    const reaction = this.current(now)
    if (reaction) return { state: STATE[reaction.kind], detail: `${text[reaction.kind]} ${reaction.tool}` }
    if (this.sleeping) return { state: 'stale', detail: text.asleep }
    return undefined
  }

  reset() {
    this.reaction = null
    this.lastActive = 0
    this.sleeping = false
  }
}
