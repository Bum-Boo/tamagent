import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { AgentEntry } from '../types'
import { EXTERNAL_GROUP, mainAgent, parseExternal, poseOf, sections, subagents } from '../hooks/agents'
import { resolveLanguage } from '../hooks/i18n'
import { parseConfig } from '../hooks/config'
import { HD } from '../hooks/characters'
import { frameAt, hdPicture, loCells, lookOf, parseSkin } from '../hooks/sprites'

const NOW = Date.parse('2026-10-12T00:00:00Z')
const AGENTS: AgentInfo[] = [
  { id: 'x', type: 'Explore', description: '코드 찾기', status: 'running' },
  { id: 'pending', type: 'Plan', description: '시작 대기', status: 'pending' },
  { id: 'waiting', type: 'general-purpose', description: '응답 대기', status: 'waiting' },
  { id: 'y', type: 'general-purpose', description: '끝난 일', status: 'completed' },
]
const SOURCES = JSON.stringify([['fixture-one', '/path with spaces/script.py', '$(literal)'], ['fixture-two']])
const EXTERNAL = [
  { id: 'one', agent: 'codex', label: '코드 작성', detail: 'parser.py', state: 'working', group: '프로젝트' },
  { id: 'two', agent: 'gemini', label: '휴식', detail: '만료됨', state: 'stale' },
]
const result = (stdout: string, exitCode = 0, stderr = '') => ({
  stdout, stderr, exitCode, isStdoutTruncated: false, isStderrTruncated: false,
})
const frame = (file: string, ms = 150, color = 0x123456) => ({ file, ms, lo: Array(1024).fill(color) })
const MANIFEST = { lo: 32, characters: {
  a: { idle: [frame('a/idle-0.png'), frame('a/idle-1.png', 250)] },
  b: { work: [frame('b/work-0.png')], idle: [frame('b/idle-0.png')] },
} }

type HostOptions = {
  term?: string; program?: string; fail?: boolean; manifest?: string; missingFile?: boolean
  seen?: string[][]; readPaths?: string[]; agents?: AgentInfo[]; onPoll?: () => void
  fsError?: boolean; processDelay?: number; lang?: string
  process?: (argv: readonly string[]) => ReturnType<typeof result>
}
const host = (on: On, opts: HostOptions = {}) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/users/tester', TERM: opts.term ?? 'xterm-256color', TERM_PROGRAM: opts.program ?? '', LANG: opts.lang ?? 'ko_KR.UTF-8' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => { opts.onPoll?.(); return { value: opts.agents ?? AGENTS } })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('fs.read', (_$, e) => {
    opts.readPaths?.push(e.path)
    if (opts.fsError) return { deny: 'ENOENT: manifest not found' }
    return { value: opts.manifest ?? '{}' }
  })
  on('fs.stat', () => ({ value: { kind: opts.missingFile ? 'other' : 'file', size: 128, mtimeMs: NOW, isLink: false } }))
  on('process.run', async (_$, e) => {
    opts.seen?.push([...e.argv])
    if (opts.processDelay) await clock.sleep(opts.processDelay)
    return { value: opts.process ? opts.process(e.argv) : e.argv[0] === 'fixture-one'
    ? result(JSON.stringify(EXTERNAL))
    : opts.fail ? result('', 1, 'connection refused') : result(JSON.stringify([
      { id: 'job', agent: 'claude', label: '검토 대기', detail: '독립 검수', state: 'waiting', group: 'Review Queue' },
    ])) } })
  return clock
}

const PANE_PROPS = {
  title: 'Tamagent', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {},
} as const
const OPEN = {
  command: 'tama', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 },
} as const
// 이 파일의 테스트는 모두 보기 기준으로 쓰였다. 기본 '하는 일만'이면 모두 보기로 바꾼다
const mount = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', columns = 120) => {
  const pane = await $.ui.mount({ plugin: 'tamagent', surface, component: 'Pane', props: { ...PANE_PROPS, bodyColumns: columns }, requestId: 'tamagent-panel' })
  const focus = await pane.find({ type: 'Button', key: 'focus' })
  if (focus && (focus.props.label === '모두 보기' || focus.props.label === 'Show all')) await pane.press({ key: 'focus' })
  return pane
}
const imageSource = async (pane: Awaited<ReturnType<typeof mount>>, key: string) =>
  (await pane.find({ type: 'Image', key }))?.props.source

