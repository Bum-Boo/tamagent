import type { PluginOptions } from 'claude-code'

export type Config = {
  sources: string[][]
  refreshMs: number
  skin: string
  characters: Record<string, string>
  language: string
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
  return { sources, refreshMs: Math.round(seconds * 1000), skin, characters, language, errors }
}
