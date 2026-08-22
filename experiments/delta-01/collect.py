#!/usr/bin/env python3
"""델타 실측 01 — 케이스 수집 + 기계 필터 (PROTOCOL.md §2).

GitHub API에서 hermes-agent의 닫힌 question 이슈와 코멘트를 수집해
기계 필터(§2.2)를 적용하고 candidates.jsonl을 만든다.

- 모든 API 응답은 raw/에 캐시 — 재실행 시 재요청 없음(비인증 60콜/시간 대응).
- 레이트리밋 소진 시 진행 상황을 남기고 정상 종료 → 재실행하면 이어서 받는다.
- GITHUB_TOKEN 환경변수가 있으면 사용(5,000콜/시간).

사용: python3 collect.py            # 수집 + 필터 + candidates.jsonl
      python3 collect.py --status   # 캐시 진행 상황만 표시
"""

import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

REPO = "NousResearch/hermes-agent"
LABEL = "question"
BASE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(BASE, "raw")

# ── 기계 필터 파라미터 (PROTOCOL.md §2.2 — 변경 시 프로토콜과 함께 개정) ──
MIN_BODY_CHARS = 100
MIN_ANSWER_CHARS = 200
MAX_LINK_DENSITY = 0.5
BODY_TRUNC = 1200     # candidates.jsonl에 실을 본문 길이 (큐레이션용)
ANSWER_TRUNC = 1500
MAX_ANSWER_CANDIDATES = 3  # 이슈당 답변 후보 상한 (최신순)


def api_get(path, cache_name):
    """캐시 우선 GET. 레이트리밋 소진 시 None 반환."""
    cache_path = os.path.join(RAW, cache_name)
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            return json.load(f)
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "harnest-delta-01",
            **({"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"}
               if os.environ.get("GITHUB_TOKEN") else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            reset = e.headers.get("x-ratelimit-reset", "?")
            if reset != "?":
                reset = datetime.fromtimestamp(int(reset), tz=timezone.utc).isoformat()
            print(f"  ! 레이트리밋 소진 (reset {reset}) — 캐시 저장분까지만 진행. 재실행하면 이어서 받음.")
            return None
        raise
    with open(cache_path, "w") as f:
        json.dump(data, f)
    return data


def fetch_issues():
    """닫힌 question 이슈 전체 (페이지네이션, PR 제외)."""
    issues, page = [], 1
    while True:
        data = api_get(
            f"/repos/{REPO}/issues?state=closed&labels={LABEL}&per_page=100&page={page}",
            f"issues_p{page}.json",
        )
        if data is None:
            return None
        issues += [i for i in data if "pull_request" not in i]
        if len(data) < 100:
            return issues
        page += 1


def link_density(text):
    links = re.findall(r"https?://\S+|#\d{2,}", text)
    return sum(len(l) for l in links) / max(len(text), 1)


def is_bot(login):
    return login.endswith("[bot]") or login in ("github-actions", "stale")


def mech_filter(issue, comments):
    """기계 필터 §2.2 — (통과 여부, 탈락 사유, 답변 후보 목록).

    state_reason은 게이트가 아니라 메타데이터다(2026-08-22 개정): 이 저장소는
    답변된 질문도 not_planned로 닫는다(58건 중 46건). 답변 존재는 닫힘 사유가
    아니라 스레드 내용(§2.3 의미 큐레이션)으로 판정한다.
    """
    body = issue.get("body") or ""
    if len(body) < MIN_BODY_CHARS:
        return False, f"본문 {len(body)}자 < {MIN_BODY_CHARS}", []
    author = issue["user"]["login"]
    others = [c for c in comments
              if c["user"]["login"] != author and not is_bot(c["user"]["login"])]
    if not others:
        return False, "작성자 외 코멘트 없음", []
    answers = [c for c in others
               if len(c.get("body") or "") >= MIN_ANSWER_CHARS
               and link_density(c["body"]) < MAX_LINK_DENSITY]
    if not answers:
        return False, "실질 답변 후보 없음(짧거나 링크만)", []
    return True, "", answers


def author_acknowledged(issue, comments, answer):
    """정답 우선순위 §2.4-1: 답변 이후 질문자의 확인 코멘트가 있는가."""
    author = issue["user"]["login"]
    after = [c for c in comments
             if c["user"]["login"] == author and c["created_at"] > answer["created_at"]]
    pat = re.compile(r"thank|works|solved|resolved|got it|that.s it|perfect|fixed my", re.I)
    return any(pat.search(c.get("body") or "") for c in after)


def main():
    os.makedirs(RAW, exist_ok=True)
    issues = fetch_issues()
    if issues is None:
        sys.exit(0)
    print(f"닫힌 {LABEL} 이슈: {len(issues)}건 (수집 {datetime.now(timezone.utc).isoformat()})")
    if "--status" in sys.argv:
        cached = len([f for f in os.listdir(RAW) if f.startswith("comments_")])
        print(f"코멘트 캐시: {cached}/{len(issues)}")
        return

    candidates, dropped = [], []
    for issue in sorted(issues, key=lambda i: i["created_at"]):
        n = issue["number"]
        comments = api_get(f"/repos/{REPO}/issues/{n}/comments?per_page=100",
                           f"comments_{n}.json")
        if comments is None:
            break  # 레이트리밋 — 여기까지 저장하고 종료
        ok, why, answers = mech_filter(issue, comments)
        if not ok:
            dropped.append({"number": n, "title": issue["title"], "reason": why})
            continue
        answers = sorted(answers, key=lambda c: c["created_at"])[-MAX_ANSWER_CANDIDATES:]
        candidates.append({
            "number": n,
            "title": issue["title"],
            "state_reason": issue.get("state_reason"),
            "created_at": issue["created_at"],
            "closed_at": issue["closed_at"],
            "author": issue["user"]["login"],
            "body": (issue.get("body") or "")[:BODY_TRUNC],
            "answers": [{
                "id": c["id"],
                "user": c["user"]["login"],
                "author_association": c.get("author_association", ""),
                "created_at": c["created_at"],
                "acknowledged": author_acknowledged(issue, comments, c),
                "body": c["body"][:ANSWER_TRUNC],
            } for c in answers],
        })

    with open(os.path.join(BASE, "candidates.jsonl"), "w") as f:
        for c in candidates:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    with open(os.path.join(BASE, "mech_dropped.json"), "w") as f:
        json.dump(dropped, f, ensure_ascii=False, indent=1)
    print(f"기계 필터: 통과 {len(candidates)} / 탈락 {len(dropped)}")
    print("→ candidates.jsonl (큐레이션 입력), mech_dropped.json (탈락 사유 기록)")


if __name__ == "__main__":
    main()
