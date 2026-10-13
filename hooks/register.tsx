import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { AgentEntry, Board, ToolCall } from '../types'
import { EXTERNAL_GROUP, Roster, SESSION_GROUP, errorText, mainAgent, parseExternal, poseOf, sections, singleLine, subagents } from './agents'
import { Arena, BOSS_GROUP, Boss } from './bosses'
import type { CastEvent, VoicePack } from './caster'
import { Sportscaster, parseVoicePack } from './caster'
import type { Language } from './i18n'
import { moreText, resolveLanguage, stringsOf, updatedText } from './i18n'
import { parseConfig, safeName } from './config'
import { Pet } from './reactions'
import type { Look, Skin } from './sprites'
import { HD_COLUMNS, HD_ROWS, LO_COLUMNS, LO_ROWS, frameAt, hdPicture, loCells, lookOf, parseSkin } from './sprites'

const PANE = 'tamagent-panel'
const calls = atom({ plugin: 'tamagent', key: 'calls' } as const, [])
const board = atom({ plugin: 'tamagent', key: 'board' } as const, null)
const isListView = atom({ plugin: 'tamagent', key: 'isListView' } as const, false)
const hasImages = atom({ plugin: 'tamagent', key: 'hasImages' } as const, false)
const reaction = atom({ plugin: 'tamagent', key: 'reaction' } as const, null)
const cast = atom({ plugin: 'tamagent', key: 'cast' } as const, [])
const isCastOn = atom({ plugin: 'tamagent', key: 'isCastOn' } as const, true)
// 기본은 하는 일만: 쉬는 캐릭터는 수로만 보여 준다
const isFocus = atom({ plugin: 'tamagent', key: 'isFocus' } as const, true)
const RANK: Record<string, number> = { working: 0, failed: 1, waiting: 2, idle: 3, stale: 4 }
const GLYPH: Record<string, string> = { working: '●', failed: '✖', waiting: '◐', idle: '○', stale: '·' }
const isActive = (entry: AgentEntry) => entry.state !== 'idle' && entry.state !== 'stale'
type Slot = { key: string; label: string; detail: string; state: string; look: Look; isBoss: boolean; isHit: boolean }

// CJK characters take two terminal columns; combine marks take none.
const cutCells = (text: string, room: number) => {
  let used = 0
  let out = ''
  for (const ch of singleLine(text)) {
    const cp = ch.codePointAt(0) ?? 0
    const cells = /\p{Mark}/u.test(ch) ? 0 : cp >= 0x1100 &&
      (cp <= 0x115f || cp >= 0x2e80 && cp <= 0xa4cf || cp >= 0xac00 && cp <= 0xd7a3 ||
        cp >= 0xf900 && cp <= 0xfaff || cp >= 0xfe10 && cp <= 0xfe6f || cp >= 0xff00 && cp <= 0xff60 ||
        cp >= 0x1f300 || cp >= 0xffe0 && cp <= 0xffe6) ? 2 : 1
    if (used + cells > room) return `${out}…`
    used += cells
    out += ch
  }
  return out
}

let config = parseConfig({})
let language: Language = 'en'
let poller: Timer | undefined
let animator: Timer | undefined
let skin: Skin | undefined
let skinErrors: string[] = []
// 사용자 스킨은 읽는 동안 내장 캐릭터로 대신 그리지 않는다. 준비될 때까지 캐릭터 칸을 비워 둔다
let isSkinReady = false
let voiceErrors: string[] = []
let voiceName = 'default'
let voicesLoaded = false
let voiceRequest = 0
let animStart = 0
let elapsed = 0
let generation = 0
let isOpen = false
let starting: Promise<void> | undefined
let pollingGeneration: number | undefined
let animating = false
let shown: Slot[] = []
let shownAsImages = false
const drawnFrame = new Map<string, number>()
// 세션의 등장인물. 펫은 반응, 경기장은 보스, 출석부는 외부 에이전트, 중계석은 말을 맡는다.
let pet = new Pet(config.sleepMs, config.danger)
const arena = new Arena()
const roster = new Roster()
let caster = new Sportscaster(language, config.casters)

const moodText = () => {
  const text = stringsOf(language)
  return { error: text.reactError, danger: text.reactDanger, denied: text.reactDenied, done: text.reactDone, asleep: text.asleep }
}

