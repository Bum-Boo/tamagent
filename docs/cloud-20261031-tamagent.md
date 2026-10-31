# Tamagent 신뢰성 점검 (클라우드 세션, 2026-10-31)

브랜치 `claude/tamagent-reliability-audit-p1jcbs`, 기준 `main` 061a49b. Linux 클라우드 VM에서 Claude Code 2.1.290–2.1.316 빌드 23개(npm `@anthropic-ai/claude-code`, 작업 폴더 밖 임시 설치)와 기본 설치본 2.1.314로 검사했다. 그림 자산과 캐릭터 디자인(`tools/make_sprites.py`, `hooks/characters.ts`, `docs/*.png`)은 건드리지 않았다. 의존성·버전·라이선스도 그대로다.

## 요약

| # | 발견 | 분류 | 조치 |
| --- | --- | --- | --- |
| 1 | "47개 중 3개 실패": 평소 조건에서는 23개 빌드 모두 47/47 통과. CPU가 모자라면 테스트가 **단정이 아니라 키트 기본 시간 한도 5초**로 떨어진다 | 검증된 결함(테스트 쪽) | 테스트 한도 30초, 재현 조건에서 0/12 → 12/12 |
| 2 | README의 `tsc -p . --noEmit`가 clean clone에서 실패(TS5083), 타입을 깔아도 테스트 파일 4곳이 타입 오류 | 검증된 결함 | 테스트 수정 + README 절차 보강 |
| 3 | 지원 호스트 범위가 정의되지 않음, 낮은 버전에서 이유를 말하지 않음 | 검증된 결함(요구사항) | 2.1.295–2.1.316 정의, 낮으면 `/tama`가 이유를 말함 |
| 4 | 패널 오류 줄에 엔진 접두사(`tamagent: $.fs.read:`)가 붙어 원인과 대체 동작이 잘림 | 검증된 결함 | 접두사 제거 |
| 5 | 실제 TTY `/tama` 패널 | 이번에 검증 | 2.1.294/2.1.295/2.1.302/2.1.314/2.1.316 |
| 6 | `/tama cast`로 끈 중계가 세션 재시작(resume·`/clear`·설정 변경 뒤 재로드) 때 다시 켜짐 | 정적 위험(동작은 확인, 의도 판단 필요) | 바꾸지 않음 |
| 7 | 패널 여는 중 예외가 나면 `isOpen`만 참으로 남을 수 있는 구조 | 정적 위험(재현 안 됨) | 바꾸지 않음 |
| 8 | 외부 소스 실패, 스킨 실패 시 기본 그림, 패널 닫으면 갱신 정지, `/clear` 정리 | 이미 커버됨 | 흐름 테스트로 보강 |
| 9 | 설치 명령 `/plugin install tamagent --marketplace Bum-Boo/tamagent` | 문제 없음 | CLI로 설치 확인 |

## 1. 실패하던 3개 검사의 원인

**재현 시도.** 기본 2.1.314, 문서 기준 2.1.295, 감사 때 쓴 2.1.302를 포함해 2.1.290–2.1.316의 23개 빌드에서 `claude plugin validate .`와 `claude plugin test .`를 돌렸다. 모두 `√ Validation passed`, 47 pass / 0 fail. 로케일(`LANG`, `LC_ALL=C`), `TERM`(kitty·ghostty), `TZ`(Asia/Seoul, America/Los_Angeles), 다른 cwd, 공백이 든 경로, 빌드별 8회 동시 실행(24회)에서도 실패가 없었다.

**재현한 조건.** `claude plugin test .` 12개를 CPU 한 코어(`taskset -c 0`)에 동시에 돌리면 12회 모두 실패했다(회당 9–17개). 실패 메시지는 전부 `[5xxx ms]` 시간 초과였고 단정 실패는 0건이었다. 키트 문서(`claude-code/testing`의 `test`)상 테스트 한 개의 한도는 `timeoutMs`가 없으면 5000ms다.

