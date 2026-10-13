import { HD, LO, LO_PIXELS } from './characters'
import type { AgentEntry, AgentRole } from '../types'

export type Pose = 'work' | 'idle' | 'sleep' | 'wait' | 'alert'
export type Look = { character: string; fallback: string; pose: Pose }
export type SkinFrame = { file: string; lo: number[]; ms: number }
export type Skin = { lo: number; characters: Record<string, Partial<Record<Pose, SkinFrame[]>>> }
export type Picture = { png: string } | { file: string; format: 'png' }
export const HD_COLUMNS = 14
export const HD_ROWS = 7
export const LO_COLUMNS = LO_PIXELS
export const LO_ROWS = LO_PIXELS / 2
export const BUILTINS = ['slime', 'robot', 'mushroom', 'cloud', 'meteor'] as const
const DEFAULTS: Record<AgentRole, string> = {
  main: 'slime', subagent: 'robot', external: 'mushroom', queue: 'cloud', unknown: 'meteor', boss: 'meteor',
}
const COUNTS: Record<Pose, number> = { work: 2, idle: 4, sleep: 2, wait: 2, alert: 2 }
const POSES = Object.keys(COUNTS) as Pose[]
const OWN_MS = 450

// Imported manifests are data: invalid frames fall back to idle, then original art.
export function parseSkin(text: string, directory: string): Skin {
  const raw = JSON.parse(text) as Record<string, unknown>
  if (!raw || raw.lo !== LO_PIXELS || !raw.characters || typeof raw.characters !== 'object' || Array.isArray(raw.characters)) {
    throw new Error('manifest requires lo: 32 and a characters object')
  }
  const characters: Skin['characters'] = Object.create(null)
  for (const [id, value] of Object.entries(raw.characters)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const poses: Skin['characters'][string] = {}
    for (const pose of POSES) {
      const frames = (value as Record<string, unknown>)[pose]
      if (!Array.isArray(frames)) continue
      poses[pose] = frames.flatMap((value: unknown): SkinFrame[] => {
        if (!value || typeof value !== 'object') return []
        const frame = value as Record<string, unknown>
        if (typeof frame.file !== 'string' || !frame.file.endsWith('.png') ||
          typeof frame.ms !== 'number' || !Number.isFinite(frame.ms) || frame.ms <= 0 ||
          !Array.isArray(frame.lo) || frame.lo.length !== LO_PIXELS * LO_PIXELS ||
          frame.lo.some(pixel => !Number.isInteger(pixel) || pixel < -1 || pixel > 0xffffff)) return []
        const file = frame.file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(frame.file)
          ? frame.file : `${directory}/${frame.file}`
        return [{ file, lo: frame.lo as number[], ms: frame.ms }]
      })
    }
    if (POSES.some(pose => (poses[pose]?.length ?? 0) > 0)) characters[id] = poses
  }
  return { lo: LO_PIXELS, characters }
}

export function lookOf(entry: AgentEntry, pose: Pose, mapping: Record<string, string>, skin: Skin | undefined, offset = 0): Look {
  const fallback = DEFAULTS[entry.role]
  const names = skin && Object.keys(skin.characters).length ? Object.keys(skin.characters) : [...BUILTINS]
  // 에이전트 이름이 hermes:fern처럼 접두사를 가지면 정확한 이름 → 접두사 → 역할 순으로 찾는다
  const agent = entry.agent.toLowerCase()
  const prefix = agent.includes(':') ? agent.slice(0, agent.indexOf(':')) : undefined
  const mapped = mapping[agent] ?? (prefix ? mapping[prefix] : undefined) ?? mapping[entry.role]
  const wanted = mapped ?? (skin ? names[0]! : fallback)
  const start = Math.max(0, names.indexOf(wanted))
  const character = offset ? names[(start + offset) % names.length]! : wanted
  return { character, fallback, pose }
}

const skinFrames = (look: Look, skin: Skin | undefined) => {
  const character = skin?.characters[look.character]
  const posed = character?.[look.pose]
  return posed?.length ? posed : character?.idle?.length ? character.idle : undefined
}
const builtin = (look: Look) => (BUILTINS as readonly string[]).includes(look.character) ? look.character : look.fallback
const ownKey = (look: Look, frame: number) => `${builtin(look)}-${look.pose}-${frame % COUNTS[look.pose]}`

export function frameAt(look: Look, elapsed: number, skin: Skin | undefined) {
  const frames = skinFrames(look, skin)
  if (!frames?.length) return Math.floor(Math.max(0, elapsed) / OWN_MS) % COUNTS[look.pose]
  const total = frames.reduce((sum, frame) => sum + frame.ms, 0)
  let time = Math.max(0, elapsed) % total
  for (let i = 0; i < frames.length; i += 1) {
    time -= frames[i]!.ms
    if (time < 0) return i
  }
  return 0
}

export function hdPicture(look: Look, frame: number, skin: Skin | undefined): Picture {
  const custom = skinFrames(look, skin)?.[frame]
  return custom ? { file: custom.file, format: 'png' } : { png: HD[ownKey(look, frame)]! }
}

const DEFAULT = 0x01000000
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const INDEX = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const toBase64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

export function loCells(look: Look, frame: number, skin: Skin | undefined) {
  const custom = skinFrames(look, skin)?.[frame]
  const grid = LO[ownKey(look, frame)]!
  const pixel = (x: number, y: number): number | undefined => {
    if (custom) {
      const color = custom.lo[y * LO_PIXELS + x]!
      return color < 0 ? undefined : color
    }
    const index = INDEX.indexOf(grid.px[y * LO_PIXELS + x] ?? '.')
    return index < 0 ? undefined : grid.palette[index]
  }
  const bytes = new Uint8Array(LO_COLUMNS * LO_ROWS * 12)
  const data = new DataView(bytes.buffer)
  for (let row = 0; row < LO_ROWS; row += 1) {
    for (let x = 0; x < LO_COLUMNS; x += 1) {
      const top = pixel(x, row * 2)
      const bottom = pixel(x, row * 2 + 1)
      const at = (row * LO_COLUMNS + x) * 12
      data.setUint32(at, top !== undefined ? 0x2580 : bottom !== undefined ? 0x2584 : 0x20, true)
      data.setUint32(at + 4, top ?? bottom ?? DEFAULT, true)
      data.setUint32(at + 8, top !== undefined ? bottom ?? DEFAULT : DEFAULT, true)
    }
  }
  return toBase64(bytes)
}
