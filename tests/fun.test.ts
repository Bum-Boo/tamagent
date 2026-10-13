import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { Roster } from '../hooks/agents'
import { Arena, Boss } from '../hooks/bosses'
import { Sportscaster, parseVoicePack } from '../hooks/caster'
import { Pet } from '../hooks/reactions'
import { lookOf } from '../hooks/sprites'

const NOW = Date.parse('2026-10-14T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const result = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false })
const PACK = { voices: ['하치와레', '우사기', '치이카와'], lines: {
  start: [[0, '{tool}로 시작이네! 어떻게든 되겠지~!'], [2, '{tool}… 가, 간다…!']],
  error: [[1, '하?! {tool} 실패?! 이야아아!'], [9, 'ignored'], ['x', 'ignored']],
  bogus: [[0, 'ignored']],
} }
const BOSS = { id: 'xr', label: 'XR 수업', detail: '5분 영상', due: NOW + 2 * DAY, since: NOW - 12 * DAY, hits: 3 }

type HostOptions = { rows?: () => unknown[]; lang?: string; toasts?: string[]; term?: string }
const host = (on: On, opts: HostOptions = {}) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/users/tester', TERM: opts.term ?? 'xterm-256color', TERM_PROGRAM: '', LANG: opts.lang ?? 'ko_KR.UTF-8' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_$, e) => { opts.toasts?.push(e.text); return { value: undefined } })
  on('agent.list', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('process.run', () => ({ value: result(JSON.stringify(opts.rows ? opts.rows() : [])) }))
  on('fs.read', (_$, e) => e.path === '/users/tester/.local/share/tamagent/voices/test.json'
    ? { value: JSON.stringify(PACK) } : { deny: 'ENOENT: no such file' })
  on('prompt.submit', () => ({ text: '' }))
  // 띠에 보여 줄 게 없으면 엔진 자리를 돌려준다
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

const PANE_PROPS = {
  title: 'Tamagent', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {},
} as const
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } as const
const OPEN = { command: 'tama', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } } as const
const SOURCE = { options: { sources: '[["boss-source"]]' } }
const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'tamagent', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'tamagent-panel' })
const mountBand = ($: Engine) =>
  $.ui.mount({ plugin: 'tamagent', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
const alt = async (pane: Awaited<ReturnType<typeof mountPane>>, key: string) =>
  (await pane.find({ type: 'Image', key }))?.props.alt

test('위험한 Bash 명령에 펫이 놀라고 토스트와 중계가 나온다. 호출은 막지 않는다', async ($, on) => {
  const toasts: string[] = []
  host(on, { toasts })
  let ran = 0
  on('tool.call', () => { ran += 1; return { result: { stdout: '', stderr: '', interrupted: false } } })
  await $.command.run(OPEN)
  const pane = await mountPane($)
  const band = await mountBand($)
  await $.tool.call({ tool: 'Bash', command: 'cd /tmp/build && rm -rf dist' })
  expect(ran).toBe(1)
  expect(await pane.find({ text: '위험 명령! Bash' })).toBeDefined()
  expect(toasts).toEqual(['Tamagent: 위험해 보이는 명령에 펫이 놀랐어요'])
  expect(await band.find({ text: '해설' })).toBeDefined()
  expect(await band.find({ text: /위험한 명령 등장|위험 신호/ })).toBeDefined()
})

test('다른 플러그인이 호출을 막으면 차단됨으로 반응한다', async ($, on) => {
  host(on)
  on('tool.call', () => ({ deny: 'policy' }))
  await $.command.run(OPEN)
  const pane = await mountPane($)
  const band = await mountBand($)
  await $.tool.call({ tool: 'Bash', command: 'echo hi' })
  expect(await pane.find({ text: '차단됨 Bash' })).toBeDefined()
  expect(await band.find({ text: /심판이 Bash|Bash, 반칙/ })).toBeDefined()
})

test('마감 보스: 남은 시간이 체력이고 hits가 늘면 HIT가 번쩍인다', SOURCE, async ($, on) => {
  let hits = 3
  const clock = host(on, { rows: () => [{ ...BOSS, hits }] })
  await $.command.run(OPEN)
  const pane = await mountPane($)
  const band = await mountBand($)
  expect(await pane.find({ text: '보스전 (1)' })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'boss-0-xr' })).toBeDefined()
  expect(await pane.find({ text: /14% · 2일 0시간 · 3히트/ })).toBeDefined()
  expect(await pane.find({ text: /HIT!/ })).toBeUndefined()
  hits = 4
  await clock.advance(5000)
  expect(await pane.find({ text: 'XR 수업 HIT!' })).toBeDefined()
  expect(await pane.find({ text: /4히트/ })).toBeDefined()
  expect(await band.find({ text: /XR 수업 보스에게 히트|XR 수업에 한 방 더/ })).toBeDefined()
  await clock.advance(5000)
  expect(await pane.find({ text: /HIT!/ })).toBeUndefined()
})