test('기본 설정은 메인과 실행 중인 서브에이전트만 읽고 외부 명령은 실행하지 않는다', async ($, on) => {
  const commands: string[][] = []
  host(on, { seen: commands })
  await $.command.run(OPEN)
  const pane = await mount($)
  expect(await pane.find({ type: 'Raster', key: 'me' })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'agent-x' })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'agent-pending' })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'agent-waiting' })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'agent-y' })).toBeUndefined()
  expect(commands.length).toBe(0)
  const raster = await pane.find({ type: 'Raster', key: 'me' })
  expect(raster?.props.columns).toBe(32)
  expect(raster?.props.rows).toBe(16)
})

test('외부 JSON을 group별로 나누며 argv를 셸 해석 없이 보낸다', { options: { sources: SOURCES } }, async ($, on) => {
  const seen: string[][] = []
  host(on, { seen })
  await $.command.run(OPEN)
  const pane = await mount($)
  expect(seen).toContainEqual(['fixture-one', '/path with spaces/script.py', '$(literal)'])
  expect(await pane.find({ text: '프로젝트 (1)' })).toBeDefined()
  expect(await pane.find({ text: '외부 (1)' })).toBeDefined()
  expect(await pane.find({ text: 'Review Queue (1)' })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'external-0-one' })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'external-1-job' })).toBeDefined()
})

test('명령 하나가 실패해도 정상 소스와 메인 에이전트를 그리고 오류를 표시한다', { options: { sources: SOURCES } }, async ($, on) => {
  host(on, { fail: true })
  await $.command.run(OPEN)
  const pane = await mount($)
  expect(await pane.find({ type: 'Raster', key: 'external-0-one' })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'me' })).toBeDefined()
  expect(await pane.find({ text: /source 2.*connection refused/ })).toBeDefined()
})

test('JSON이 배열이 아니거나 행이 잘못되어도 나머지 소스는 보인다', { options: { sources: SOURCES } }, async ($, on) => {
  host(on, { process: argv => result(argv[0] === 'fixture-one' ? '{}'
    : JSON.stringify([{ id: 'good', state: 'idle' }, { id: 'bad', state: 'oops' }])) })
  await $.command.run(OPEN)
  const pane = await mount($)
  expect(await pane.find({ type: 'Raster', key: 'external-1-good' })).toBeDefined()
  expect(await pane.find({ text: /stdout must be a JSON array/ })).toBeDefined()
  expect(await pane.find({ text: /row 2: invalid/ })).toBeDefined()
})

test('목록 전환과 복귀는 메인, 서브, 외부 에이전트를 같은 섹션에 표시한다', { options: { sources: SOURCES } }, async ($, on) => {
  host(on)
  await $.command.run(OPEN)
  const pane = await mount($)
  await pane.press({ key: 'view' })
  expect(await pane.find({ text: /idle 나 Claude/ })).toBeDefined()
  expect(await pane.find({ text: /working Explore · 코드 찾기/ })).toBeDefined()
  expect(await pane.find({ text: /stale 휴식 · 만료됨/ })).toBeDefined()
  expect(await pane.find({ type: 'Raster' })).toBeUndefined()
  expect(await pane.find({ text: /끝난 일/ })).toBeUndefined()
  await pane.press({ key: 'view' })
  expect(await pane.find({ type: 'Raster', key: 'me' })).toBeDefined()
})

for (const term of ['xterm-kitty', 'xterm-ghostty']) {
  test(`${term}에서는 14×7칸 Image로 내장 PNG를 그린다`, async ($, on) => {
    host(on, { term })
    await $.command.run(OPEN)
    const pane = await mount($)
    const node = await pane.find({ type: 'Image', key: 'me' })
    expect(node?.props.columns).toBe(14)
    expect(node?.props.rows).toBe(7)
    expect(node?.props.source).toEqual({ png: HD['slime-idle-0'] })
    expect(await pane.find({ type: 'Raster', key: 'me' })).toBeUndefined()
  })
}

test('TERM_PROGRAM=Ghostty도 그림 터미널로 감지한다', async ($, on) => {
  host(on, { program: 'Ghostty' })
  await $.command.run(OPEN)
  const pane = await mount($)
  expect(await pane.find({ type: 'Image', key: 'me' })).toBeDefined()
})

