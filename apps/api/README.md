# Harnest API

프로젝트(인터뷰·판정 절차·루프 스펙)와 실행 결과(체크포인트)를 저장하는 CRUD 서버입니다.
서버는 임의 코드를 실행하지 않으며, 승인된 판정 절차를 받은 그대로 보존해 돌려줍니다.

## 준비

```sh
pip3 install --user -r requirements.txt
```

## 실행

`apps/api` 디렉터리에서:

```sh
python3 -m uvicorn main:app --port 8000
```

데이터는 같은 디렉터리의 `harnest.db`(SQLite)에 저장됩니다 (git 추적 제외).

## 엔드포인트

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/health` | 상태 확인 → `{"status":"ok"}` |
| POST | `/projects` | 본문 `{interview, pack, loopSpec}` 저장 → `{"id": uuid}` |
| GET | `/projects/{id}` | 저장된 프로젝트를 그대로 반환 (없으면 404) |
| POST | `/projects/{id}/results` | 본문 `{checkpoint}` 저장 → `{"ok": true}` (프로젝트 없으면 404) |

CORS는 `http://localhost:5173`(웹 앱)만 허용합니다.

## 테스트

```sh
python3 test_api.py
```

임시 DB로 전 엔드포인트 왕복을 검증하며, 실패 시 비정상 종료합니다.
