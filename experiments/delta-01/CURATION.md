# 의미 큐레이션 기록 (PROTOCOL.md §2.3)

> 전건 기록 — drop에도 사유를 남긴다. 큐레이션 자체가 provenance다.
> 판독: Claude (Fable 5), 2026-08-22. 규칙: (a) 실질 질문 (b) 답 존재 (c) 자기완결 (d) 문서로 답 가능 (e) 클러스터 dedup.
> `answer_pick`: cases.json에 실을 정답 코멘트의 작성자 (미표기 = 마지막 실질 답변).

## 1차분 — 이슈 #1947~#33223 (46건 중 27 keep / 19 drop)

| # | 판정 | answer_pick | 사유 |
|---|---|---|---|
| 1947 | keep | benbarclay | Docker 컨테이너 root/apt — COLLABORATOR 답변 자기완결 |
| 4420 | keep | teknium1 | 웹 UI 존재 여부 — dashboard·포트·Chat 탭 구체적 |
| 5047 | keep | teknium1 | Discord 파일 업로드 인식 — "가능, txt/py 주입" 추출 가능 |
| 5524 | drop | — | (d) curl 443 — 사용자 네트워크 환경 이슈, 일회성 |
| 6102 | drop | — | (a) STT CPU 폴백 — 질문이 아니라 패치 제안(RFC성) |
| 6997 | keep | teknium1 | tool-call limit — max_turns 기본 90·오버라이드·소진 시 동작 |
| 7671 | drop | — | (b) 완벽한 온보딩 질문이나 답이 "docs 읽어라"뿐 — 답 부재 |
| 8381 | keep | teknium1 | Telegram 세션 리셋 — resume_pending·/resume·config 위치 |
| 8445 | keep(약) | ystory | 이름 유래 — 트리비아지만 답 자기완결. 1차 답변은 에이전트 스팸이라 제외 |
| 9129 | keep | teknium1 | 멀티 플랫폼 동시 사용 — 게이트웨이 1개가 전 플랫폼 연결 |
| 9196 | keep | teknium1 | Windows 네이티브 — Tier 1·install.ps1·WSL2는 dashboard 한정 |
| 9580 | keep | alt-glitch | Azure Foundry — azure-foundry 프로바이더·auto-detect |
| 10030 | keep | teknium1 | 멀티 프로필 게이트웨이 — 프로필 다중화 모드 |
| 10218 | keep(약) | teknium1 | ARM64/RPi 지원 여부 — 질문은 빈약하나 답이 일반화됨 |
| 10387 | keep | teknium1 | 동명 바이너리 충돌(HERMES 데이터 도구) — 진단·해결 자기완결 |
| 11922 | keep | teknium1 | 멀티에이전트·채널별 페르소나 — delegate_task·channel_prompt |
| 15291 | drop | — | (e) OAuth 과금 클러스터(#20732·#29539와 동근원) — #29539만 keep |
| 15694 | keep | teknium1 | stdio MCP 서버 — config 예시 포함, FAQ 최적 |
| 15866 | drop | — | (d) 타임스탬프 캐시 무효화 — 버전 특정 수정 이력 답변 |
| 16077 | drop | — | (a) RFC 리뷰 요청 — 질문 아님 |
| 17690 | keep | alt-glitch | 압축 임계값 경고 의미 — 정보성·해결 2경로 |
| 19248 | drop | — | (a)(b) 보안 리포트 상태 문의 — 내용 없음 |
| 19752 | keep | teknium1 | 프롬프트 커스터마이즈 표면 — SOUL/MEMORY/USER.md·skills 경로 |
| 20732 | drop | — | (e) OAuth 과금 클러스터 — #29539만 keep |
| 22237 | keep(약) | alt-glitch | update의 Node 단계 느림 — Camofox postinstall이 원인(✓ack) |
| 24840 | drop | — | (d) 무료 티어 모델 404 — 과금 티어·버전 특정 |
| 25055 | keep | teknium1 | Gemini 연결법 — OAuth CLI 제거, AI Studio API 키가 현행 경로 |
| 25362 | drop | — | (e) 멀티 프로필 클러스터(#10030·#30673과 동근원), 질문 빈약 |
| 25378 | keep(약) | teknium1 | Azure OpenAI api-version 절단 — 현행은 쿼리 파라미터 보존 |
| 26105 | keep | flowioo | DeepSeek 모델명 정규화로 과금 상이(✓ack) — 함정 FAQ 최적 |
| 27228 | drop | — | (a) Grok 쿼터 불평 — 타사 과금, 질문 형식 아님 |
| 27722 | drop | — | (a)(c) 스크린샷 단독 질문 — 본문 없음 |
| 28211 | drop | — | (c) 403 체크리스트 요청 — 답이 커밋 참조 의존, 질문에 직접 대응 안 함 |
| 28833 | drop | — | (a) 불만 토로 — incoherent 닫힘 |
| 29125 | drop | — | (c) Claude CLI 토큰 혼란 — 사용자 간 혼란 스레드, 권위 있는 답 없음 |
| 29351 | keep | teknium1 | 커스텀 도구 추가 — 플러그인 경로·ctx.register_tool |
| 29476 | keep(약) | teknium1 | SOUL.md/USER.md 미인식 — 로드 경로·설치 스캐폴드 설명 추출 가능 |
| 29539 | keep | alt-glitch | Claude Pro/Max가 API 과금으로 — API 키 vs OAuth 과금 라우팅(클러스터 대표) |
| 29549 | drop | — | (a) 메모리 아키텍처 제안 에세이 — 질문 아님 |
| 30673 | keep | benbarclay | 두 Hermes 파일 격리 — 프로필 명령어 포함 완결 답변 |
| 30903 | drop | — | (a) 무관 앱 응원 메시지 |
| 31559 | keep(약) | teknium1 | LocalAI /usage 0 표시 — include_usage 현행 동작 |
| 32324 | drop | — | (a) HTML 덤프·비정형 불만 |
| 32757 | keep | alt-glitch+teknium1 | Nous Portal 경유 ZDR — provider_routing 전달, 프라이버시 FAQ |
| 32767 | drop | — | (a) 내부 워크플로 검증 태스크 — Q&A 아님 |
| 33223 | keep | teknium1 | smart_model_routing 제거 이유 — 정책 답변(자동 라우팅 불수용) |

**클러스터 기록**: OAuth/구독 과금(#15291·#20732·#29539·#29125 관련) → #29539 대표. 멀티 프로필(#10030·#25362·#30673·#9129) → 게이트웨이 다중 플랫폼(#9129)·프로필 다중화(#10030)·파일 격리(#30673)는 서로 다른 측면이라 각각 keep, #25362만 dedup.

## 2차분 — 이슈 #33811~#70035 (20건 중 14 keep / 6 drop, 2026-08-22)

| # | 판정 | answer_pick | 사유 |
|---|---|---|---|
| 33811 | keep(약) | teknium1 | Ollama Cloud 연결 — 현행 엔드포인트 `/v1` 라우팅 추출 가능 |
| 34662 | keep | teknium1 | 멀티 플랫폼 페르소나 일관성 — SOUL.md 단일 소스·/personality 오버레이 |
| 34751 | keep | teknium1 | Telegram Unauthorized — allowed_chats vs allow_from 구분, 인가 순서 5단계 (사람 답변, 완결) |
| 37650 | drop | — | (a) 협업 제안 편지 — 질문 아님 |
| 38360 | keep | teknium1 | Qwen/vLLM reasoning-parser 지원 범위 — 문서화된 정책·워크어라운드 |
| 38935 | keep | teknium1 | Windows 설치 경로 — install.ps1 -HermesHome/-InstallDir 예시 포함 |
| 39509 | drop | — | (a) OpenClaw 비교 도발 — incoherent |
| 41467 | drop | — | (a)(c) 비정형 불만, 답변은 개인 환경 일화 |
| 42473 | keep | teknium1 | 플랫폼 어댑터 기여 경로 — 플러그인 표준 루트·가이드 (기여자 온보딩 FAQ 최적) |
| 43880 | keep | teknium1 | Claude 구독 사용 가능? — Max+크레딧 가능·Pro 불가·API 키 대안 (#29539와 다른 측면: 청구 라우팅 vs 지원 구독) |
| 47644 | keep(약) | teknium1 | Telegram 채널 프롬프트 해제·그룹 게이팅 — channel_prompts·require_mention |
| 51062 | keep | teknium1 | 사용자 소유 이동식 메모리 — memory 문서·write_approval·프로바이더 |
| 51718 | drop | — | (a) 쇼케이스 홍보 — 질문 아님 |
| 52397 | keep(약) | teknium1 | Honcho 사용자별 peer — X-Hermes-Session-Key 헤더 (니치, 홀드아웃 적합) |
| 53359 | keep | teknium1 | 로컬 gguf 컨텍스트 초과 — OLLAMA_CONTEXT_LENGTH·num_ctx (흔한 함정) |
| 53760 | keep(약) | teknium1 | cron 작업 반복 상한 — agent.max_turns (#6997의 cron 측면) |
| 54393 | keep(약) | alt-glitch | 대시보드 폰트 변경 — 폰트 피커·테마 yaml(✓ack) |
| 57632 | keep | teknium1 | 모델 목록 정리 — Desktop 편집 모델·visibility 토글 |
| 66712 | drop | — | (e) 어댑터 기여 경로 — #42473과 동근원, dedup |
| 70035 | drop | — | (b) 터키어 i18n 현황 — 답변이 무관 보일러플레이트 |

**최종**: 총 66 후보 중 **41 keep** (기계 필터: 81 → 66, 의미 큐레이션: 66 → 41). 시간 분할 결과 가시 25(상한 적용) + 홀드아웃 16 — 홀드아웃이 목표(10~15)를 1건 초과하나 분할 규칙(§2.5)을 우선한다(케이스를 골라 빼는 것이 더 나쁜 개입).