test('보스가 24시간 안이면 분노 토스트, 지나면 마감 지남', SOURCE, async ($, on) => {
  const toasts: string[] = []
  host(on, { toasts, rows: () => [
    { ...BOSS, id: 'soon', label: '공모전', due: NOW + 10 * 3_600_000 },
    { ...BOSS, id: 'late', label: '지난 과제', due: NOW - 3_600_000 },
  ] })
  await $.command.run(OPEN)
  const pane = await mountPane($)
  expect(toasts).toEqual(['Tamagent: 공모전 마감 24시간 전, 보스 분노 모드'])
  expect(await pane.find({ text: /0% · 마감 지남/ })).toBeDefined()
  await pane.press({ key: 'view' })
  expect(await pane.find({ text: /failed 공모전/ })).toBeDefined()
  expect(await pane.find({ text: /failed 지난 과제/ })).toBeDefined()
})

test('잘못된 보스 행은 오류로 남고 나머지는 보인다', SOURCE, async ($, on) => {
  host(on, { rows: () => [{ id: 'nolabel', due: '2026-12-01' }, { id: 'ok', label: '논문', due: '2026-12-01' }] })
  await $.command.run(OPEN)
  const pane = await mountPane($)
  expect(await pane.find({ text: /row 1: boss needs a label/ })).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'boss-0-ok' })).toBeDefined()
})

test('/tama cast 로 중계를 끄면 띠가 사라지고 다시 켜면 돌아온다', { options: { casters: '하치와레, 우사기' } }, async ($, on) => {
  host(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.command.run(OPEN)
  const band = await mountBand($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(await band.find({ text: '하치와레' })).toBeDefined()
  expect(await band.find({ text: /Read로 턴을 엽니다|첫 수는 Read/ })).toBeDefined()
  expect((await $.command.run({ ...OPEN, args: 'cast' })).text).toBe('중계를 껐어요. /tama cast 로 다시 켜요.')
  expect(await band.find({ text: '하치와레' })).toBeUndefined()
  expect((await $.command.run({ ...OPEN, args: 'cast' })).text).toBe('중계를 켰어요.')
  expect(await band.find({ text: '하치와레' })).toBeDefined()
  await band.press({ key: 'mute' })
  expect(await band.find({ text: '하치와레' })).toBeUndefined()
})

test('조용하면 잠들고 프롬프트가 오면 깨며 턴이 끝나면 중계한다', { options: { sleepMinutes: 1 } }, async ($, on) => {
  const clock = host(on, { term: 'xterm-kitty' })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.command.run(OPEN)
  const pane = await mountPane($)
  const band = await mountBand($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await clock.advance(65_000)
  expect(await alt(pane, 'me')).toBe('slime sleep')
  expect(await pane.find({ text: /zZ/ })).toBeDefined()
  expect(await band.find({ text: /잠들었습니다|꿈나라/ })).toBeDefined()
  await $.prompt.submit({ text: '계속' })
  expect(await band.find({ text: '펫 기상! 경기 재개!' })).toBeDefined()
  await clock.advance(5000)
  expect(await alt(pane, 'me')).toBe('slime idle')
  await $.turn.complete({ answer: 'ok', durationMs: 12_400, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await pane.find({ text: /완료!/ })).toBeDefined()
  expect(await band.find({ text: /12초, 도구 0회|12초 동안 도구 0회/ })).toBeDefined()
})

test('영어 로케일이면 중계와 반응 문구도 영어다', SOURCE, async ($, on) => {
  host(on, { lang: 'en_US.UTF-8', rows: () => [BOSS] })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false }, isError: true }))
  await $.command.run(OPEN)
  const pane = await mountPane($)
  const band = await mountBand($)
  await $.tool.call({ tool: 'Grep', pattern: 'x' })
  expect(await pane.find({ text: 'Ouch, failed! Grep' })).toBeDefined()
  expect(await pane.find({ text: 'Boss fight (1)' })).toBeDefined()
  expect(await pane.find({ text: /2d 0h · 3 hits/ })).toBeDefined()
  expect(await band.find({ text: 'Color' })).toBeDefined()
  expect(await band.find({ text: /Grep failed/ })).toBeDefined()
})