// 중계 한 줄. 속도 제한에 걸리면 조용히 넘어간다.
async function announce($: EngineInterface, event: CastEvent, now: number) {
  if (!caster.say(event, now)) return
  await update($, cast, () => [...caster.recent])
}

async function react($: EngineInterface, kind: 'error' | 'danger' | 'denied' | 'done', tool: string, now: number) {
  const next = pet.react(kind, tool, now)
  await update($, reaction, () => next)
}


// 목소리 팩은 스킨처럼 홈의 ~/.local/share/tamagent/voices/<이름>.json 에서 읽는다
async function loadVoices($: EngineInterface, name: string) {
  const request = ++voiceRequest
  voicesLoaded = true
  if (name === 'default') {
    voiceErrors = []
    voiceName = name
    caster.setPack(undefined)
    return
  }
  const [home, userProfile] = await Promise.all([$.env.get('HOME').catch(() => undefined), $.env.get('USERPROFILE').catch(() => undefined)])
  const root = home || userProfile
  const errors: string[] = []
  let pack: VoicePack | undefined
  if (!root) {
    errors.push('voices: HOME is unset; using default voices')
  } else {
    try {
      pack = parseVoicePack(await $.fs.read(`${root.replace(/[\\/]$/, '')}/.local/share/tamagent/voices/${name}.json`))
    } catch (error) {
      errors.push(`voices ${name}: ${errorText(error)}; using default voices`)
    }
  }
  // 늦게 끝난 옛 요청은 버린다. 마지막 요청이 이긴다
  if (request !== voiceRequest) return
  voiceErrors = errors
  voiceName = name
  caster.setPack(pack)
}

async function initialize($: EngineInterface) {
  isSkinReady = false
  const errors: string[] = []
  let loaded: Skin | undefined
  const [term, program, kittyWindow, home, userProfile] = await Promise.all([
    $.env.get('TERM').catch(() => undefined), $.env.get('TERM_PROGRAM').catch(() => undefined),
    $.env.get('KITTY_WINDOW_ID').catch(() => undefined), $.env.get('HOME').catch(() => undefined),
    $.env.get('USERPROFILE').catch(() => undefined),
  ])
  await update($, hasImages, () => term === 'xterm-kitty' || !!kittyWindow ||
    term === 'xterm-ghostty' || program?.toLowerCase() === 'ghostty')
  const root = home || userProfile
  if (config.skin !== 'default' && !root) {
    errors.push('skin: HOME is unset; using bundled characters')
  } else if (config.skin !== 'default') {
    const directory = `${root!.replace(/[\\/]$/, '')}/.local/share/tamagent/skins/${config.skin}`
    try {
      const manifest = parseSkin(await $.fs.read(`${directory}/manifest.json`), directory)
      const files = new Map<string, boolean>()
      const allFrames = Object.values(manifest.characters).flatMap(poses => Object.values(poses).flat())
      await Promise.all([...new Set(allFrames.map(frame => frame.file))].map(async file => {
        files.set(file, await $.fs.stat(file).then(stat => stat.kind === 'file', () => false))
      }))
      for (const [id, poses] of Object.entries(manifest.characters)) {
        for (const pose of Object.keys(poses) as (keyof typeof poses)[]) {
          poses[pose] = poses[pose]?.filter(frame => files.get(frame.file))
        }
        if (!Object.values(poses).some(frames => frames.length)) delete manifest.characters[id]
      }
      if (!Object.keys(manifest.characters).length) throw new Error('no usable PNG frames')
      if ([...files.values()].some(exists => !exists)) errors.push('skin: missing PNG frames; using idle or bundled characters')
      loaded = manifest
    } catch (error) {
      errors.push(`skin ${config.skin}: ${errorText(error)}; using bundled characters`)
    }
  }
  skin = loaded
  skinErrors = errors
  isSkinReady = true
}

