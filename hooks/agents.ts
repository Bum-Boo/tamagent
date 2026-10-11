import type { AgentInfo } from 'claude-code'
import type { AgentEntry, AgentState, ToolCall } from '../types'
import type { Pose } from './sprites'

export const singleLine = (text: string) => text
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
  .trim()

export const errorText = (error: unknown) => singleLine(error instanceof Error ? error.message : String(error))

const POSES: Record<AgentState, Pose> = {
  working: 'work', idle: 'idle', stale: 'sleep', waiting: 'wait', failed: 'alert',
}
export const poseOf = (state: AgentState): Pose => POSES[state]

export function mainAgent(calls: ToolCall[]): AgentEntry {
  const active = calls.filter(call => !call.isDone)
  return {
    id: 'me', agent: 'claude', label: '나 Claude',
    detail: active.length ? `${active.at(-1)!.tool} (${active.length})` : 'idle',
    state: active.length ? 'working' : 'idle', group: '이 세션', role: 'main',
  }
}

export const subagents = (agents: AgentInfo[]): AgentEntry[] => agents
  .filter(agent => ['running', 'pending', 'waiting', 'idle'].includes(agent.status))
  .map(agent => ({
    id: `agent-${encodeURIComponent(agent.id)}`, agent: singleLine(agent.type),
    label: singleLine(agent.name || agent.type), detail: singleLine(agent.description),
    state: agent.status === 'running' ? 'working' : 'idle', group: '이 세션', role: 'subagent',
  }))

export function parseExternal(stdout: string, source: number): { entries: AgentEntry[]; errors: string[] } {
  const rows: unknown = JSON.parse(stdout)
  if (!Array.isArray(rows)) throw new Error('stdout must be a JSON array')
  const entries: AgentEntry[] = []
  const errors: string[] = []
  const ids = new Set<string>()
  rows.forEach((value: unknown, index: number) => {
    const row = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
    if (typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) ||
      typeof row.state !== 'string' || !Object.hasOwn(POSES, row.state) ||
      ['agent', 'label', 'detail', 'group'].some(key => row[key] !== undefined && typeof row[key] !== 'string')) {
      errors.push(`source ${source + 1}, row ${index + 1}: invalid fields or duplicate id`)
      return
    }
    ids.add(row.id)
    const agent = singleLine(typeof row.agent === 'string' ? row.agent : '') || 'unknown'
    const group = singleLine(typeof row.group === 'string' ? row.group : '') || '외부'
    entries.push({
      id: `external-${source}-${encodeURIComponent(row.id)}`, agent,
      label: singleLine(typeof row.label === 'string' ? row.label : '') || agent,
      detail: singleLine(typeof row.detail === 'string' ? row.detail : ''),
      state: row.state as AgentState, group,
      role: /queue/i.test(group) ? 'queue' : agent === 'unknown' || agent === '?' ? 'unknown' : 'external',
    })
  })
  return { entries, errors }
}

export function sections(session: AgentEntry[], external: AgentEntry[]) {
  const groups = new Map<string, AgentEntry[]>()
  for (const entry of external) {
    const group = groups.get(entry.group) ?? []
    group.push(entry)
    groups.set(entry.group, group)
  }
  return [{ title: '이 세션', entries: session }, ...Array.from(groups, ([title, entries]) => ({ title, entries }))]
}