test('그림 요소가 없는 desktop 화면과 좁은 터미널은 목록을 표시한다', { options: { sources: SOURCES } }, async ($, on) => {
  host(on)
  await $.command.run(OPEN)
  for (const [surface, width] of [['desktop', 120], ['terminal', 24]] as const) {
    const pane = await mount($, surface, width)
    expect(await pane.find({ text: /working 코드 작성/ })).toBeDefined()
    expect(await pane.find({ type: 'Raster' })).toBeUndefined()
  }
})

test('스킨 manifest의 상대 PNG 경로를 홈에서 읽고 매핑과 idle 대체를 적용한다',
  { options: { sources: SOURCES, skin: 'test-skin', characters: 'claude=a, codex=b' } }, async ($, on) => {
    const readPaths: string[] = []
    host(on, { term: 'xterm-kitty', manifest: JSON.stringify(MANIFEST), readPaths })
    await $.command.run(OPEN)
    const pane = await mount($)
    expect(readPaths).toEqual(['/users/tester/.local/share/tamagent/skins/test-skin/manifest.json'])
    expect(await imageSource(pane, 'me')).toEqual({ file: '/users/tester/.local/share/tamagent/skins/test-skin/a/idle-0.png', format: 'png' })
    expect(await imageSource(pane, 'external-0-one')).toEqual({ file: '/users/tester/.local/share/tamagent/skins/test-skin/b/work-0.png', format: 'png' })
    expect(await imageSource(pane, 'external-0-two')).toEqual({ file: '/users/tester/.local/share/tamagent/skins/test-skin/a/idle-0.png', format: 'png' })
  })

test('스킨이 잘못되었거나 PNG 파일이 없으면 내장 캐릭터를 쓰고 오류를 표시한다',
  { options: { skin: 'missing' } }, async ($, on) => {
    host(on, { term: 'xterm-kitty', manifest: JSON.stringify(MANIFEST), missingFile: true })
    await $.command.run(OPEN)
    const pane = await mount($)
    expect(await imageSource(pane, 'me')).toEqual({ png: HD['slime-idle-0'] })
    expect(await pane.find({ text: /skin missing: no usable PNG frames/ })).toBeDefined()
  })

test('깨진 manifest JSON도 패널을 중단하지 않는다', { options: { skin: 'broken' } }, async ($, on) => {
  host(on, { term: 'xterm-kitty', manifest: '{broken' })
  await $.command.run(OPEN)
  const pane = await mount($)
  expect(await imageSource(pane, 'me')).toEqual({ png: HD['slime-idle-0'] })
  expect(await pane.find({ text: /skin broken:/ })).toBeDefined()
})

test('manifest가 없으면 내장 그림을 쓰며 파일 오류를 표시한다', { options: { skin: 'absent' } }, async ($, on) => {
  host(on, { term: 'xterm-kitty', fsError: true })
  await $.command.run(OPEN)
  const pane = await mount($)
  expect(await imageSource(pane, 'me')).toEqual({ png: HD['slime-idle-0'] })
  expect(await pane.find({ text: /manifest not found/ })).toBeDefined()
})

test('사용자 스킨도 반칸 블록 격자로 그린다', { options: { skin: 'test', characters: 'claude=a' } }, async ($, on) => {
  host(on, { manifest: JSON.stringify(MANIFEST) })
  await $.command.run(OPEN)
  const pane = await mount($)
  const raster = await pane.find({ type: 'Raster', key: 'me' })
  expect(raster?.props.cells).toBe(loCells({ character: 'a', fallback: 'slime', pose: 'idle' }, 0, parseSkin(JSON.stringify(MANIFEST), '/any')))
})

test('외부 상태 다섯 개와 queue·unknown 기본 배정을 화면에도 적용한다', { options: { sources: '[["states"]]' } }, async ($, on) => {
  const states = ['working', 'idle', 'stale', 'waiting', 'failed']
  host(on, { term: 'xterm-kitty', process: () => result(JSON.stringify(states.map((state, index) => ({
    id: String(index), state, agent: index === 4 ? 'unknown' : 'codex', group: index === 3 ? 'Queue' : 'Others',
  })))) })
  await $.command.run(OPEN)
  const pane = await mount($)
  const expected = ['mushroom work', 'mushroom idle', 'mushroom sleep', 'cloud wait', 'meteor alert']
  for (const [index, alt] of expected.entries()) {
    expect((await pane.find({ type: 'Image', key: `external-0-${index}` }))?.props.alt).toBe(alt)
  }
})

