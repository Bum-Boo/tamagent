// 호스트 Claude Code 버전 확인. mod API는 얼리 액세스라 릴리스마다 바뀔 수 있다.
// MIN_HOST보다 낮으면 패널을 열지 않고 이유를 말한다. TESTED_HOST보다 높으면 동작은 하되 한 줄 알린다.
import type { SessionVersion } from 'claude-code'

export const MIN_HOST = '2.1.295'
export const TESTED_HOST = '2.1.316'

export type HostStatus = 'supported' | 'untested' | 'unsupported' | 'unknown'
export type HostCheck = { status: HostStatus; version: string; warning?: string }

const release = (text: string | undefined) => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(text ?? '')
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

export const compareRelease = (a: number[], b: number[]) =>
  a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!

// 개발 빌드(2.1.300-dev…)는 base의 릴리스로 본다
export function checkHost(info: SessionVersion | undefined, error?: string): HostCheck {
  const version = info?.version || 'unknown'
  const found = release(info?.base) ?? release(info?.version)
  if (!found) {
    return { status: 'unknown', version, warning: `host: Claude Code version unreadable (${error ?? version}); Tamagent supports ${MIN_HOST}–${TESTED_HOST}` }
  }
  if (compareRelease(found, release(MIN_HOST)!) < 0) return { status: 'unsupported', version }
  if (compareRelease(found, release(TESTED_HOST)!) > 0) {
    return { status: 'untested', version, warning: `host: Claude Code ${version} is newer than the tested ${MIN_HOST}–${TESTED_HOST}; report problems` }
  }
  return { status: 'supported', version }
}
