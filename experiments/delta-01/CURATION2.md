# 의미 큐레이션 기록 v2 — 델타 02 (PROTOCOL.md §9)

> 전건 기록. 판독: Claude (Fable 5), 2026-08-22. 모집단: 닫힌 이슈 11,463 → 질문형+기계 필터 193.
> 규칙: (a) 실질 질문 (b) 답 존재 (c) 자기완결 (d) 문서로 답 가능. **dedup은 여기서 하지 않는다** —
> 동근원 질문에는 `cluster` 라벨만 달고 keep, 병합은 build_cases_v2.py가 가시 세트 내부에서만 수행(§9 개정 3).
> v1 기판정 66건은 판정·answer_pick 이관(사유란에 [v1]). 표: | 번호 | 판정 | answer_pick | cluster | 사유 |

| 번호 | 판정 | answer_pick | cluster | 사유 |
|---|---|---|---|---|
| 651 | drop | — | — | (a)(d) codex 모델 불일치 버그·수정 커밋 |
| 1451 | keep | teknium1 | local-perf | 소형 로컬 모델 느림 — 툴 스키마 오버헤드·toolset 축소 팁(✓ack) |
| 1558 | drop | — | — | (a) 인젝션 버그·PR |
| 1572 | keep(약) | — | model-routing-policy | 프롬프트 분류→모델 라우팅 요청 — 정책상 불수용 답변 |
| 1589 | drop | — | — | (d) crontab 검사 제거 — 버전 수정 |
| 1947 | keep | benbarclay | docker | [v1] Docker root/apt |
| 2066 | drop | — | — | (a) venv 경로 오타 수정 |
| 2821 | drop | — | — | (d) litellm PyPI 격리 — 일회성 사건 |
| 2825 | keep(약) | Mibayy | termux-install | Termux/proot 설치 — UV_LINK_MODE=copy 워크어라운드 |
| 2886 | drop | — | — | (d) NoneType 버그 수정 |
| 3555 | keep(약) | teknium1 | honcho | 로컬 Honcho는 api_key 불요(base_url 인정) — 현행 동작 |
| 3846 | keep | Mibayy | provider-auto | provider:auto가 env 키를 주워 base_url 무시 — 함정 FAQ(✓ack) |
| 4018 | drop | — | — | (d) 표기 불일치 UI 버그 |
| 4420 | keep | teknium1 | web-ui | [v1] 웹 대시보드 존재 |
| 4594 | drop | — | — | (d) NixOS matrix extra — 버전 수정 |
| 5047 | keep | teknium1 | file-upload | [v1] Discord 파일 인식 |
| 5204 | drop | — | — | (c) 위임 병렬성 — 시점별 답 모순(순차→팬아웃) |
| 5352 | keep(약) | — | api-server | 스트리밍 툴 진행 표시 — stream_tool_progress 옵트아웃 |
| 5524 | drop | — | — | [v1] (d) 네트워크 환경 |
| 5537 | keep(약) | — | file-delivery | 게이트웨이 파일 전송 — 어댑터 send_document 지원 |
| 5554 | keep(약) | — | arm64 | ARM64 Docker 이미지 지원 여부 |
| 5695 | keep | 0xbyt4 | plugins | /plugins는 목록 전용, 설치는 CLI — Claude Code는 플러그인 아님 |
| 6087 | drop | — | — | (d) 문서 오기 수정 |
| 6090 | keep | — | security-report | 취약점 신고 경로 — SECURITY.md·Advisories |
| 6102 | drop | — | — | [v1] (a) 패치 제안 |
| 6138 | keep(약) | — | mcp | MCP 도구 이미지 전달 지원 |
| 6147 | drop | — | — | (d) 설치 프롬프트 제거 — 구버전 동작 |
| 6360 | drop | — | — | (d) 프록시 env 오염 진단 여정 |
| 6997 | keep | teknium1 | max-turns | [v1] tool-call limit·max_turns |
| 7671 | drop | — | — | [v1] (b) 답 부재 |
| 8381 | keep | teknium1 | telegram-session | [v1] 세션 리셋·/resume |
| 8445 | keep(약) | teknium1 | — | [v1] 이름 유래(스위퍼 답변에 내용 포함, ystory는 v2 필터 제외) |
| 8475 | drop | — | — | (d) systemd 환경 이슈 |
| 8720 | drop | — | windows | (a) 비정형 불만 — windows는 #9196 대표 |
| 8835 | drop | — | — | (d) 리플레이 버그 수정 |
| 8852 | drop | — | — | (c) 서드파티 대시보드 홍보성 답변 |
| 8873 | keep(약) | alt-glitch | nix | Nix sealed-venv — 런타임 pip 불가, 컨테이너/flake 권장 |
| 9129 | keep | teknium1 | multi-platform | [v1] 게이트웨이 1개=전 플랫폼 |
| 9196 | keep | teknium1 | windows | [v1] Windows Tier 1·install.ps1 |
| 9580 | keep | alt-glitch | azure | [v1] Azure Foundry |
| 9782 | drop | — | nix | (c) nix-darwin — 커뮤니티 설정 링크 답변 |
| 9975 | keep | kshitijk4poor | contrib-policy | 메모리 프로바이더 in-tree CLOSED — 독립 저장소 정책 |
| 10030 | keep | teknium1 | multi-profile | [v1] 프로필 다중화 게이트웨이 |
| 10218 | keep(약) | teknium1 | arm64 | [v1] ARM64/RPi 지원 |
| 10387 | keep | teknium1 | name-collision | [v1] 동명 바이너리 충돌 |
| 10642 | drop | — | — | (a) 표절 시비 |
| 10787 | drop | — | — | (a) 채팅방 홍보 스팸 |
| 10980 | drop | — | — | (d) keepalive 회귀 — 당일 롤백 |
| 11922 | keep | teknium1 | delegation | [v1] delegate_task·채널 페르소나 |
| 12127 | drop | — | — | (d) Gemini 헤더 핵 회귀 수정 |
| 12541 | drop | — | — | (d) Docker PATH 수정 |
| 12871 | keep | — | observability | 콜체인 추적 — Langfuse 플러그인 옵트인 |
| 13731 | drop | — | docker-uid | (d) UnRAID UID 버그 수정 |
| 14980 | keep(약) | kshitijk4poor | whatsapp | WhatsApp npm 타임아웃 — 300s 기본·env 설정 |
| 15101 | drop | — | — | (a) MoA 확장 제안 |
| 15290 | keep(약) | — | docker-uid | NAS Docker 권한 — PUID/PGID 별칭 |
| 15291 | drop | — | claude-billing | [v1] (e→cluster) OAuth 과금 |
| 15694 | keep | teknium1 | mcp | [v1] stdio MCP 서버 |
| 15866 | drop | — | caching | [v1] (d) 타임스탬프 캐시 — 버전 수정 |
| 16077 | drop | — | — | [v1] (a) RFC |
| 16314 | drop | — | arm64 | (d) 브라우저 설치 스크립트 수정 |
| 16971 | drop | — | — | (a) 스팸 |
| 17009 | keep(약) | — | termux-install | Termux 전용 설치 경로 존재 |
| 17054 | drop | — | — | (d) Slack manifest 수정 |
| 17573 | drop | — | — | (d) WSL2 TTS 수정 |
| 17690 | keep | alt-glitch | compression | [v1] 압축 임계값 경고 의미 |
| 18732 | keep(약) | — | model-routing-policy | 위임별 temperature — 정책상 불수용 |
| 19175 | drop | — | — | (d) pyproject 파싱 수정 |
| 19248 | drop | — | — | [v1] (a)(b) 내용 없음 |
| 19752 | keep | teknium1 | prompt-custom | [v1] 프롬프트 커스터마이즈 표면 |
| 20376 | keep(약) | alt-glitch | vision | 커스텀/Ollama 비전 — supports_vision 오버라이드 |
| 20436 | drop | — | windows | (c) 시점 모순(제한→지원) — #9196 대표 |
| 20605 | drop | — | — | (d) Portal CAPTCHA 서버측 |
| 20663 | drop | — | — | (d) 문서 링크 404 수정 |
| 20732 | drop | — | claude-billing | [v1] (e→cluster) |
| 21462 | keep(약) | — | dingtalk | DingTalk 이미지 전송 — send_image 지원 |
| 21567 | keep(약) | — | compression | 컨텍스트 관리 — 압축기·툴 결과 정리 현행 |
| 21622 | drop | — | skill-logs | (b) 답이 dup 보일러플레이트 — #21625 대표 |
| 21625 | keep | — | skill-logs | 스킬 실행 확인 — /insights·telemetry |
| 21796 | drop | — | — | (a)(d) 스크린샷 요청 |
| 22237 | keep(약) | alt-glitch | update-slow | [v1] update Node 단계 느림 — Camofox |
| 22812 | drop | — | — | (a) 7개 항목 피드백 편지 — 단일 Q 아님 |
| 24840 | drop | — | — | [v1] (d) 무료 티어 404 |
| 25055 | keep | teknium1 | gemini-auth | [v1] Gemini 연결 — AI Studio 키가 현행 |
| 25108 | drop | — | gemini-auth | (d) doctor 검증 버그 수정 |
| 25362 | drop | — | multi-profile | [v1] (e→cluster) |
| 25366 | drop | — | — | (a) incoherent |
| 25378 | keep(약) | teknium1 | azure | [v1] Azure api-version 보존 |
| 25535 | drop | — | — | (d) Kanban Win 버그 수정 |
| 25551 | drop | — | — | (d) Windows 설치 버그 수정 |
| 26066 | drop | — | multi-profile | (a) 기능 스펙 제안서 |
| 26105 | keep | flowioo | deepseek-billing | [v1] 모델명 정규화 과금 함정 |
| 26328 | drop | — | — | (d) macOS 서명 사고 |
| 27228 | drop | — | — | [v1] (a) 타사 쿼터 불평 |
| 27722 | drop | — | — | [v1] (a)(c) 스크린샷 단독 |
| 27744 | drop | — | — | (a) 조롱 |
| 28211 | drop | — | — | [v1] (c) 커밋 참조 의존 |
| 28833 | drop | — | — | [v1] (a) 불만 |
| 29125 | drop | — | claude-billing | [v1] (c) 혼란 스레드 |
| 29351 | keep | teknium1 | custom-tools | [v1] 커스텀 도구 — 플러그인 경로 |
| 29476 | keep(약) | teknium1 | soul-md | [v1] SOUL/USER.md 로드 |
| 29534 | keep(약) | — | gateway-setup | Discord 설정 — gateway setup 위저드 현행 |
| 29539 | keep | alt-glitch | claude-billing | [v1] API 키 vs OAuth 과금 라우팅 |
| 29549 | drop | — | memory | [v1] (a) 아키텍처 에세이 |
| 30673 | keep | benbarclay | multi-profile | [v1] 프로필 격리 |
| 30903 | drop | — | — | [v1] (a) 무관 앱 |
| 31054 | drop | — | — | (d) 토큰 붙여넣기 버그 수정 |
| 31330 | drop | — | dingtalk | (d) 의존성 버전 비호환 |
| 31559 | keep(약) | teknium1 | local-usage | [v1] LocalAI /usage — include_usage |
| 32009 | drop | — | — | (d) Docker 오디오 감지 수정 |
| 32324 | drop | — | soul-md | [v1] (a) HTML 덤프 |
| 32757 | keep | alt-glitch+teknium1 | privacy | [v1] Nous Portal ZDR 라우팅 |
| 32767 | drop | — | — | [v1] (a) 내부 워크플로 |
| 32817 | drop | — | — | (a) 불만·정보 없음 |
| 33178 | drop | — | docker | (c) PATH 리셋 — PR 포인터 답변 |
| 33192 | keep | alt-glitch | claude-billing | OAuth는 Max 전용, Pro 불가(✓ack) — 클러스터 내 최선 답 |
| 33223 | keep | teknium1 | model-routing-policy | [v1] smart_model_routing 제거 정책 |
| 33811 | keep(약) | teknium1 | ollama-cloud | [v1] Ollama Cloud /v1 라우팅 |
| 34662 | keep | teknium1 | soul-md | [v1] 멀티 플랫폼 페르소나 — SOUL.md 단일 소스 |
| 34751 | keep | teknium1 | telegram-auth | [v1] Unauthorized — allow_from 인가 5단계 |
| 36725 | drop | — | mcp | (d) OAuth 타임아웃 수정 |
| 37363 | keep(약) | alt-glitch | claude-billing | Team 플랜 OAuth 불가 — Max 전용 재확인 |
| 37650 | drop | — | — | [v1] (a) 협업 편지 |
| 38227 | keep | — | mac-intel | Desktop은 Apple Silicon 전용 — Intel 미지원 명문화 |
| 38341 | keep(약) | — | custom-provider | 타사(NanoGPT) 연결 — OpenAI 호환 커스텀 경로 |
| 38360 | keep | teknium1 | vllm | [v1] Qwen/vLLM reasoning-parser 정책 |
| 38376 | keep | — | local-toolcall | 로컬 모델 raw tool-call 텍스트 — 구조화 tool_calls만 지원(정책) |
| 38790 | drop | — | — | (d) git fetch 환경 정리 |
| 38919 | keep(약) | — | mac-intel | Intel Mac CPU 미지원 — 문서화 |
| 38935 | keep | teknium1 | windows-install | [v1] 설치 경로 -HermesHome |
| 38963 | drop | — | — | (c) bash.exe PATH 자가 해결 스레드 |
| 39220 | drop | — | whatsapp | (d) Docker 의존성 보존 수정 |
| 39509 | drop | — | — | [v1] (a) 비교 도발 |
| 39532 | keep | ethernet8023 | official-download | 가짜 설치 파일 경고 — 공식 다운로드 경로만(✓ack) |
| 40696 | drop | — | — | (d) cmd 창 추적 이슈 |
| 41467 | drop | — | — | [v1] (a)(c) 비정형 |
| 42130 | drop | — | — | (d) 자격증명 풀 버그 수정 |
| 42239 | keep(약) | — | multi-profile | Desktop 프로필 전환 — profile rail 현행 |
| 42473 | keep | teknium1 | contrib-policy | [v1] 어댑터 기여 경로 — 플러그인 표준 |
| 42803 | drop | — | — | (a) 토큰 급증 — 정보 없음 |
| 42882 | drop | — | — | (d) Electron URL 엣지 |
| 42972 | drop | — | — | (d) Windows 설치 재작업 |
| 43880 | keep | teknium1 | claude-billing | [v1] Claude 구독 — Max+크레딧·Pro 불가·API 키 대안 |
| 44194 | keep(약) | — | web-tools | 셀프호스트 searxng/firecrawl env 표준화 |
| 44894 | keep(약) | teknium1 | aux-billing | 보조 작업이 유료 기본 모델 과금 — fallback 정책 준수 현행 |
| 45276 | drop | — | — | (d) Copilot 라우팅 수정 |
| 46046 | keep(약) | — | sessions | 세션 정리 — 빈 세션 생성 억제·정리 경로 현행 |
| 46775 | keep(약) | — | context-files | AGENTS.md vs .hermes.md 탐색 규칙 — 문서화됨 |
| 46823 | drop | — | context-files | (a) 절단 전략 제안서 |
| 46839 | drop | — | — | (a) 프록시 불만 — 정보 없음 |
| 47566 | drop | — | — | (a)(d) clarify 설계 질문 — 내부 구현 |
| 47644 | keep(약) | teknium1 | telegram-gating | [v1] channel_prompts·require_mention |
| 47759 | drop | — | — | (b) matrix e2ee — 답 부재 |
| 49555 | drop | — | — | (a) 조롱 |
| 49627 | drop | — | — | (d) 부분 설치 상태 |
| 51062 | keep | teknium1 | memory | [v1] 이동식 메모리 가이드 |
| 51718 | drop | — | — | [v1] (a) 쇼케이스 |
| 52397 | keep(약) | teknium1 | honcho | [v1] X-Hermes-Session-Key |
| 52597 | keep | — | toolsets | 플랫폼별 toolset 비활성화 — per-platform 설정 |
| 52995 | keep(약) | teknium1 | compression | 압축 진행 알림 — progress_notices 옵트인 |
| 53359 | keep | teknium1 | ollama-context | [v1] OLLAMA_CONTEXT_LENGTH·num_ctx |
| 53407 | keep | — | contrib-policy | iMessage 어댑터 — 서드파티는 독립 저장소 정책(AGENTS.md) |
| 53411 | keep(약) | — | fonts | Desktop UI Scale 90~175% 현행 |
| 53615 | drop | — | — | (a) 포털 불평 |
| 53760 | keep(약) | teknium1 | max-turns | [v1] cron의 max_turns |
| 53963 | drop | — | — | (d) CJK 클립보드 버그 |
| 54393 | keep(약) | alt-glitch | fonts | [v1] 대시보드 폰트 피커 |
| 54919 | drop | — | — | (d) uv trampoline 환경 파손 |
| 55509 | drop | — | — | (d) clarify 렌더링 수정 |
| 55537 | keep | alt-glitch | token-display | 누적 API 토큰 표기의 의미 — 재전송 합계 |
| 57632 | keep | teknium1 | model-list | [v1] 모델 목록 편집·visibility |
| 58020 | drop | — | — | (d) basic auth 500 dup |
| 58166 | drop | — | — | (d) basic auth 500 dup |
| 58434 | drop | — | — | (d) 배지 스코프 버그 |
| 58708 | drop | — | — | (a) 협업 모집 |
| 58958 | drop | — | — | (d) 텔레그램 dedup 버그 |
| 59986 | drop | — | — | (d) UI 오버레이 버그 |
| 61341 | drop | — | — | (d) basic auth 500 dup |
| 63701 | drop | — | — | (d) PTY 재접속 버그 |
| 64020 | keep(약) | webtecnica | portal-billing | 카드 거절 — Stripe 측·우회책(✓ack) |
| 66712 | drop | — | contrib-policy | [v1] (e→cluster) — #42473 등 대표 |
| 66994 | drop | — | — | (d) BOM 인코딩 수정 |
| 68354 | drop | — | caching | (d) 게이트웨이 캐시 안정화 — 버전 수정(#15866과 일관) |
| 69216 | drop | — | — | (d) uv 감지 수정 |
| 70035 | drop | — | — | [v1] (b) 무관 보일러플레이트 |
| 70682 | drop | — | — | (d) Kimi 플로우 수정 |
| 71413 | keep(약) | — | network | VPN/IPv6 연결 — network.force_ipv4 |
| 74489 | keep | — | api-tokens | 컨텍스트 토큰 수 프로그래매틱 조회 — last_prompt_tokens API |
| 76100 | drop | — | — | (a) 자인 dup |
| 76849 | drop | — | — | (d) 업데이트 잠금 수정 |
| 82168 | drop | — | — | (d) 당일 수정 빌드 실패 |
| 85496 | drop | — | — | (d) ws 401 진단 |
| 85974 | drop | — | — | (c)(d) 인증서 환경 워크어라운드 |

**집계**: 193건 중 **keep 84 / drop 109**. 클러스터 다건 keep: claude-billing 4(29539·33192·37363·43880), contrib-policy 3(9975·42473·53407), model-routing-policy 3(1572·18732·33223), multi-profile 3(10030·30673·42239), compression 3(17690·21567·52995) 등 — 가시 세트 내부 병합은 빌더 소관, 홀드아웃 반복은 보존.