async function poll($: EngineInterface, token: number) {
  if (!isOpen || token !== generation || pollingGeneration === token) return
  pollingGeneration = token
  try {
    const [local, ...external] = await Promise.all([
      $.agent.list().then(agents => ({ entries: subagents(agents), bosses: [] as Boss[], errors: [] as string[] }),
        (error: unknown) => ({ entries: [], bosses: [] as Boss[], errors: [`${stringsOf(language).subagents}: ${errorText(error)}`] })),
      ...config.sources.map(async (argv, index) => {
        try {
          const ran = await $.process.run(argv, { timeoutMs: 8000 })
          if (ran.exitCode !== 0) throw new Error(ran.stderr.trim().split('\n').pop() || `exit ${ran.exitCode}`)
          if (ran.isStdoutTruncated) throw new Error('stdout exceeded 4 MiB')
          return parseExternal(ran.stdout, index)
        } catch (error) {
          return { entries: [], bosses: [] as Boss[], errors: [`source ${index + 1} (${argv[0]}): ${errorText(error)}`] }
        }
      }),
    ])
    if (!isOpen || token !== generation) return
    const now = await $.clock.now()
    const entries = external.flatMap(result => result.entries)
    const bosses = external.flatMap(result => result.bosses)
    const next: Board = {
      agents: local!.entries, external: entries, bosses: bosses.map(boss => boss.toJSON()), polledAt: now,
      errors: [...config.errors, ...skinErrors, ...voiceErrors, ...local!.errors, ...external.flatMap(result => result.errors)],
    }
    await update($, board, () => next)
    // 경기 상황 중계: 새 선수, 보스 히트·분노, 잠든 펫
    // 이번 갱신에 실패한 소스의 행은 떠난 게 아니라 못 읽은 것이다. 기준선을 지키고 다시 외치지 않는다
    const failed = external.flatMap((result, index) => result.errors.length && !result.entries.length && !result.bosses.length ? [index] : [])
    const isFrozen = (id: string) => failed.some(index => id.startsWith(`external-${index}-`) || id.startsWith(`boss-${index}-`))
    for (const event of roster.update(entries, isFrozen)) await announce($, event, now)
    for (const event of arena.update(bosses, now, isFrozen)) {
      if (event.kind === 'rage') try { $.ui.toast(stringsOf(language).rageToast(event.label)) } catch { /* 장식 */ }
      await announce($, event, now)
    }
    if (pet.settle(now)) {
      await update($, reaction, current => current)
      await announce($, { kind: 'sleep' }, now)
    }
  } finally {
    if (pollingGeneration === token) pollingGeneration = undefined
  }
}

async function animate($: EngineInterface) {
  if (!isOpen || animating || !shown.length || !isSkinReady) return
  animating = true
  try {
    elapsed = Math.max(0, (await $.clock.now()) - animStart)
    await Promise.all(shown.map(async slot => {
      const frame = frameAt(slot.look, elapsed, skin)
      if (drawnFrame.get(slot.key) === frame) return
      await (shownAsImages
        ? $.ui.blit({ requestId: PANE, key: slot.key, source: hdPicture(slot.look, frame, skin) })
        : $.ui.blit({ requestId: PANE, key: slot.key, cells: loCells(slot.look, frame, skin) }))
      .then(result => { if (!result.deny) drawnFrame.set(slot.key, frame) }, () => undefined)
    }))
  } finally {
    animating = false
  }
}

async function detectLanguage($: EngineInterface) {
  const locales = await Promise.all([
    $.env.get('LC_ALL').catch(() => undefined),
    $.env.get('LC_MESSAGES').catch(() => undefined),
    $.env.get('LANG').catch(() => undefined),
  ])
  language = resolveLanguage(config.language, locales)
  caster.setLanguage(language)
}

async function startPolling($: EngineInterface) {
  if (starting) {
    await starting
    if (isOpen) return
  }
  if (isOpen) return
  isOpen = true
  const token = ++generation
  starting = (async () => {
    await initialize($)
    if (!isOpen || token !== generation) return
    animStart = await $.clock.now()
    elapsed = 0
    await poll($, token)
    if (!isOpen || token !== generation) return
    poller = $.clock.every(config.refreshMs, () => void poll($, token).catch(() => undefined))
    animator = $.clock.every(100, () => void animate($).catch(() => undefined))
  })()
  try {
    await starting
  } finally {
    starting = undefined
  }
}

function stopPolling() {
  isOpen = false
  generation += 1
  poller?.cancel()
  animator?.cancel()
  poller = undefined
  animator = undefined
  shown = []
  drawnFrame.clear()
}