**왜 이 테스트들인가.** 가짜 시계를 돌려도 100ms 애니메이션 타이머(`hooks/register.tsx`의 `$.clock.every(100, …)`)가 깨어날 때마다 실제 CPU 시간이 든다. 한 코어 기준 평균 시간: 잠들기 테스트 883ms(이미 `timeoutMs: 30_000`, `tests/fun.test.ts:149` 주석에 같은 증상이 적혀 있음), 그다음이 마감 보스 627ms, 메인 working→idle 556ms, 느린 소스 419ms다. **한도를 올리지 않은 테스트 중 가장 무거운 셋**이 이 셋이라, 이 VM보다 약 8배 느린 환경(부하가 큰 노트북·CI·가상 머신)에서는 정확히 3개가 먼저 5초를 넘는다. 감사 당시 호스트의 실패 목록은 받지 못했으므로 "그 3개가 이것"이라고 단정하지는 않는다. 다만 이 VM에서 실패를 만들 수 있는 경로는 이것 하나뿐이었다.

`loCells` 메모이즈 같은 제품 쪽 최적화도 실험했지만 무거운 테스트 시간이 바뀌지 않았다(엔진 쪽 타이머 비용). 그래서 제품 코드는 그대로 두고 테스트를 고쳤다.

**수정.** `tests/kit.ts:8` `TEST_TIMEOUT_MS = 30_000`, 같은 파일의 `test` 래퍼가 모든 테스트에 기본 한도를 준다(개별 지정이 있으면 그 값). 진짜로 멈춘 테스트는 30초에 여전히 실패한다. 같은 스트레스에서 수정 전 0/12 → 수정 후 12/12 통과(최종 65개 스위트로 다시 12/12, 최장 18.2초).

함께 찾은 "검사" 실패: README의 `tsc -p . --noEmit`. 엔진이 깐 2.1.295·2.1.302·2.1.314 타입으로 돌리면 `tests/fun.test.ts`에서 4개 오류가 났다. `$.prompt.submit`는 `wait`와 `origin`이 필수이고(`PromptSubmitInput`), 이 빌드들의 내장 도구 목록에는 `Grep`이 없다. 프롬프트에 `TYPED`(`tests/fun.test.ts:56`)를 붙이고 `Grep`을 `Write`로 바꿨다. 세 빌드 모두 `tsc` 종료 코드 0.

## 2. 지원 호스트 범위

- 정의: **2.1.295 이상**(기존 문서의 기준), **2.1.316까지 테스트**(현재 npm 최신). `hooks/host.ts:5-6`.
- 판정: `$.session.version()`의 `base`(없으면 `version`)를 비교한다. 개발 빌드 `2.1.300-dev…`는 2.1.300으로 본다. `hooks/host.ts:20`.
- 2.1.295 미만: `/tama`(인자와 상관없이)가 `Tamagent needs Claude Code 2.1.295 or newer; this is 2.1.294. Run claude update and restart.`(한국어도 있음)로 답하고 패널을 열지 않는다. 세션 시작 때 토스트 한 번. 갱신·애니메이션·도구 반응·중계 띠는 쉰다(`hooks/register.tsx:313`, `:331`, `:371-427`). 지난 세션에서 열어 둔 패널이 남아 있으면 "불러오는 중" 대신 같은 이유를 그린다(`:454`).
- 2.1.316 초과: 패널은 열고 `! host: Claude Code X is newer than the tested 2.1.295–2.1.316; report problems` 한 줄을 보인다. 버전을 못 읽으면 지원 범위와 함께 그 사실을 한 줄로 보인다.
- 문서: 네 README의 설치 절. `tests/test_manifest.py`가 README 숫자와 `hooks/host.ts` 값이 같은지 확인한다.
- 근거: 2.1.290–2.1.294도 검증·테스트는 통과했다. 하한을 내리려면 그 빌드에서 TTY 확인 뒤 `MIN_HOST`와 README를 같이 바꾸면 된다.
- 실제 TTY 확인: 2.1.294에서 `/tama`와 `/tama cast` 모두 위 문구로 거절되고 패널이 열리지 않았다. 2.1.316에서는 경고 없이 열렸다.

참고: 매니페스트에서 호스트 버전 하한을 선언하는 필드는 이 빌드들의 문서·validate에서 찾지 못했다. 그래서 런타임에서 확인한다. 함수 훅 API 자체가 없는 아주 오래된 빌드에서는 모듈이 로드되지 않으므로 이 안내도 나오지 않는다.

## 3. 테스트 보강 (47 → 65)

