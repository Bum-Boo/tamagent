import { expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import { HD } from '../hooks/characters'
import { HOST_VERSION, test } from './kit'

// 설치부터 재시작까지 사용자가 겪는 흐름. 데이터는 모두 가짜다.
const NOW = Date.parse('2026-10-20T00:00:00Z')
const OPEN = { command: 'tama', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } } as const
const PANE_PROPS = {
  title: 'Tamagent', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {},
} as const
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } as const
const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const
const SKIN = { lo: 32, characters: { hero: { idle: [{ file: 'hero/idle-0.png', ms: 150, lo: Array(1024).fill(0x123456) }] } } }
const PACK = { voices: ['Ana', 'Ben'], lines: { start: [[1, '{tool} kicks off.']] } }
const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false })
type Run = ReturnType<typeof ok>

type HostOptions = {
  term?: string
  agents?: () => AgentInfo[] | Error
  run?: (argv: readonly string[]) => Run | Error
  // 경로 → [지연 ms, 내용 또는 거절 사유]
  files?: Record<string, [number, string | Error]>
  panes?: string[]
  polls?: { count: number }
  toasts?: string[]
}
const host = (on: On, opts: HostOptions = {}) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/users/tester', TERM: opts.term ?? 'xterm-256color', TERM_PROGRAM: '', LANG: 'en_US.UTF-8' })
  on('session.version', () => ({ value: HOST_VERSION }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => { opts.toasts?.push(e.text); return { value: undefined } })
  on('ui.panes', () => ({ value: (opts.panes ?? []).map(id => ({ id, title: 'Tamagent', isShown: true, isFocused: false, isPlaced: true })) }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('agent.list', () => {
    if (opts.polls) opts.polls.count += 1
    const agents = opts.agents?.() ?? []
    return agents instanceof Error ? { deny: agents.message } : { value: agents }
  })
  on('process.run', (_$, e) => {
    const ran = opts.run?.(e.argv) ?? ok('[]')
    return ran instanceof Error ? { deny: ran.message } : { value: ran }
  })
  on('fs.read', async (_$, e) => {
    const file = opts.files?.[e.path]
    if (!file) return { deny: `ENOENT: ${e.path}` }
    if (file[0]) await clock.sleep(file[0])
    return file[1] instanceof Error ? { deny: file[1].message } : { value: file[1] }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 128, mtimeMs: NOW, isLink: false } }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('prompt.submit', () => ({ text: '' }))
  return clock
}
const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'tamagent', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'tamagent-panel' })
const mountBand = ($: Engine) =>
  $.ui.mount({ plugin: 'tamagent', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
const closeFixture = {
  name: 'close-fixture',
  register(on: On) {
    on('command.run', { command: 'fixture-close' }, async $ => {
      await $.ui.close({ id: 'tamagent-panel' })
      return { text: 'closed' }
    })
  },
}
const SKIN_PATH = (name: string) => `/users/tester/.local/share/tamagent/skins/${name}/manifest.json`
const VOICE_PATH = (name: string) => `/users/tester/.local/share/tamagent/voices/${name}.json`

test('설치 직후 기본값만으로 패널이 열리고 오류 줄 없이 5초마다 갱신한다', async ($, on) => {
  const polls = { count: 0 }
  const clock = host(on, { polls })
  await $.session.start(START)
  expect(polls.count).toBe(0)
  expect((await $.command.run(OPEN)).text).toBe('Opened the Tamagent panel.')
  const pane = await mountPane($)
  expect(await pane.find({ text: /^! / })).toBeUndefined()
  expect(await pane.find({ text: /every 5s$/ })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'me' })).toBeDefined()
  expect(polls.count).toBe(1)
  await clock.advance(5000)
  expect(polls.count).toBe(2)
})

test('서브에이전트: pending은 쉬고, running이면 일하고, 끝나면 사라진다', async ($, on) => {
  let status: AgentInfo['status'] = 'pending'
  const clock = host(on, { term: 'xterm-kitty', agents: () => [{ id: 'sub', type: 'Explore', description: 'Find usages', status }] })
  await $.command.run(OPEN)
  const pane = await mountPane($)
  await pane.press({ key: 'focus' })
  const alt = async () => (await pane.find({ type: 'Image', key: 'agent-sub' }))?.props.alt
  expect(await alt()).toBe('robot idle')
  status = 'running'
  await clock.advance(5000)
  expect(await alt()).toBe('robot work')
  expect(await pane.find({ text: '● This session · Explore · Find usages' })).toBeDefined()
  status = 'completed'
  await clock.advance(5000)
  expect(await alt()).toBeUndefined()
  expect(await pane.find({ text: 'This session (1)' })).toBeDefined()
})

