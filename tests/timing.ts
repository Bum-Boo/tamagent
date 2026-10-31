import { test as kitTest } from 'claude-code/testing'
import type { TestRest } from 'claude-code/testing'

// 테스트 한 개의 실제 시간 한도. 가짜 시계를 돌려도 애니메이션 타이머(100ms)가 깨어날 때마다
// 실제 CPU 시간이 든다. 엔진 기본 한도 5초는 한가한 기계에서 무거운 테스트(0.4~0.9초)의 6~10배라
// 느린 노트북·붐비는 CI에서는 단정이 아니라 시간 초과로 떨어진다. 진짜로 멈춘 테스트는 여전히 실패한다.
export const TEST_TIMEOUT_MS = 30_000

export function test(name: string, ...rest: TestRest) {
  const [options, body] = rest.length === 1 ? [{}, rest[0]] : rest
  kitTest(name, { timeoutMs: TEST_TIMEOUT_MS, ...options }, body)
}
