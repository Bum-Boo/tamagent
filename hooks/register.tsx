import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { Board, ToolCall } from '../types'
import { errorText, mainAgent, parseExternal, poseOf, sections, singleLine, subagents } from './agents'
import { parseConfig } from './config'
import type { Look, Skin } from './sprites'
import { HD_COLUMNS, HD_ROWS, LO_COLUMNS, LO_ROWS, frameAt, hdPicture, loCells, lookOf, parseSkin } from './sprites'

const PANE = 'tamagent-panel'
const calls = atom({ plugin: 'tamagent', key: 'calls' } as const, [])
const board = atom({ plugin: 'tamagent', key: 'board' } as const, null)
const isListView = atom({ plugin: 'tamagent', key: 'isListView' } as const, false)
const hasImages = atom({ plugin: 'tamagent', key: 'hasImages' } as const, false)
const characterOffset = atom({ plugin: 'tamagent', key: 'characterOffset' } as const, 0)
type Slot = { key: string; label: string; detail: string; state: string; look: Look }

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
let poller: Timer | undefined
let animator: Timer | undefined
let skin: Skin | undefined
let skinErrors: string[] = []
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

async function initialize($: EngineInterface) {
  skin = undefined
  skinErrors = []
  const [term, program, kittyWindow, home, userProfile] = await Promise.all([
    $.env.get('TERM').catch(() => undefined), $.env.get('TERM_PROGRAM').catch(() => undefined),
    $.env.get('KITTY_WINDOW_ID').catch(() => undefined), $.env.get('HOME').catch(() => undefined),
    $.env.get('USERPROFILE').catch(() => undefined),
  ])
  await update($, hasImages, () => term === 'xterm-kitty' || !!kittyWindow ||
    term === 'xterm-ghostty' || program?.toLowerCase() === 'ghostty')
  if (config.skin === 'default') return
  const root = home || userProfile
  if (!root) {
    skinErrors.push('skin: HOME is unset; using bundled characters')
    return
  }
  const directory = `${root.replace(/[\\/]$/, '')}/.local/share/tamagent/skins/${config.skin}`
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
    if ([...files.values()].some(exists => !exists)) skinErrors.push('skin: missing PNG frames; using idle or bundled characters')
    skin = manifest
  } catch (error) {
    skinErrors.push(`skin ${config.skin}: ${errorText(error)}; using bundled characters`)
  }
}

async function poll($: EngineInterface, token: number) {
  if (!isOpen || token !== generation || pollingGeneration === token) return
  pollingGeneration = token
  try {
    const [local, ...external] = await Promise.all([
      $.agent.list().then(agents => ({ entries: subagents(agents), errors: [] as string[] }),
        (error: unknown) => ({ entries: [], errors: [`서브에이전트: ${errorText(error)}`] })),
      ...config.sources.map(async (argv, index) => {
        try {
          const ran = await $.process.run(argv, { timeoutMs: 8000 })
          if (ran.exitCode !== 0) throw new Error(ran.stderr.trim().split('\n').pop() || `exit ${ran.exitCode}`)
          if (ran.isStdoutTruncated) throw new Error('stdout exceeded 4 MiB')
          return parseExternal(ran.stdout, index)
        } catch (error) {
          return { entries: [], errors: [`source ${index + 1} (${argv[0]}): ${errorText(error)}`] }
        }
      }),
    ])
    if (!isOpen || token !== generation) return
    const next: Board = {
      agents: local!.entries, external: external.flatMap(result => result.entries), polledAt: await $.clock.now(),
      errors: [...config.errors, ...skinErrors, ...local!.errors, ...external.flatMap(result => result.errors)],
    }
    await update($, board, () => next)
  } finally {
    if (pollingGeneration === token) pollingGeneration = undefined
  }
}