| 흐름 | 테스트 |
| --- | --- |
| 설치 | `tests/test_manifest.py`: 마켓플레이스·플러그인·hooks 매니페스트 일치, userConfig 기본값과 타입, 네 README의 설치 명령이 `repository`와 같은 저장소를 가리키는지. `tests/flow.test.ts:77` 기본값만으로 열림, 오류 줄 없음, 5초 갱신 |
| 상태 변화 | `flow.test.ts:92` 서브에이전트 pending→running→completed, `:110` 외부 working→failed→waiting과 중계 |
| 숨기기·보이기 | `flow.test.ts:153` 닫으면 갱신·blit 정지, 다시 열면 고른 보기 유지 |
| 실패 설명 | `flow.test.ts:128` 서브에이전트 목록 거절, 시간 초과, 4 MiB 초과, 종료 코드(stderr 마지막 줄), 회복 시 지움 |
| 재시작·복원 | `flow.test.ts:177` 패널이 열린 채 `session.start`면 `/tama` 없이 재개, `/clear` 뒤 재시작해도 타이머 한 벌. `:195` 닫힌 채 재시작하면 아무것도 안 돌림 |
| 스킨·목소리 지연 | `flow.test.ts:203` 4초 걸려 실패하는 스킨: 그동안 "Loading…", 뒤엔 기본 그림과 이유. `:216` 느리지만 성공하는 스킨. `:228` 느린 목소리 팩. `:240` 늦게 끝난 옛 `/tama voice`가 마지막 선택을 덮지 않음. `:257` 없는 팩은 기본 목소리와 이유 |
| 호스트 범위 | `tests/host.test.ts:34-89` 다섯 경우 |

회귀 확인: 호스트 검사를 빼면 `host.test.ts` 4개, `errorText` 수정을 빼면 4개(단위 1 + 흐름 3)가 실패했다.

## 4. 오류 줄이 잘리던 문제 (검증된 결함)

엔진은 거절 사유 앞에 `tamagent: $.fs.read: `처럼 플러그인과 호출을 붙인다. 120칸 패널에서 없는 목소리 팩은 `! voices gone: tamagent: $.fs.read: ENOENT: /users/…/gone.json; using default voice…`로 그려져, 어떤 대체 동작을 했는지가 잘렸다. 스킨·서브에이전트·소스 오류도 같은 머리가 붙었다. `hooks/agents.ts:18` `errorText`가 그 머리를 뗀다. 사용자 문장 속 콜론(`config.yml: permission denied`)은 그대로 둔다(`tests/board.test.ts`의 단위 테스트).

## 5. README를 clean clone에서 따라 하기

| 단계 | 결과 |
| --- | --- |
| `claude plugin install tamagent --marketplace Bum-Boo/tamagent --scope user -y`(격리된 `HOME`·`CLAUDE_CONFIG_DIR`) | 성공, 0.2.1 enabled. 로컬 clone 경로를 마켓플레이스로 줘도 성공. README의 `/plugin install …`은 대화형 같은 명령이다 |
| `python3 tools/make_sprites.py` | 성공, 작업 트리 변경 없음(결정적) |
| `python3 -m unittest discover -s tests -p 'test_*.py' -v` | 전 9개 OK → 후 14개 OK. ffmpeg가 없으면 9개 중 8개를 건너뛰고도 OK(README에 적음) |
| `claude plugin validate .` | 전·후 통과(아이콘 없음 경고 1개는 디렉터리 제출용 안내) |
| `claude plugin test .` | 전 47/0 → 후 65/0 |
| `tsc -p . --noEmit` | 전: clean clone에서 TS5083, 타입을 깔아도 오류 4개. 후: README대로 `claude --plugin-dir .`에서 `/tama`를 한 번 연 뒤 종료 코드 0. `claude -p`로는 타입이 생기지 않았다(이 프로세스에서 hooks 모듈이 꺼져 있다는 로그) |
| 실제 TTY `/tama` | 아래 6절 |

README 예제 중 치이카와 가져오기는 제3자 저장소에서 내려받으므로 돌리지 않았다.

## 6. 실제 TTY 패널

로그인 없이 `env -i`로 격리한 HOME에서 `claude --plugin-dir <clone>`을 의사 터미널(160×50)로 띄우고 `/tama`, `/tama cast`를 입력했다. 화면은 pyte로 렌더해 확인했다. 모델 요청은 보내지 않았다.