test('설정: 잘못된 danger 정규식과 sportscaster 값은 오류로 남고 기본값을 쓴다', { options: { danger: '([', sportscaster: 'loud', sleepMinutes: 0 } }, async ($, on) => {
  host(on)
  await $.command.run(OPEN)
  const pane = await mountPane($)
  expect(await pane.find({ text: /! danger: / })).toBeDefined()
  // sportscaster 값은 plugin.json의 options 선언으로 엔진이 먼저 걸러서 기본값 on이 된다
  expect(await pane.find({ text: /! sleepMinutes: use 1–1440/ })).toBeDefined()
})

test('Pet: 위험 패턴과 추가 정규식, 반응 만료, 수면', () => {
  const pet = new Pet(60_000, Pet.parseDanger('drop-everything').pattern)
  for (const command of ['rm -rf build', 'sudo rm -fr /', 'rm -r -f dist', 'rm --recursive --force dist', 'rm -f -R x', 'echo a\nrm -rf b',
    'git push origin main --force', 'git reset --hard HEAD~1', 'psql -c "DROP TABLE users"', 'dd if=/dev/zero of=/dev/sda', 'npm run drop-everything']) {
    expect(pet.isDanger(command)).toBe(true)
  }
  for (const command of ['rm file.txt', 'rm -r dir', 'rm -f file', 'grep -rf patterns .', 'git push', 'git reset --soft HEAD~1', 'rm --force a']) {
    expect(pet.isDanger(command)).toBe(false)
  }
  expect(Pet.parseDanger('([').error).toMatch(/^danger: /)
  const text = { error: 'E', danger: 'D', denied: 'X', done: 'OK', asleep: 'zZ' }
  pet.react('error', 'Bash', 1000)
  expect(pet.mood(2000, text)).toEqual({ state: 'failed', detail: 'E Bash' })
  expect(pet.mood(7001, text)).toBeUndefined()
  expect(pet.touch(10_000)).toBe(false)
  expect(pet.settle(50_000)).toBe(false)
  expect(pet.settle(70_000)).toBe(true)
  expect(pet.settle(80_000)).toBe(false)
  expect(pet.isAsleep).toBe(true)
  expect(pet.mood(80_000, text)).toEqual({ state: 'stale', detail: 'zZ' })
  expect(pet.touch(90_000)).toBe(true)
  expect(pet.isAsleep).toBe(false)
})

test('Arena: 첫 갱신은 기준만 잡고, 히트·분노·마감 지남은 한 번씩만 알린다', () => {
  const arena = new Arena()
  const boss = (hits: number, due = NOW + 2 * DAY) => Boss.parse({ id: 'a', label: 'A', due, hits }, 0)!
  expect(arena.update([boss(3)], NOW)).toEqual([])
  expect(arena.update([boss(3)], NOW + 1000)).toEqual([])
  expect(arena.update([boss(5)], NOW + 2000)).toEqual([{ kind: 'hit', label: 'A', hits: 5 }])
  expect(arena.isFlashing('boss-0-a', NOW + 4000)).toBe(true)
  expect(arena.isFlashing('boss-0-a', NOW + 5001)).toBe(false)
  expect(arena.update([boss(5, NOW + 3000 + 3_600_000)], NOW + 3000)).toEqual([{ kind: 'rage', label: 'A' }])
  expect(arena.update([boss(5, NOW + 3000 + 3_600_000)], NOW + 4000)).toEqual([])
  expect(arena.update([boss(5, NOW)], NOW + 5000)).toEqual([{ kind: 'past', label: 'A' }])
  expect(arena.update([boss(5, NOW)], NOW + 6000)).toEqual([])
  expect(arena.update([], NOW + 7000)).toEqual([])
  // 떠났던 보스가 마감 지난 채 다시 오면 한 번 더 알린다
  expect(arena.update([boss(9, NOW)], NOW + 8000)).toEqual([{ kind: 'past', label: 'A' }])
})

