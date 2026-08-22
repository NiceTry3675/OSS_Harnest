# Harnest

> 당신이 승인한 기준으로, 될 때까지 스스로 고치는 AI.
> 기획·철학은 [SPEC.md](SPEC.md) · [PHILOSOPHY.md](PHILOSOPHY.md), 실측 기록은 [experiments/delta-01](experiments/delta-01/PROTOCOL.md).

## 워킹 스켈레톤 (시간표 템플릿)

인터뷰(3문항) → 채점 기준 컴파일·승인(동결) → 브라우저 루프 실행(관제실) → 결과. 전부 브라우저에서 완결되며, 백엔드는 있으면 기록하고 없으면 건너뛴다.

### 구조

| 경로 | 내용 |
|---|---|
| `packages/contracts` | 계약 타입 — 인터뷰·Evaluation Pack(동결 다이제스트)·루프(체크포인트/채택 규칙). **명세는 산문이 아니라 타입이다** |
| `packages/loop-engine` | 브라우저 hill-climbing 루프 엔진(독립 배포 예정): 시드 RNG, 매 라운드 체크포인트(IndexedDB), 일시정지·재개, 정체 조기 종료 |
| `templates/timetable` | 폴더 하나 = 템플릿 하나: 질문·컴파일·결정적 채점기·변이기 |
| `apps/web` | React SPA — 위저드(라이브 블루프린트)·승인(잠금)·관제실(개선 곡선·실험 기록)·결과 |
| `apps/api` | FastAPI — 프로젝트 CRUD·결과 업로드(sqlite). 임의 코드 실행 없음 |

### 실행

Node 22+ 필요 (설치 없다면: [nodejs.org](https://nodejs.org) LTS).

```bash
npm install
npm run dev            # 웹 — http://localhost:5173
```

백엔드(선택 — 결과 기록용):

```bash
cd apps/api && pip3 install -r requirements.txt && python3 -m uvicorn main:app --port 8000
```

검사:

```bash
npm run typecheck && npm test          # 계약·엔진·채점기 테스트
cd apps/api && python3 test_api.py    # API 테스트
```

### 스켈레톤이 증명하는 계약 (SPEC §10 특례 포함)

- 채택은 **스칼라 엄격 개선**일 때만(동점은 챔피언 유지), 게이트 기각 후보는 채택 판정에 진입하지 않는다
- 개선 곡선에는 후보가 아니라 **채택 확정 후 챔피언 점수**가 기록된다 — 하락도 그대로
- **매 라운드 체크포인트** 저장: 탭이 죽어도 이어서 재개, 같은 시드는 같은 실행(리플레이)
- 다른 판정 절차의 체크포인트는 이어받을 수 없다(다이제스트 가드) — 기준 수정은 곧 **재승인**
- 결정적 전용 면제(검증 리포트·캘리브레이션 "해당 없음")는 숨기지 않고 승인·결과 화면에 표기된다