test('메인은 도구가 실행 중일 때만 working이고 실패한 호출은 잠깐 아팠다가 idle로 돌아간다', async ($, on) => {
  const clock = host(on, { term: 'xterm-kitty' })
  on('tool.call', async () => {
    await clock.sleep(1000)
    return { result: { stdout: '', stderr: 'failed', interrupted: false }, isError: true }
  })
  await $.command.run(OPEN)
  const pane = await mount($)
  const running = $.tool.call({ tool: 'Bash', command: 'example' })
  await clock.settle()
  expect(await imageSource(pane, 'me')).toEqual({ png: HD['slime-work-0'] })
  await clock.advance(1000)
  await running
  expect((await pane.find({ type: 'Image', key: 'me' }))?.props.alt).toBe('slime alert')
  expect(await pane.find({ text: '앗, 실패! Bash' })).toBeDefined()
  await clock.advance(10000)
  expect((await pane.find({ type: 'Image', key: 'me' }))?.props.alt).toBe('slime idle')
})

test('갱신 주기를 설정하고 애니메이션은 바뀐 프레임만 blit한다', { options: { refreshSeconds: 2 } }, async ($, on) => {
  let polls = 0
  const clock = host(on, { agents: [], onPoll: () => { polls += 1 } })
  let blits = 0
  on('ui.blit', () => { blits += 1; return { value: {} } })
  await $.command.run(OPEN)
  await mount($)
  expect(polls).toBe(1)
  await clock.advance(400)
  expect(blits).toBe(0)
  await clock.advance(100)
  expect(blits).toBe(1)
  await clock.advance(100)
  expect(blits).toBe(1)
  await clock.advance(1400)
  expect(polls).toBe(2)
})

test('애니메이션은 목록 보기에서 멈춘다', async ($, on) => {
  const clock = host(on)
  let blits = 0
  on('ui.blit', () => { blits += 1; return { value: {} } })
  await $.command.run(OPEN)
  const pane = await mount($)
  await pane.press({ key: 'view' })
  await clock.advance(1000)
  expect(blits).toBe(0)
})

test('패널을 닫으면 갱신을 멈추고 다시 열면 재개한다', {
  options: { refreshSeconds: 1 },
  plugins: [{
    name: 'close-fixture',
    register(on) {
      on('command.run', { command: 'fixture-close' }, async $ => {
        await $.ui.close({ id: 'tamagent-panel' })
        return { text: 'closed' }
      })
    },
  }],
}, async ($, on) => {
  let polls = 0
  const clock = host(on, { agents: [], onPoll: () => { polls += 1 } })
  on('ui.close', () => ({ value: undefined }))
  await $.command.run(OPEN)
  expect(polls).toBe(1)
  await $.command.run({ ...OPEN, command: 'fixture-close' })
  await clock.advance(3000)
  expect(polls).toBe(1)
  await $.command.run(OPEN)
  expect(polls).toBe(2)
  await clock.advance(1000)
  expect(polls).toBe(3)
})

test('느린 소스가 있어도 갱신 명령이 겹치지 않는다', { options: { sources: '[["slow"]]', refreshSeconds: 1 } }, async ($, on) => {
  const seen: string[][] = []
  const clock = host(on, { processDelay: 2500, seen, agents: [] })
  const opening = $.command.run(OPEN)
  await clock.settle()
  await clock.advance(2500)
  await opening
  expect(seen.length).toBe(1)
  await clock.advance(1000)
  expect(seen.length).toBe(2)
  await clock.advance(2000)
  expect(seen.length).toBe(2)
  await clock.advance(1000)
  expect(seen.length).toBe(3)
})

test('/clear 때 상태와 타이머를 지우고 새 /tama에서 정상 시작한다', async ($, on) => {
  let polls = 0
  const clock = host(on, { agents: [], onPoll: () => { polls += 1 } })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.command.run(OPEN)
  await $.session.end({ reason: 'clear', sessionId: 'test-session', resume: { id: 'test-session' } })
  await clock.advance(10000)
  expect(polls).toBe(1)
  await $.command.run(OPEN)
  expect(polls).toBe(2)
})