test('Boss: 날짜만 적으면 그날 끝이 마감이고 since가 없으면 14일 창', () => {
  const boss = Boss.parse({ id: 'p', label: '논문', due: '2026-12-01' }, 2)!
  expect(boss.id).toBe('boss-2-p')
  expect(boss.due).toBe(Date.parse('2026-12-01T23:59:59'))
  expect(boss.since).toBe(boss.due - 14 * DAY)
  expect(Math.abs(boss.view(boss.due - 7 * DAY).hp - 0.5) < 1e-9).toBe(true)
  expect(Boss.hpBar(0.5)).toBe('█████░░░░░')
  expect(Boss.hpBar(0.01)).toBe('█░░░░░░░░░')
  expect(Boss.hpBar(0)).toBe('░░░░░░░░░░')
  expect(Boss.remainingText('ko', 90 * 60_000)).toBe('1시간 30분')
  expect(Boss.remainingText('en', 30 * 60_000)).toBe('30m')
  expect(Boss.parse({ id: 'x', label: 'X', due: 'someday' }, 0)).toBeUndefined()
  expect(Boss.parse({ id: 'x', label: 'X', due: '2026-12-01', hits: -1 }, 0)).toBeUndefined()
  expect(JSON.parse(JSON.stringify(boss))).toEqual({ id: 'boss-2-p', label: '논문', detail: '', group: '\u0000boss', due: boss.due, since: boss.since, hits: 0 })
})

test('Sportscaster: 2.5초 간격, 급한 일은 즉시, 같은 말은 한 번, 5연타부터 중계', () => {
  const caster = new Sportscaster('ko', [])
  expect(caster.voices).toEqual(['캐스터', '해설'])
  expect(caster.toolCalled('Read', 0)?.text).toBe('Read로 턴을 엽니다.')
  expect(caster.say({ kind: 'waiting', label: 'A' }, 1000)).toBeUndefined()
  expect(caster.say({ kind: 'error', tool: 'Bash' }, 1000)?.voice).toBe(1)
  const first = caster.recent.at(-1)!.text
  expect(caster.say({ kind: 'error', tool: 'Bash' }, 1000)?.text).not.toBe(first)
  for (let i = 2; i <= 4; i += 1) expect(caster.toolCalled('Read', 10_000 + i)).toBeUndefined()
  expect(caster.toolCalled('Read', 20_000)?.text).toMatch(/Read( 5연타|만 벌써 5번째)/)
  expect(caster.toolsThisTurn).toBe(5)
  caster.newTurn()
  expect(caster.toolsThisTurn).toBe(0)
  expect(caster.toolCalled('Edit', 30_000)?.text).toMatch(/Edit/)
  expect(caster.recent.length).toBeLessThanOrEqual(30)
  caster.setLanguage('en')
  expect(caster.voices).toEqual(['Caster', 'Color'])
  expect(caster.say({ kind: 'sleep' }, 40_000)?.text).toMatch(/pet (fell asleep|is dreaming)/)
})

test('목소리 팩: 설정으로 읽고 /tama voice 로 바꾸며, 빠진 종류는 내장 문구로 채운다', { options: { voices: 'test', casters: ', 우사기 선배' } }, async ($, on) => {
  const clock = host(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false }, isError: true }))
  await $.command.run(OPEN)
  const pane = await mountPane($)
  const band = await mountBand($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(await band.find({ text: '하치와레' })).toBeDefined()
  expect(await band.find({ text: 'Read로 시작이네! 어떻게든 되겠지~!' })).toBeDefined()
  expect(await band.find({ text: '우사기 선배' })).toBeDefined()
  expect(await band.find({ text: '하?! Read 실패?! 이야아아!' })).toBeDefined()
  expect(await pane.find({ text: /! voices/ })).toBeUndefined()
  expect((await $.command.run({ ...OPEN, args: 'voice missing' })).text).toMatch(/^voices missing: .*ENOENT.*using default voices$/)
  expect((await $.command.run({ ...OPEN, args: 'voice default' })).text).toBe('기본 목소리로 돌아왔어요.')
  expect((await $.command.run({ ...OPEN, args: 'voice ../etc' })).text).toBe('/tama voice <팩 이름> 또는 /tama voice default')
  expect((await $.command.run({ ...OPEN, args: 'voice test' })).text).toBe('목소리 팩 test: 하치와레, 우사기 선배, 치이카와')
  await clock.advance(3000) // 중계 간격 2.5초를 넘긴다
  await $.prompt.submit({ text: '다음 턴' })
  await $.tool.call({ tool: 'Grep', pattern: 'x' })
  expect(await band.find({ text: /Grep로 시작이네! 어떻게든 되겠지~!|Grep… 가, 간다…!/ })).toBeDefined()
})

