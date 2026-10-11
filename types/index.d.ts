export type AgentState = 'working' | 'idle' | 'stale' | 'waiting' | 'failed'
export type AgentRole = 'main' | 'subagent' | 'external' | 'queue' | 'unknown'
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
export type Board = {
  agents: AgentEntry[]
  external: AgentEntry[]
  polledAt: number
  errors: string[]
}

declare module 'claude-code' {
  interface PluginState {
    tamagent: {
      calls: ToolCall[]
      board: Board | null
      isListView: boolean
      hasImages: boolean
      characterOffset: number
    }
  }
}