test('설정과 데이터 파싱은 잘못된 입력을 격리하고 기본값을 유지한다', () => {
  const config = parseConfig({ sources: '[[],["ok","a b"],"bad"]', skin: '../escape', refreshSeconds: 0, characters: 'claude=robot, bad' })
  expect(config.sources).toEqual([['ok', 'a b']])
  expect(config.refreshMs).toBe(5000)
  expect(config.skin).toBe('default')
  expect(config.characters.claude).toBe('robot')
  expect(config.errors.length).toBe(5)
  const parsed = parseExternal(JSON.stringify([{ id: 'id', state: 'idle' }, { id: 'id', state: 'idle' }]), 0)
  expect(parsed.entries.length).toBe(1)
  expect(parsed.errors.length).toBe(1)
  expect(sections([], parsed.entries)[1]?.title).toBe(EXTERNAL_GROUP)
})

test('상태 다섯 개와 서브에이전트 상태를 포즈로 바꾼다', () => {
  expect(['working', 'idle', 'stale', 'waiting', 'failed'].map(state => poseOf(state as AgentEntry['state'])))
    .toEqual(['work', 'idle', 'sleep', 'wait', 'alert'])
  expect(subagents(AGENTS).map(agent => agent.state)).toEqual(['working', 'idle', 'idle'])
  expect(mainAgent([]).state).toBe('idle')
  expect(mainAgent([{ id: 'x', tool: 'Read', isDone: false }]).state).toBe('working')
})

test('스킨의 포즈→idle→내장 대체와 프레임별 시간이 일치한다', () => {
  const skin = parseSkin(JSON.stringify(MANIFEST), '/skin')
  const look = { character: 'a', fallback: 'slime', pose: 'sleep' as const }
  expect(frameAt(look, 149, skin)).toBe(0)
  expect(frameAt(look, 150, skin)).toBe(1)
  expect(frameAt(look, 399, skin)).toBe(1)
  expect(frameAt(look, 400, skin)).toBe(0)
  expect(hdPicture(look, 0, skin)).toEqual({ file: '/skin/a/idle-0.png', format: 'png' })
  expect(hdPicture({ ...look, character: 'absent' }, 0, skin)).toEqual({ png: HD['slime-sleep-0'] })
  expect(loCells(look, 0, skin).length).toBe(8192)
  for (const [role, character] of [['main', 'slime'], ['subagent', 'robot'], ['external', 'mushroom'], ['queue', 'cloud'], ['unknown', 'meteor']] as const) {
    const entry = { ...mainAgent([]), role }
    expect(lookOf(entry, 'idle', {}, undefined).character).toBe(character)
  }
})

test('영어 로케일이면 화면 문구가 영어다', { options: { sources: SOURCES } }, async ($, on) => {
  host(on, { lang: 'en_US.UTF-8' })
  const ran = await $.command.run(OPEN)
  expect(ran.text).toBe('Opened the Tamagent panel.')
  const pane = await mount($)
  expect(await pane.find({ text: 'This session (4)' })).toBeDefined()
  expect(await pane.find({ text: 'External (1)' })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 'view' })).toBeDefined()
  expect(JSON.stringify(await pane.find({ type: 'Button', key: 'view' }))).toContain('List')
  await pane.press({ key: 'view' })
  expect(await pane.find({ text: /idle Me \(Claude\)/ })).toBeDefined()
})

test('language 설정이 로케일보다 우선한다', { options: { language: 'en' } }, async ($, on) => {
  host(on, { lang: 'ko_KR.UTF-8' })
  expect((await $.command.run(OPEN)).text).toBe('Opened the Tamagent panel.')
})

test('로케일 판정: ko*는 한국어, 그 밖과 C/POSIX는 영어', () => {
  expect(resolveLanguage('auto', [undefined, undefined, 'ko_KR.UTF-8'])).toBe('ko')
  expect(resolveLanguage('auto', ['C', undefined, 'ko-KR'])).toBe('ko')
  expect(resolveLanguage('auto', ['en_US.UTF-8', undefined, 'ko_KR.UTF-8'])).toBe('en')
  expect(resolveLanguage('auto', [undefined, undefined, undefined])).toBe('en')
  expect(resolveLanguage('ko', ['en_US.UTF-8'])).toBe('ko')
})
