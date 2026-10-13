import type { PluginOptions } from 'claude-code'
import { singleLine } from './agents'
import { Pet } from './reactions'

export type Config = {
  sources: string[][]
  refreshMs: number
  skin: string
  characters: Record<string, string>
  language: string
  danger?: RegExp
  sportscaster: boolean
  casters: string[]
  voices: string
  sleepMs: number
  errors: string[]
}

export const safeName = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)

export function parseConfig(options: PluginOptions): Config {
  const errors: string[] = []
  const sources: string[][] = []
  try {
    const rows: unknown = JSON.parse(typeof options.sources === 'string' ? options.sources : '[]')
    if (!Array.isArray(rows)) throw new Error('JSON array of argv arrays required')
    rows.forEach((row: unknown, index: number) => {
      if (!Array.isArray(row) || row.length === 0 || row.some(arg => typeof arg !== 'string' || arg.includes('\0')) || !row[0]) {
        errors.push(`sources[${index}]: expected a nonempty argv array of strings`)
      } else {
        sources.push(row as string[])
      }
    })
  } catch {
    errors.push('sources: JSON array of argv arrays required')
  }

  let seconds = typeof options.refreshSeconds === 'number' ? options.refreshSeconds : 5
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) {
    errors.push('refreshSeconds: use 1–3600 seconds; using 5')
    seconds = 5
  }
  let skin = typeof options.skin === 'string' ? options.skin : 'default'
  if (!safeName(skin)) {
    errors.push('skin: use letters, digits, hyphens or underscores; using default')
    skin = 'default'
  }
  const characters: Record<string, string> = Object.create(null)
  const mapping = typeof options.characters === 'string' ? options.characters : ''
  for (const entry of mapping.split(',').map(one => one.trim()).filter(Boolean)) {
    const pair = entry.split('=').map(one => one.trim())
    if (pair.length !== 2 || !pair[0] || !pair[1] || !safeName(pair[1])) {
      errors.push(`characters: invalid mapping ${entry}`)
    } else {
      characters[pair[0].toLowerCase()] = pair[1]
    }
  }
  let language = typeof options.language === 'string' ? options.language : 'auto'
  if (!['auto', 'ko', 'en'].includes(language)) {
    errors.push('language: use auto, ko or en; using auto')
    language = 'auto'
  }
  const danger = Pet.parseDanger(typeof options.danger === 'string' ? options.danger : '')
  if (danger.error) errors.push(danger.error)
  let sportscaster = typeof options.sportscaster === 'string' ? options.sportscaster : 'on'
  if (!['on', 'off'].includes(sportscaster)) {
    errors.push('sportscaster: use on or off; using on')
    sportscaster = 'on'
  }
  const casters = (typeof options.casters === 'string' ? options.casters : '')
    .split(',').map(one => singleLine(one)).slice(0, 6)
  let voices = typeof options.voices === 'string' ? options.voices : 'default'
  if (!safeName(voices)) {
    errors.push('voices: use letters, digits, hyphens or underscores; using default')
    voices = 'default'
  }
  let sleepMinutes = typeof options.sleepMinutes === 'number' ? options.sleepMinutes : 10
  if (!Number.isFinite(sleepMinutes) || sleepMinutes < 1 || sleepMinutes > 1440) {
    errors.push('sleepMinutes: use 1–1440 minutes; using 10')
    sleepMinutes = 10
  }
  return {
    sources, refreshMs: Math.round(seconds * 1000), skin, characters, language, errors,
    danger: danger.pattern, sportscaster: sportscaster === 'on', casters, voices, sleepMs: Math.round(sleepMinutes * 60_000),
  }
}