test('외부 에이전트 상태가 working→failed→waiting으로 바뀌면 포즈와 중계가 따라간다', { options: { sources: '[["agents"]]' } }, async ($, on) => {
  let state = 'working'
  const clock = host(on, { term: 'xterm-kitty', run: () => ok(JSON.stringify([{ id: 'w', agent: 'codex', label: 'Codex', detail: 'parser', state }])) })
  await $.command.run(OPEN)
  const pane = await mountPane($)
  const band = await mountBand($)
  const alt = async () => (await pane.find({ type: 'Image', key: 'external-0-w' }))?.props.alt
  expect(await alt()).toBe('mushroom work')
  state = 'failed'
  await clock.advance(5000)
  expect(await alt()).toBe('mushroom alert')
  expect(await band.find({ text: 'Codex sent back for changes!' })).toBeDefined()
  state = 'waiting'
  await clock.advance(5000)
  expect(await alt()).toBe('mushroom wait')
  expect(await band.find({ text: 'Codex is waiting for review.' })).toBeDefined()
})

test('실패 설명: 서브에이전트 목록·시간 초과·4 MiB 초과·종료 코드를 각각 한 줄로 알리고, 회복하면 지운다',
  { options: { sources: '[["slow-tool"],["huge-tool"],["exit-tool"]]' } }, async ($, on) => {
    let broken = true
    const clock = host(on, {
      agents: () => broken ? new Error('agent registry offline') : [],
      run: argv => {
        if (!broken) return ok('[]')
        if (argv[0] === 'slow-tool') return new Error('timed out after 8000 ms')
        if (argv[0] === 'huge-tool') return { ...ok('['), isStdoutTruncated: true }
        return { ...ok(''), exitCode: 2, stderr: 'debug line\nconfig.yml: permission denied\n' }
      },
    })
    await $.command.run(OPEN)
    const pane = await mountPane($)
    expect(await pane.find({ text: '! Subagents: agent registry offline' })).toBeDefined()
    expect(await pane.find({ text: '! source 1 (slow-tool): timed out after 8000 ms' })).toBeDefined()
    expect(await pane.find({ text: '! source 2 (huge-tool): stdout exceeded 4 MiB' })).toBeDefined()
    expect(await pane.find({ text: '! source 3 (exit-tool): config.yml: permission denied' })).toBeDefined()
    // 메인 캐릭터는 그대로 보인다
    expect(await pane.find({ type: 'Raster', key: 'me' })).toBeDefined()
    broken = false
    await clock.advance(5000)
    expect(await pane.find({ text: /^! / })).toBeUndefined()
  })

