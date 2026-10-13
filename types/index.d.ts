export type AgentState = 'working' | 'idle' | 'stale' | 'waiting' | 'failed'
export type AgentRole = 'main' | 'subagent' | 'external' | 'queue' | 'unknown' | 'boss'
export type AgentEntry = {
  id: string
  agent: string
  label: string
  detail: string
  state: AgentState
  group: string
  role: AgentRole
}
export type ToolCall = { id: string; tool: string; isDone: boolean }
export type BossEntry = {
  id: string
  label: string
  detail: string
  group: string
  due: number
  since: number
  hits: number
}
export type Board = {
  agents: AgentEntry[]
  external: AgentEntry[]
  bosses: BossEntry[]
  polledAt: number
  errors: string[]
}
export type ReactionEntry = { kind: 'error' | 'danger' | 'denied' | 'done'; tool: string; until: number }
export type CastEntry = { at: number; voice: number; text: string }

declare module 'claude-code' {
  interface PluginState {
    tamagent: {
      calls: ToolCall[]
      board: Board | null
      isListView: boolean
      hasImages: boolean
      characterOffset: number
      reaction: ReactionEntry | null
      cast: CastEntry[]
      isCastOn: boolean
    }
  }
}