test('parseVoicePack: 잘못된 줄은 버리고 쓸 줄이 하나도 없으면 거부한다', () => {
  const pack = parseVoicePack(JSON.stringify(PACK))
  expect(pack.voices).toEqual(['하치와레', '우사기', '치이카와'])
  expect(pack.lines.error).toEqual([[1, '하?! {tool} 실패?! 이야아아!']])
  expect(pack.lines.start?.length).toBe(2)
  expect('bogus' in pack.lines).toBe(false)
  expect(() => parseVoicePack('[]')).toThrow()
  expect(() => parseVoicePack('{"voices":[]}')).toThrow()
  expect(() => parseVoicePack('{"voices":["a",3,"b"],"lines":{"start":[[0,"x"]]}}')).toThrow()
  expect(() => parseVoicePack('{"voices":["1","2","3","4","5","6","7"],"lines":{"start":[[0,"x"]]}}')).toThrow()
  expect(() => parseVoicePack('{"voices":["a"],"lines":{"start":[[0,""]]}}')).toThrow()
  const caster = new Sportscaster('ko', [], pack)
  expect(caster.voices).toEqual(['하치와레', '우사기', '치이카와'])
  expect(caster.say({ kind: 'wake' }, 0)?.text).toBe('펫 기상! 경기 재개!')
})

test('Arena·Roster: 못 읽은 소스의 행은 기준선을 지키고, 돌아와도 다시 외치지 않는다', () => {
  const arena = new Arena()
  const boss = (hits: number, due = NOW + 3_600_000) => Boss.parse({ id: 'a', label: 'A', due, hits }, 0)!
  expect(arena.update([boss(3)], NOW)).toEqual([{ kind: 'rage', label: 'A' }])
  // 소스 0이 실패한 갱신: 빈 목록이지만 frozen
  expect(arena.update([], NOW + 1000, id => id.startsWith('boss-0-'))).toEqual([])
  expect(arena.update([boss(3)], NOW + 2000)).toEqual([])
  // 정말 사라졌다가 돌아오면 다시 알린다
  expect(arena.update([], NOW + 3000)).toEqual([])
  expect(arena.update([boss(3)], NOW + 4000)).toEqual([{ kind: 'rage', label: 'A' }])
  const roster = new Roster()
  const entry = { id: 'external-1-x', agent: 'codex', label: 'Codex', detail: 'parser', state: 'working' as const, group: 'g', role: 'external' as const }
  expect(roster.update([entry])).toEqual([])
  expect(roster.update([], id => id.startsWith('external-1-'))).toEqual([])
  expect(roster.update([entry])).toEqual([])
  expect(roster.update([])).toEqual([])
  expect(roster.update([entry])).toEqual([{ kind: 'enter', agent: 'Codex', detail: 'parser' }])
})

test('lookOf: hermes:fern 같은 이름은 정확한 이름 → 접두사 → 역할 순으로 캐릭터를 찾는다', () => {
  const entry = (agent: string) => ({ id: 'x', agent, label: agent, detail: '', state: 'idle' as const, group: 'g', role: 'external' as const })
  const mapping = { 'hermes:fern': 'fern', hermes: 'usagi', external: 'kurimanju' }
  expect(lookOf(entry('hermes:fern'), 'idle', mapping, undefined).character).toBe('fern')
  expect(lookOf(entry('Hermes:Stark'), 'idle', mapping, undefined).character).toBe('usagi')
  expect(lookOf(entry('codex'), 'idle', mapping, undefined).character).toBe('kurimanju')
  expect(lookOf(entry('codex'), 'idle', {}, undefined).character).toBe('mushroom')
})