// 보스를 패널 칸으로. 맞는 중·분노·마감 지남이면 놀란 포즈, 평소엔 버티는 포즈.
function bossEntries(bosses: Boss[], now: number): AgentEntry[] {
  return bosses.map(boss => {
    const view = boss.view(now)
    const isHit = arena.isFlashing(boss.id, now)
    return {
      id: boss.id, agent: 'boss', label: boss.label, detail: boss.line(language, now),
      state: isHit || view.isRaging || view.isPast ? 'failed' : 'waiting', group: boss.group, role: 'boss',
    }
  })
}

export const register: Register = (on, options) => {
  config = parseConfig(options)
  // 플러그인이 다시 읽힐 때 지난 세션의 타이머·기준선이 남지 않게 한다
  stopPolling()
  isSkinReady = false
  pet = new Pet(config.sleepMs, config.danger)
  caster = new Sportscaster(language, config.casters)
  arena.reset()
  roster.reset()
  voicesLoaded = false
  voiceErrors = []

  on('session.start', async ($, e, next) => {
    await detectLanguage($).catch(() => undefined)
    await update($, isCastOn, () => config.sportscaster)
    await loadVoices($, config.voices)
    await $.command.register({ name: 'tama', description: stringsOf(language).command })
    const panes = await $.ui.panes().catch(() => [])
    if (panes.some(pane => pane.id === PANE)) await startPolling($)
    return next(e)
  })

  on('command.run', { command: 'tama' }, async ($, e) => {
    await detectLanguage($).catch(() => undefined)
    if (!voicesLoaded) await loadVoices($, config.voices)
    const text = stringsOf(language)
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    if (verb?.toLowerCase() === 'voice') {
      const name = rest.join(' ').trim()
      if (!name || !safeName(name)) return { text: text.voiceUsage }
      await loadVoices($, name)
      if (voiceErrors.length) return { text: voiceErrors.join('\n') }
      return { text: name === 'default' ? text.voiceDefault : text.voiceSet(name, caster.voices) }
    }
    if (e.args.trim().toLowerCase() === 'cast') {
      const enabled = !(await read($, isCastOn))
      await update($, isCastOn, () => enabled)
      return { text: enabled ? text.castOn : text.castOff }
    }
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Tamagent' })
    await startPolling($)
    return { text: isPlaced ? text.opened : text.narrow }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) stopPolling()
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopPolling()
    pet.reset()
    arena.reset()
    roster.reset()
    caster.reset()
    await update($, calls, () => [])
    await update($, board, () => null)
    await update($, reaction, () => null)
    await update($, cast, () => [])
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    caster.newTurn()
    if (pet.touch(now)) await announce($, { kind: 'wake' }, now)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const now = await $.clock.now()
    await announce($, { kind: 'spawn', description: singleLine(e.description) }, now)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    const now = await $.clock.now()
    pet.touch(now)
    if (e.reason === 'error') await react($, 'error', 'turn', now)
    else if (e.reason === 'answer') await react($, 'done', '', now)
    await announce($, { kind: 'turn', seconds: Math.round(e.durationMs / 1000), tools: caster.toolsThisTurn }, now)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const now = await $.clock.now()
    const call: ToolCall = { id: e.tool_use_id, tool: e.tool, isDone: false }
    await update($, calls, list => [...list.filter(one => !one.isDone), ...list.filter(one => one.isDone).slice(-199), call])
    if (pet.touch(now)) await announce($, { kind: 'wake' }, now)
    if (caster.toolCalled(e.tool, now)) await update($, cast, () => [...caster.recent])
    const command = Pet.bashCommand(e)
    if (command !== undefined && pet.isDanger(command)) {
      await react($, 'danger', e.tool, now)
      try { $.ui.toast(stringsOf(language).dangerToast) } catch { /* 장식 */ }
      await announce($, { kind: 'danger', tool: e.tool }, now)
    }
    // next(e) 뒤의 일은 모두 삼킨다. 여기서 던지면 .catch가 next(e)를 다시 불러 도구가 두 번 돌 수 있다
    const out = await next(e)
    try {
      const after = await $.clock.now()
      if (out.deny) {
        await react($, 'denied', e.tool, after)
        await announce($, { kind: 'denied', tool: e.tool }, after)
      } else if (out.isError) {
        await react($, 'error', e.tool, after)
        await announce($, { kind: 'error', tool: e.tool }, after)
      }
    } catch {
      // 반응은 장식이다. 결과는 그대로 돌려준다
    }
    await update($, calls, list => list.map(one => one.id === call.id ? { ...one, isDone: true } : one)).catch(() => undefined)
    return out
  }).catch(($, e, next) => next.called ? undefined as never : next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isCastOn))) return next(e)
    const lines = (await read($, cast)).slice(-2)
    if (!lines.length) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const text = stringsOf(language)
    const voices = caster.voices
    const colors = ['claude', 'warning', 'success', 'remember', 'permission', 'ide']
    const width = Math.max(24, e.props.bodyColumns - 2)
    const nameRoom = Math.max(...voices.map(name => name.length)) * 2 + 8
    return (
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Box key={`cast-${line.at}-${index}`} flexDirection="row" gap={1}>
            <Text dimColor>{new Date(line.at).toLocaleTimeString(text.locale, { hour: '2-digit', minute: '2-digit' })}</Text>
            <Text bold color={colors[line.voice % colors.length]}>{voices[line.voice] ?? voices[0]}</Text>
            <Text>{cutCells(line.text, width - nameRoom - (index === lines.length - 1 ? text.hideCast.length * 2 + 4 : 0))}</Text>
            {index === lines.length - 1 && <Button key="mute" label={text.hideCast} onPress={() => update($, isCastOn, () => false)} />}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Raster = e.surface === 'terminal' && 'Raster' in elements ? elements.Raster : undefined
    const Image = e.surface === 'terminal' && 'Image' in elements ? elements.Image : undefined
    const useImages = Image !== undefined && await read($, hasImages)
    const current = await read($, board)
    const history = await read($, calls)
    const isList = await read($, isListView)
    const focus = await read($, isFocus)
    await read($, reaction)
    const now = await $.clock.now()
    elapsed = Math.max(0, now - animStart)
    const width = Math.max(20, (e.viewport?.columns ?? e.props.bodyColumns) - 2)
    const text = stringsOf(language)
    const titleOf = (title: string) => title === SESSION_GROUP ? text.session : title === EXTERNAL_GROUP ? text.external : title === BOSS_GROUP ? text.boss : title
    const bosses = (current?.bosses ?? []).map(entry => new Boss(entry))
    const groups = sections([mainAgent(history, text, pet.mood(now, moodText())), ...(current?.agents ?? [])],
      [...bossEntries(bosses, now), ...(current?.external ?? [])])
      .map(group => ({ ...group, title: titleOf(group.title), entries: [...group.entries].sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9)) }))
    // 지금 하는 일: 섹션을 가로질러 움직이는 것만 한 줄씩
    const activeLines = groups.flatMap(group => group.entries.filter(entry => isActive(entry) && entry.role !== 'boss')
      .map(entry => `${GLYPH[entry.state] ?? '○'} ${group.title} · ${entry.label} · ${entry.detail}`))
    const NOW_ROWS = 8
    const nowBlock = (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{`${text.now} (${activeLines.length})`}</Text>
        {activeLines.length === 0 && <Text dimColor>{text.quiet}</Text>}
        {activeLines.slice(0, NOW_ROWS).map((line, index) => <Text key={`now-${index}`}>{cutCells(line, width - 1)}</Text>)}
        {activeLines.length > NOW_ROWS && <Text dimColor>{moreText(language, activeLines.length - NOW_ROWS)}</Text>}
      </Box>
    )
    const controls = (
      <Box flexDirection="row" gap={1}>
        <Button key="view" label={isList ? text.showCharacters : text.showList}
          onPress={() => update($, isListView, value => !value)} />
        <Button key="focus" label={focus ? text.showAll : text.focus}
          onPress={() => update($, isFocus, value => !value)} />
      </Box>
    )
    const errors = (current?.errors ?? [...config.errors, ...skinErrors, ...voiceErrors]).map((error, index) => (
      <Text key={`error-${index}`} dimColor>{cutCells(`! ${error}`, width - 1)}</Text>
    ))
    const footer = current === null ? <Text dimColor>{text.loading}</Text> : (
      <Text dimColor>{updatedText(language, new Date(current.polledAt).toLocaleTimeString(text.locale), config.refreshMs / 1000)}</Text>
    )
    if (!isSkinReady && !isList) {
      shown = []
      drawnFrame.clear()
      return (
        <Box flexDirection="column">
          {controls}
          {nowBlock}
          <Text dimColor>{text.loading}</Text>
        </Box>
      )
    }
    const cellWidth = useImages ? HD_COLUMNS : LO_COLUMNS
    // Very narrow panes show the list rather than clipping a 32-column raster.
    if (isList || !Raster || width < cellWidth + 2) {
      shown = []
      drawnFrame.clear()
      return (
        <Box flexDirection="column">
          {controls}
          {nowBlock}
          {groups.map((group, index) => (
            <Box key={`group-${index}`} flexDirection="column" marginBottom={1}>
              <Text bold>{`${group.title} (${group.entries.length})`}</Text>
              {group.entries.map(entry => (
                <Text key={entry.id} dimColor={entry.state === 'idle' || entry.state === 'stale'}>
                  {cutCells(`${entry.state} ${entry.label} · ${entry.detail}`, width - 1)}
                </Text>
              ))}
            </Box>
          ))}
          {errors}{footer}
        </Box>
      )
    }

    const slotWidth = cellWidth + 2
    // 보스 칸은 체력 줄이 길어서 두 칸 너비까지 쓴다
    const bossWidth = Math.min(width, slotWidth * 2)
    const room = Math.max(1, Math.floor(width / slotWidth)) * 2
    const drawn: Slot[] = []
    const tree = (
      <Box flexDirection="column">
        {controls}
        {nowBlock}
        {groups.map((group, index) => {
          // 하는 일만 모드: 메인·보스는 늘 그리고, 쉬는 캐릭터는 수로만
          const entries = focus ? group.entries.filter(entry => isActive(entry) || entry.role === 'main' || entry.role === 'boss') : group.entries
          const resting = group.entries.length - entries.length
          if (!entries.length) {
            return <Text key={`group-${index}`} dimColor>{cutCells(`${group.title} · ${text.resting(resting)}`, width - 1)}</Text>
          }
          const slots = entries.map((entry): Slot => ({
            key: entry.id, label: entry.label, detail: entry.detail, state: entry.state,
            look: lookOf(entry, poseOf(entry.state), config.characters, skin),
            isBoss: entry.role === 'boss', isHit: entry.role === 'boss' && arena.isFlashing(entry.id, now),
          }))
          const visible = slots.slice(0, room)
          drawn.push(...visible)
          return (
            <Box key={`group-${index}`} flexDirection="column" marginBottom={1}>
              <Text bold>{`${group.title} (${group.entries.length})`}</Text>
              <Box flexDirection="row" flexWrap="wrap">
                {visible.map(slot => (
                  <Box key={`slot-${slot.key}`} flexDirection="column" width={slot.isBoss ? bossWidth : slotWidth}>
                    {useImages && Image ? (
                      <Image key={slot.key} columns={HD_COLUMNS} rows={HD_ROWS}
                        source={hdPicture(slot.look, frameAt(slot.look, elapsed, skin), skin)}
                        alt={`${slot.look.character} ${slot.look.pose}`} />
                    ) : (
                      <Raster key={slot.key} columns={LO_COLUMNS} rows={LO_ROWS}
                        cells={loCells(slot.look, frameAt(slot.look, elapsed, skin), skin)} />
                    )}
                    <Text bold={slot.isHit} color={slot.isHit ? 'error' : undefined}>
                      {cutCells(slot.isHit ? `${slot.label} ${text.hit}` : slot.label, (slot.isBoss ? bossWidth : slotWidth) - 2)}
                    </Text>
                    <Text dimColor>{cutCells(slot.detail, (slot.isBoss ? bossWidth : slotWidth) - 2)}</Text>
                  </Box>
                ))}
              </Box>
              {slots.length > room && <Text dimColor>{moreText(language, slots.length - room)}</Text>}
              {resting > 0 && <Text dimColor>{text.resting(resting)}</Text>}
            </Box>
          )
        })}
        {errors}{footer}
      </Box>
    )
    shown = drawn
    shownAsImages = !!useImages
    drawnFrame.clear()
    for (const slot of shown) drawnFrame.set(slot.key, frameAt(slot.look, elapsed, skin))
    return tree
  })
}