test('숨기기·보이기: 닫으면 갱신과 애니메이션이 멈추고, 다시 열면 고른 보기를 그대로 이어 간다',
  { options: { refreshSeconds: 1 }, plugins: [closeFixture] }, async ($, on) => {
    const polls = { count: 0 }
    const clock = host(on, { polls })
    let blits = 0
    on('ui.blit', () => { blits += 1; return { value: {} } })
    await $.command.run(OPEN)
    let pane = await mountPane($)
    await pane.press({ key: 'view' })
    await $.command.run({ ...OPEN, command: 'fixture-close' })
    const before = { polls: polls.count, blits }
    await clock.advance(5000)
    expect(polls.count).toBe(before.polls)
    expect(blits).toBe(before.blits)
    await pane.unmount()
    await $.command.run(OPEN)
    pane = await mountPane($)
    expect(await pane.find({ type: 'Button', key: 'view' })).toBeDefined()
    expect(await pane.find({ text: /^idle Me \(Claude\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Raster' })).toBeUndefined()
    await clock.advance(1000)
    expect(polls.count).toBe(before.polls + 2)
  })

test('재시작 복원: 패널이 열린 채 세션이 다시 시작하면 /tama 없이 갱신을 재개한다', { options: { refreshSeconds: 1 } }, async ($, on) => {
  const polls = { count: 0 }
  const clock = host(on, { polls, panes: ['tamagent-panel'] })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.session.start(START)
  expect(polls.count).toBe(1)
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Raster', key: 'me' })).toBeDefined()
  await clock.advance(1000)
  expect(polls.count).toBe(2)
  // /clear 같은 종료 뒤 같은 세션이 다시 시작해도 타이머가 두 벌이 되지 않는다
  await $.session.end({ reason: 'clear', sessionId: 'test-session', resume: { id: 'test-session' } })
  await $.session.start(START)
  const after = polls.count
  await clock.advance(1000)
  expect(polls.count).toBe(after + 1)
})

test('재시작 복원: 패널을 닫은 세션이 다시 시작하면 아무것도 돌리지 않는다', async ($, on) => {
  const polls = { count: 0 }
  const clock = host(on, { polls, panes: [] })
  await $.session.start(START)
  await clock.advance(10_000)
  expect(polls.count).toBe(0)
})

test('스킨이 느리게 읽히다 끝내 실패하면 그동안은 불러오는 중, 그 뒤엔 기본 캐릭터와 이유를 보인다', { options: { skin: 'flaky' } }, async ($, on) => {
  const clock = host(on, { term: 'xterm-kitty', files: { [SKIN_PATH('flaky')]: [4000, new Error('EIO: network drive vanished')] } })
  const opening = $.command.run(OPEN)
  await clock.settle()
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Image' })).toBeUndefined()
  expect(await pane.find({ text: 'Loading…' })).toBeDefined()
  await clock.advance(4000)
  expect((await opening).text).toBe('Opened the Tamagent panel.')
  expect((await pane.find({ type: 'Image', key: 'me' }))?.props.source).toEqual({ png: HD['slime-idle-0'] })
  expect(await pane.find({ text: '! skin flaky: EIO: network drive vanished; using bundled characters' })).toBeDefined()
})

test('느린 스킨도 다 읽히면 스킨 그림으로 그린다', { options: { skin: 'slow', characters: 'claude=hero' } }, async ($, on) => {
  const clock = host(on, { term: 'xterm-kitty', files: { [SKIN_PATH('slow')]: [2500, JSON.stringify(SKIN)] } })
  const opening = $.command.run(OPEN)
  await clock.settle()
  await clock.advance(2500)
  await opening
  const pane = await mountPane($)
  expect((await pane.find({ type: 'Image', key: 'me' }))?.props.source)
    .toEqual({ file: '/users/tester/.local/share/tamagent/skins/slow/hero/idle-0.png', format: 'png' })
  expect(await pane.find({ text: /^! / })).toBeUndefined()
})

test('목소리 팩이 느리게 읽혀도 다 읽힌 뒤 첫 중계부터 팩 목소리를 쓴다', { options: { voices: 'slowpack' } }, async ($, on) => {
  const clock = host(on, { files: { [VOICE_PATH('slowpack')]: [3000, JSON.stringify(PACK)] } })
  const opening = $.command.run(OPEN)
  await clock.settle()
  await clock.advance(3000)
  await opening
  const band = await mountBand($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(await band.find({ text: 'Ben' })).toBeDefined()
  expect(await band.find({ text: 'Read kicks off.' })).toBeDefined()
})

test('목소리 팩을 연달아 바꾸면 늦게 끝난 옛 요청이 마지막 선택을 덮지 않는다', async ($, on) => {
  const clock = host(on, { files: {
    [VOICE_PATH('slowpack')]: [3000, JSON.stringify({ voices: ['Slow'], lines: { start: [[0, 'slow {tool}']] } })],
    [VOICE_PATH('fastpack')]: [0, JSON.stringify({ voices: ['Fast'], lines: { start: [[0, 'fast {tool}']] } })],
  } })
  await $.command.run(OPEN)
  const slow = $.command.run({ ...OPEN, args: 'voice slowpack' })
  await clock.settle()
  expect((await $.command.run({ ...OPEN, args: 'voice fastpack' })).text).toBe('Voice pack fastpack: Fast')
  await clock.advance(3000)
  await slow
  const band = await mountBand($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(await band.find({ text: 'Fast' })).toBeDefined()
  expect(await band.find({ text: 'fast Read' })).toBeDefined()
})

test('설정한 목소리 팩을 못 읽으면 기본 목소리로 중계하고 패널에 이유를 남긴다', { options: { voices: 'gone' } }, async ($, on) => {
  host(on)
  await $.command.run(OPEN)
  const pane = await mountPane($)
  const band = await mountBand($)
  expect(await pane.find({ text: /^! voices gone: ENOENT: .*gone\.json; using default voices$/ })).toBeDefined()
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(await band.find({ text: 'Caster' })).toBeDefined()
  expect(await band.find({ text: /Read opens the turn\.|First move: Read\./ })).toBeDefined()
})
