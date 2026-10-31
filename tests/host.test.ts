import { expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionVersion } from 'claude-code'
import { MIN_HOST, TESTED_HOST, checkHost } from '../hooks/host'
import { test } from './kit'

const NOW = Date.parse('2026-10-20T00:00:00Z')
const OPEN = { command: 'tama', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } } as const
const PANE_PROPS = {
  title: 'Tamagent', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {},
} as const
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } as const
const release = (version: string): SessionVersion => ({ version, base: version })

type Seen = { opened: number; polls: number; toasts: string[] }
// version이 undefined면 session.version에 답하지 않는다(엔진이 거절한다)
const host = (on: On, version: SessionVersion | undefined, panes: string[] = []) => {
  const seen: Seen = { opened: 0, polls: 0, toasts: [] }
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/users/tester', TERM: 'xterm-256color', TERM_PROGRAM: '', LANG: 'en_US.UTF-8' })
  if (version) on('session.version', () => ({ value: version }))
  on('ui.open', () => { seen.opened += 1; return { value: { isPlaced: true } } })
  on('ui.toast', (_$, e) => { seen.toasts.push(e.text); return { value: undefined } })
  on('ui.panes', () => ({ value: panes.map(id => ({ id, title: 'Tamagent', isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.list', () => { seen.polls += 1; return { value: [] } })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  return { seen, clock }
}
const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'tamagent', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'tamagent-panel' })

test('지원 범위: 최소 버전 미만은 거절, 테스트한 최신보다 새 버전은 경고, 개발 빌드는 base로 판단', () => {
  expect(checkHost(release('2.1.294')).status).toBe('unsupported')
  expect(checkHost(release('2.0.999')).status).toBe('unsupported')
  expect(checkHost(release(MIN_HOST))).toEqual({ status: 'supported', version: MIN_HOST })
  expect(checkHost(release(TESTED_HOST)).status).toBe('supported')
  const newer = checkHost(release('2.1.400'))
  expect(newer.status).toBe('untested')
  expect(newer.warning).toBe(`host: Claude Code 2.1.400 is newer than the tested ${MIN_HOST}–${TESTED_HOST}; report problems`)
  expect(checkHost(release('3.0.0')).status).toBe('untested')
  expect(checkHost({ version: '2.1.300-dev.20261001.t101500.sha1a2b3c4', base: '2.1.300-dev' }).status).toBe('supported')
  expect(checkHost({ version: '2.1.290-dev.20260901.t000000.shaabcdef0', base: '2.1.290-dev' }).status).toBe('unsupported')
  // base가 없으면 version에서 읽는다
  expect(checkHost({ version: '2.1.302' }).status).toBe('supported')
  expect(checkHost({ version: 'nightly' }).status).toBe('unknown')
  expect(checkHost(undefined, 'no such event').warning).toMatch(/version unreadable \(no such event\)/)
})

test('지원하지 않는 호스트: /tama가 이유를 말하고 패널·갱신·반응·중계를 쉰다', async ($, on) => {
  const { seen, clock } = host(on, release('2.1.294'))
  let ran = 0
  on('tool.call', () => { ran += 1; return { result: { stdout: '', stderr: '', interrupted: false }, isError: true } })
  const reply = await $.command.run(OPEN)
  expect(reply.text).toBe(`Tamagent needs Claude Code ${MIN_HOST} or newer; this is 2.1.294. Run claude update and restart.`)
  expect(seen.opened).toBe(0)
  expect(seen.polls).toBe(0)
  // 도구 호출은 그대로 지나가고 펫은 반응하지 않는다
  await $.tool.call({ tool: 'Bash', command: 'rm -rf dist' })
  expect(ran).toBe(1)
  expect(seen.toasts.some(toast => toast.includes('panicked'))).toBe(false)
  const band = await $.ui.mount({ plugin: 'tamagent', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ text: 'Caster' })).toBeUndefined()
  await clock.advance(10_000)
  expect(seen.polls).toBe(0)
  expect((await $.command.run({ ...OPEN, args: 'cast' })).text).toMatch(/needs Claude Code/)
})

test('지원하지 않는 호스트에서 지난 세션의 패널이 남아 있으면 로딩 대신 이유를 보인다', async ($, on) => {
  const { seen } = host(on, release('2.1.290'), ['tamagent-panel'])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pane = await mountPane($)
  expect(await pane.find({ text: /needs Claude Code 2\.1\.295 or newer; this is 2\.1\.290/ })).toBeDefined()
  expect(await pane.find({ text: 'Loading…' })).toBeUndefined()
  expect(seen.polls).toBe(0)
  expect(seen.toasts).toEqual([`Tamagent needs Claude Code ${MIN_HOST} or newer; this is 2.1.290. Run claude update and restart.`])
})

test('테스트한 범위보다 새 호스트: 패널은 열고 경고 한 줄을 보인다', async ($, on) => {
  const { seen } = host(on, release('2.1.400'))
  expect((await $.command.run(OPEN)).text).toBe('Opened the Tamagent panel.')
  const pane = await mountPane($)
  expect(seen.polls).toBe(1)
  expect(await pane.find({ text: /! host: Claude Code 2\.1\.400 is newer than the tested/ })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'me' })).toBeDefined()
})

test('버전을 읽지 못하면 패널은 열고 그 사실과 지원 범위를 보인다', async ($, on) => {
  host(on, undefined)
  expect((await $.command.run(OPEN)).text).toBe('Opened the Tamagent panel.')
  const pane = await mountPane($)
  expect(await pane.find({ text: new RegExp(`! host: Claude Code version unreadable .*supports ${MIN_HOST}–${TESTED_HOST}`) })).toBeDefined()
})
