# Harnest Lite API

프론트엔드 E2E 검증용 FastAPI 서버입니다. 아직 LLM, DB, 인증은 없지만 사용자가 입력한 채용공고, 초안, 필수 포함 항목을 바탕으로 실제 점수를 계산하고 개선 후보를 채택/폐기합니다.

## 실행

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

프론트는 다음 환경 변수를 사용하면 FastAPI Lite 엔진을 호출합니다.

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api
```

환경 변수가 없으면 프론트 내부 fallback adapter가 동작합니다.

## Endpoints

```txt
GET  /health
POST /api/interviews/draft
POST /api/interviews/approved
POST /api/runs
GET  /api/runs/{run_id}
POST /api/runs/{run_id}/result
```
