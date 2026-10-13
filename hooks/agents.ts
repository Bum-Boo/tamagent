import type { AgentInfo } from 'claude-code'
import type { AgentEntry, AgentState, ToolCall } from '../types'
import { Boss } from './bosses'
import type { Mood } from './reactions'
import type { Pose } from './sprites'

// 내장 그룹 ID. 외부 group 값은 singleLine으로 제어 문자가 지워지므로 이 값과 겹칠 수 없다
export const SESSION_GROUP = '\u0000session'
export const EXTERNAL_GROUP = '\u0000external'

export const singleLine = (text: string) => text
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
  .trim()

export const errorText = (error: unknown) => singleLine(error instanceof Error ? error.message : String(error))

const POSES: Record<AgentState, Pose> = {
  working: 'work', idle: 'idle', stale: 'sleep', waiting: 'wait', failed: 'alert',
}
export const poseOf = (state: AgentState): Pose => POSES[state]

// 펫의 기분(반응·잠)이 있으면 그게 평소 상태보다 먼저다
export function mainAgent(calls: ToolCall[], text: { me: string; idle: string } = { me: 'Me (Claude)', idle: 'idle' }, mood?: Mood): AgentEntry {
  const active = calls.filter(call => !call.isDone)
  const base: AgentEntry = {
    id: 'me', agent: 'claude', label: text.me,
    detail: active.length ? `${active.at(-1)!.tool} (${active.length})` : text.idle,
    state: active.length ? 'working' : 'idle', group: SESSION_GROUP, role: 'main',
  }
  return mood ? { ...base, state: mood.state, detail: mood.detail ?? base.detail } : base
}

export const subagents = (agents: AgentInfo[]): AgentEntry[] => agents
  .filter(agent => ['running', 'pending', 'waiting', 'idle'].includes(agent.status))
  .map(agent => ({
    id: `agent-${encodeURIComponent(agent.id)}`, agent: singleLine(agent.type),
    label: singleLine(agent.name || agent.type), detail: singleLine(agent.description),
    state: agent.status === 'running' ? 'working' : 'idle', group: SESSION_GROUP, role: 'subagent',
  }))

// 행에 due가 있으면 에이전트가 아니라 보스다
export function parseExternal(stdout: string, source: number): { entries: AgentEntry[]; bosses: Boss[]; errors: string[] } {
  const rows: unknown = JSON.parse(stdout)
  if (!Array.isArray(rows)) throw new Error('stdout must be a JSON array')
  const entries: AgentEntry[] = []
  const bosses: Boss[] = []
  const errors: string[] = []
  const ids = new Set<string>()
  rows.forEach((value: unknown, index: number) => {
    const row = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
    if (typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)) {
      errors.push(`source ${source + 1}, row ${index + 1}: invalid fields or duplicate id`)
      return
    }
    if (row.due !== undefined) {
      const boss = Boss.parse(row, source)
      if (boss) {
        ids.add(row.id)
        bosses.push(boss)
      } else {
        errors.push(`source ${source + 1}, row ${index + 1}: boss needs a label and a valid due date`)
      }
      return
    }
    if (typeof row.state !== 'string' || !Object.hasOwn(POSES, row.state) ||
      ['agent', 'label', 'detail', 'group'].some(key => row[key] !== undefined && typeof row[key] !== 'string')) {
      errors.push(`source ${source + 1}, row ${index + 1}: invalid fields or duplicate id`)
      return
    }
    ids.add(row.id)
    const agent = singleLine(typeof row.agent === 'string' ? row.agent : '') || 'unknown'
    const group = singleLine(typeof row.group === 'string' ? row.group : '') || EXTERNAL_GROUP
    entries.push({
      id: `external-${source}-${encodeURIComponent(row.id)}`, agent,
      label: singleLine(typeof row.label === 'string' ? row.label : '') || agent,
      detail: singleLine(typeof row.detail === 'string' ? row.detail : ''),
      state: row.state as AgentState, group,
      role: /queue/i.test(group) ? 'queue' : agent === 'unknown' || agent === '?' ? 'unknown' : 'external',
    })
  })
  return { entries, bosses, errors }
}

export type RosterEvent =
  | { kind: 'enter'; agent: string; detail: string }
  | { kind: 'failed'; label: string }
  | { kind: 'waiting'; label: string }

// 외부 에이전트 출석부. 새로 온 선수와 상태가 바뀐 선수를 한 번씩만 알린다.
export class Roster {
  private readonly states = new Map<string, AgentState>()
  private primed = false

  // isFrozen이 참인 id는 이번 갱신에 소스를 못 읽은 것이라 출석부를 지운다
  update(entries: AgentEntry[], isFrozen: (id: string) => boolean = () => false): RosterEvent[] {
    const events: RosterEvent[] = []
    const seen = new Set<string>()
    for (const entry of entries) {
      seen.add(entry.id)
      const before = this.states.get(entry.id)
      // 첫 갱신은 기준만 잡는다
      if (this.primed && before === undefined) events.push({ kind: 'enter', agent: entry.label, detail: entry.detail })
      else if (before !== undefined && before !== entry.state) {
        if (entry.state === 'failed') events.push({ kind: 'failed', label: entry.label })
        else if (entry.state === 'waiting') events.push({ kind: 'waiting', label: entry.label })
      }
      this.states.set(entry.id, entry.state)
    }
    for (const id of [...this.states.keys()]) if (!seen.has(id) && !isFrozen(id)) this.states.delete(id)
    this.primed = true
    return events
  }

  reset() {
    this.states.clear()
    this.primed = false
  }
}

export function sections(session: AgentEntry[], external: AgentEntry[]) {
  const groups = new Map<string, AgentEntry[]>()
  for (const entry of external) {
    const group = groups.get(entry.group) ?? []
    group.push(entry)
    groups.set(entry.group, group)
  }
  return [{ title: SESSION_GROUP, entries: session }, ...Array.from(groups, ([title, entries]) => ({ title, entries }))]
}