- 2.1.295, 2.1.302, 2.1.314, 2.1.316: `Opened the Tamagent panel.`, 도킹 패널에 `[ List ] [ Show all ]`, `Happening now (0)`, `All quiet.`, 슬라임 반칸 래스터. `/tama cast`는 `Commentary off. …`.
- 2.1.294: 2절의 거절 문구.
- 2.1.314 종단 간: 설정 파일 `pluginConfigs.tamagent.options`에 `examples/mock-agents.py` 소스와 `import-frames`로 만든 합성 스킨(`--skin e2e --as bot`, 원본 robot 미리보기 PNG 복사본)을 지정했다. 패널에 `● Build · Writing code · parser.py`, `◐ Review Queue · Needs review · 3 changed files`와 스킨 캐릭터가 그려졌다.

## 실행한 명령과 결과 (전 → 후)

```sh
claude --version                                    # 2.1.314
python3 -m unittest discover -s tests -p 'test_*.py' -v   # 9 OK → 14 OK
claude plugin validate .                            # √ → √
claude plugin test .                                # 47 pass/0 fail → 65 pass/0 fail
tsc -p . --noEmit                                   # TS5083(clean clone) / 오류 4개(타입 설치 후) → 0
# 빌드 23개 행렬: 2.1.290–296, 299–312, 315, 316 각각 validate + test
#   전: 전부 √, 47/0   후: 전부 √, 65/0
# 스트레스: for i in 1..12; taskset -c 0 claude plugin test . &
#   전: 12회 모두 실패(회당 9–17개, 전부 5 s 시간 초과)   후: 12/12 통과
```

## 이 VM에서 확인하지 못한 것

- Windows, macOS, 실제 기기, kitty/Ghostty의 PNG `Image` 렌더(이 VM은 반칸 래스터만), tmux·SSH 경유, 데스크톱 앱의 Code 탭과 VS Code·모바일 화면.
- 설치 시 대화형 질문(`Add marketplace?`, 범위 선택, 설정 화면) 자체. CLI로 같은 설치를 했을 뿐이다.
- 로그인한 세션에서 모델이 실제로 도구를 부를 때의 펫 반응·중계(테스트 키트로만 확인).
- 2.1.316보다 새 빌드(아직 없음), 감사 당시 호스트의 원래 실패 목록.
- 치이카와 예제 등 외부 다운로드, 실제 Codex 펫 ZIP. 외부 서비스는 호출하지 않았다.

## 남은 정적 위험

- **중계 음소거가 재시작에서 풀림.** `hooks/register.tsx:320`이 `session.start`마다 `isCastOn`을 설정값으로 되돌린다. 테스트로 확인: `/tama cast`로 끈 뒤 `session.start`를 다시 보내면 띠에 `Caster`가 돌아온다. 설정 변경 뒤 재로드, resume, `/clear`가 모두 해당한다. 세션 안 토글로 의도한 것이라면 README에 "다음 세션에는 설정값으로 돌아간다"고 적고, 아니라면 `$.store`에 저장하는 편이 맞다.
- **열기 도중 예외.** `startPolling`(`hooks/register.tsx:255-257`)은 `isOpen = true`를 먼저 세운다. 그 뒤 `initialize`나 첫 `poll`이 던지면 타이머 없이 열린 상태로 남고 다음 `/tama`도 바로 돌아간다. 다른 플러그인이 `state.set`을 거절하게 만들어 재현을 시도했지만 엔진이 훅 실패를 격리해서 재현되지 않았다. 지금 경로는 모두 `catch`가 있다.

## 다음 단계 (소유자)

1. 감사 때 실패한 호스트에서 `claude plugin test .`를 다시 돌려 테스트 이름과 `[ms]`를 확인해 주세요. 시간 초과였다면 1절로 설명되고, 단정 실패였다면 출력을 남겨 주세요.
2. 새 Claude Code가 나오면 `claude plugin test .`와 TTY `/tama`를 확인한 뒤 `hooks/host.ts`의 `TESTED_HOST`와 네 README의 숫자를 같이 올리세요(`tests/test_manifest.py`가 어긋나면 실패합니다).
3. macOS·Windows 실기기에서 kitty/Ghostty 그림 모드와 USERPROFILE 경로를 확인해 주세요.
4. 중계 음소거를 세션을 넘어 유지할지 정해 주세요.
5. 플러그인 디렉터리에 낼 계획이면 `validate`가 알려 준 아이콘(`.claude-plugin/icon.png`, 512–2048px)을 새 그림 작업과 함께 준비하세요.