async function animate($: EngineInterface) {
  if (!isOpen || animating || !shown.length) return
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

export const register: Register = (on, options) => {
  config = parseConfig(options)
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tama', description: 'Tamagent 에이전트 패널 열기' })
    const panes = await $.ui.panes().catch(() => [])
    if (panes.some(pane => pane.id === PANE)) await startPolling($)
    return next(e)
  })

  on('command.run', { command: 'tama' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Tamagent' })
    await startPolling($)
    return { text: isPlaced ? 'Tamagent 패널을 열었어요.' : '터미널을 넓히면 Tamagent 패널이 보여요.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) stopPolling()
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopPolling()
    await update($, calls, () => [])
    await update($, board, () => null)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const call: ToolCall = { id: e.tool_use_id, tool: e.tool, isDone: false }
    await update($, calls, list => [...list.filter(one => !one.isDone), ...list.filter(one => one.isDone).slice(-199), call])
    try {
      return await next(e)
    } finally {
      await update($, calls, list => list.map(one => one.id === call.id ? { ...one, isDone: true } : one))
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Raster = e.surface === 'terminal' && 'Raster' in elements ? elements.Raster : undefined
    const Image = e.surface === 'terminal' && 'Image' in elements ? elements.Image : undefined
    const useImages = Image !== undefined && await read($, hasImages)
    const current = await read($, board)
    const history = await read($, calls)
    const isList = await read($, isListView)
    const offset = await read($, characterOffset)
    elapsed = Math.max(0, (await $.clock.now()) - animStart)
    const width = Math.max(20, (e.viewport?.columns ?? e.props.bodyColumns) - 2)
    const groups = sections([mainAgent(history), ...(current?.agents ?? [])], current?.external ?? [])
    const controls = (
      <Box flexDirection="row" gap={1}>
        <Button key="view" label={isList ? '캐릭터로 보기' : '목록으로 보기'}
          onPress={() => update($, isListView, value => !value)} />
        <Button key="characters" label="캐릭터 바꾸기"
          onPress={() => update($, characterOffset, value => value + 1)} />
        {offset > 0 && <Button key="reset-characters" label="기본 배정으로"
          onPress={() => update($, characterOffset, () => 0)} />}
      </Box>
    )
    const errors = (current?.errors ?? [...config.errors, ...skinErrors]).map((error, index) => (
      <Text key={`error-${index}`} dimColor>{cutCells(`! ${error}`, width - 1)}</Text>
    ))
    const footer = current === null ? <Text dimColor>불러오는 중…</Text> : (
      <Text dimColor>{`${new Date(current.polledAt).toLocaleTimeString('ko-KR')} 갱신 · ${config.refreshMs / 1000}초마다`}</Text>
    )
    const cellWidth = useImages ? HD_COLUMNS : LO_COLUMNS
    // Very narrow panes show the list rather than clipping a 32-column raster.
    if (isList || !Raster || width < cellWidth + 2) {
      shown = []
      drawnFrame.clear()
      return (
        <Box flexDirection="column">
          {controls}
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
    const room = Math.max(1, Math.floor(width / slotWidth)) * 2
    const drawn: Slot[] = []
    const tree = (
      <Box flexDirection="column">
        {controls}
        {groups.map((group, index) => {
          const slots = group.entries.map((entry): Slot => ({
            key: entry.id, label: entry.label, detail: entry.detail, state: entry.state,
            look: lookOf(entry, poseOf(entry.state), config.characters, skin, offset),
          }))
          const visible = slots.slice(0, room)
          drawn.push(...visible)
          return (
            <Box key={`group-${index}`} flexDirection="column" marginBottom={1}>
              <Text bold>{`${group.title} (${slots.length})`}</Text>
              <Box flexDirection="row" flexWrap="wrap">
                {visible.map(slot => (
                  <Box key={`slot-${slot.key}`} flexDirection="column" width={slotWidth}>
                    {useImages && Image ? (
                      <Image key={slot.key} columns={HD_COLUMNS} rows={HD_ROWS}
                        source={hdPicture(slot.look, frameAt(slot.look, elapsed, skin), skin)}
                        alt={`${slot.look.character} ${slot.look.pose}`} />
                    ) : (
                      <Raster key={slot.key} columns={LO_COLUMNS} rows={LO_ROWS}
                        cells={loCells(slot.look, frameAt(slot.look, elapsed, skin), skin)} />
                    )}
                    <Text>{cutCells(slot.label, slotWidth - 2)}</Text>
                    <Text dimColor>{cutCells(slot.detail, slotWidth - 2)}</Text>
                  </Box>
                ))}
              </Box>
              {slots.length > room && <Text dimColor>{`+${slots.length - room}명 더 · 목록에서 보기`}</Text>}
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
