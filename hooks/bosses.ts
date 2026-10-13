// 마감 보스전. 외부 소스 행에 due가 있으면 보스다. 남은 시간이 체력이고, hits가 늘면 한 대 때린 것.
import type { BossEntry } from '../types'
import type { Language } from './i18n'
import { singleLine } from './agents'

export const BOSS_GROUP = '\u0000boss'
const DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_WINDOW_MS = 14 * DAY_MS
export const RAGE_MS = DAY_MS
export const HIT_FLASH_MS = 3000

export type BossView = { hp: number; remainingMs: number; isRaging: boolean; isPast: boolean }
export type ArenaEvent =
  | { kind: 'hit'; label: string; hits: number }
  | { kind: 'rage'; label: string }
  | { kind: 'past'; label: string }

const timeOf = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  const text = value.trim()
  // 날짜만 적으면 그날 하루의 끝(현지 시각)을 마감으로 본다
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:59` : text)
  return Number.isFinite(parsed) ? parsed : undefined
}

export class Boss implements BossEntry {
  readonly id: string
  readonly label: string
  readonly detail: string
  readonly group: string
  readonly due: number
  readonly since: number
  readonly hits: number

  constructor(entry: BossEntry) {
    this.id = entry.id
    this.label = entry.label
    this.detail = entry.detail
    this.group = entry.group
    this.due = entry.due
    this.since = entry.since
    this.hits = entry.hits
  }

  // due가 있는 행만 받는다. 잘못된 행은 undefined를 돌려주고 호출한 쪽이 오류 문구를 남긴다.
  static parse(row: Record<string, unknown>, source: number): Boss | undefined {
    const due = timeOf(row.due)
    const label = singleLine(typeof row.label === 'string' ? row.label : '')
    if (due === undefined || !label) return undefined
    if (['detail', 'group'].some(key => row[key] !== undefined && typeof row[key] !== 'string')) return undefined
    if (row.hits !== undefined && (typeof row.hits !== 'number' || !Number.isInteger(row.hits) || row.hits < 0)) return undefined
    const since = timeOf(row.since)
    return new Boss({
      id: `boss-${source}-${encodeURIComponent(String(row.id))}`,
      label,
      detail: singleLine(typeof row.detail === 'string' ? row.detail : ''),
      group: singleLine(typeof row.group === 'string' ? row.group : '') || BOSS_GROUP,
      due,
      since: since !== undefined && since < due ? since : due - DEFAULT_WINDOW_MS,
      hits: typeof row.hits === 'number' ? row.hits : 0,
    })
  }

  // 상태 저장소에는 평범한 객체만 넣는다
  toJSON(): BossEntry {
    const { id, label, detail, group, due, since, hits } = this
    return { id, label, detail, group, due, since, hits }
  }

  view(now: number): BossView {
    const remainingMs = this.due - now
    const total = Math.max(1, this.due - this.since)
    const hp = Math.min(1, Math.max(0, remainingMs / total))
    return { hp, remainingMs, isRaging: remainingMs > 0 && remainingMs <= RAGE_MS, isPast: remainingMs <= 0 }
  }

  static hpBar(hp: number, width = 10) {
    const filled = hp <= 0 ? 0 : Math.max(1, Math.round(hp * width))
    return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
  }

  static remainingText(language: Language, ms: number) {
    if (ms <= 0) return language === 'ko' ? '마감 지남' : 'past due'
    const hours = Math.floor(ms / 3_600_000)
    const days = Math.floor(hours / 24)
    const minutes = Math.floor((ms % 3_600_000) / 60_000)
    if (language === 'ko') return days > 0 ? `${days}일 ${hours % 24}시간` : hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`
    return days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  // 체력 줄 한 줄. 예: ██████░░░░ 62% · 8일 3시간 · 12히트
  line(language: Language, now: number) {
    const view = this.view(now)
    const hits = language === 'ko' ? `${this.hits}히트` : `${this.hits} hits`
    return `${Boss.hpBar(view.hp)} ${Math.round(view.hp * 100)}% · ${Boss.remainingText(language, view.remainingMs)} · ${hits}`
  }
}

// 경기장. 갱신마다 보스 목록을 받아 히트·분노·마감 지남을 한 번씩만 알린다.
export class Arena {
  private readonly hits = new Map<string, number>()
  private readonly flashes = new Map<string, number>()
  private readonly enraged = new Set<string>()
  private readonly gone = new Set<string>()
  private primed = false

  // isFrozen이 참인 id는 이번 갱신에 소스를 못 읽은 것이라 기준선을 지운다
  update(bosses: Boss[], now: number, isFrozen: (id: string) => boolean = () => false): ArenaEvent[] {
    const events: ArenaEvent[] = []
    const seen = new Set<string>()
    for (const boss of bosses) {
      seen.add(boss.id)
      const before = this.hits.get(boss.id)
      // 첫 갱신은 기준만 잡는다. 켜자마자 지난 히트를 다시 외치지 않는다.
      if (this.primed && before !== undefined && boss.hits > before) {
        this.flashes.set(boss.id, now + HIT_FLASH_MS)
        events.push({ kind: 'hit', label: boss.label, hits: boss.hits })
      }
      this.hits.set(boss.id, boss.hits)
      const view = boss.view(now)
      if (view.isPast) {
        if (!this.gone.has(boss.id)) {
          this.gone.add(boss.id)
          if (this.primed) events.push({ kind: 'past', label: boss.label })
        }
      } else if (view.isRaging && !this.enraged.has(boss.id)) {
        this.enraged.add(boss.id)
        events.push({ kind: 'rage', label: boss.label })
      }
    }
    for (const id of [...this.hits.keys()]) {
      if (seen.has(id) || isFrozen(id)) continue
      this.hits.delete(id)
      this.flashes.delete(id)
      this.enraged.delete(id)
      this.gone.delete(id)
    }
    this.primed = true
    return events
  }

  isFlashing(id: string, now: number) {
    const until = this.flashes.get(id)
    return until !== undefined && until > now
  }

  reset() {
    this.hits.clear()
    this.flashes.clear()
    this.enraged.clear()
    this.gone.clear()
    this.primed = false
  }
}
