#!/usr/bin/env python3
"""델타 실측 02 — 확대 모집단 수집 (PROTOCOL.md §9 개정 1·2).

닫힌 이슈 전체(약 11.5k)를 검색 API 날짜 이분할로 열거하고, 질문형을 로컬 판별한 뒤
답변 후보(협업자·기여자·멤버·오너 작성 또는 질문자 확인)를 갖춘 이슈를 candidates2.jsonl로 낸다.

토큰: GITHUB_TOKEN 환경변수 또는 GH_TOKEN_FILE 경로의 파일.
캐시: raw2/ — 재실행 시 재요청 없음.
"""

import json
import os
import re
import time
import urllib.parse
import urllib.request

REPO = "NousResearch/hermes-agent"
BASE = os.path.dirname(os.path.abspath(__file__))
RAW2 = os.path.join(BASE, "raw2")

MIN_BODY_CHARS = 100
MIN_ANSWER_CHARS = 200
MAX_LINK_DENSITY = 0.5
BODY_TRUNC, ANSWER_TRUNC, MAX_ANSWERS = 1200, 1500, 3
TRUSTED = {"COLLABORATOR", "CONTRIBUTOR", "MEMBER", "OWNER"}

Q_WORDS = re.compile(
    r"^\s*(\[setup\]|\[question\]|\[inquiry\]|how\b|what\b|why\b|can\b|does\b|"
    r"is it\b|where\b|when\b|should\b|help\b|question\b)", re.I)


def token():
    t = os.environ.get("GITHUB_TOKEN")
    if not t and os.environ.get("GH_TOKEN_FILE"):
        t = open(os.environ["GH_TOKEN_FILE"]).read().strip()
    if not t:
        raise SystemExit("GITHUB_TOKEN 또는 GH_TOKEN_FILE 필요")
    return t


def api(url, cache_name, pace=0.0):
    path = os.path.join(RAW2, cache_name)
    if os.path.exists(path):
        return json.load(open(path))
    if pace:
        time.sleep(pace)
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "harnest-delta-02",
        "Authorization": f"Bearer {token()}",
    })
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and attempt < 4:
                time.sleep(30 * (attempt + 1))
                continue
            raise
    json.dump(data, open(path, "w"))
    return data


def search_count(created):
    q = urllib.parse.quote(f"repo:{REPO} is:issue is:closed created:{created}")
    d = api(f"https://api.github.com/search/issues?q={q}&per_page=1",
            f"count_{created.replace(':','_').replace('.','_')}.json", pace=2.2)
    return d["total_count"]


def search_slice(created):
    """한 날짜 구간의 이슈 전부 (총 1000건 이하 보장된 구간만 호출)."""
    items = []
    for page in range(1, 11):
        q = urllib.parse.quote(f"repo:{REPO} is:issue is:closed created:{created}")
        d = api(f"https://api.github.com/search/issues?q={q}&per_page=100&page={page}&sort=created&order=asc",
                f"slice_{created.replace(':','_').replace('.','_')}_p{page}.json", pace=2.2)
        items += d["items"]
        if len(d["items"]) < 100:
            break
    return items


def mid_date(a, b):
    from datetime import date, timedelta
    da = date.fromisoformat(a)
    db = date.fromisoformat(b)
    return (da + (db - da) / 2).isoformat()


def enumerate_closed(start="2026-01-01", end="2026-09-01"):
    """날짜 이분할 — 구간 total_count ≤ 1000이 될 때까지 쪼갠 뒤 수집."""
    stack, items = [(start, end)], []
    while stack:
        a, b = stack.pop()
        rng = f"{a}..{b}"
        n = search_count(rng)
        if n == 0:
            continue
        if n > 1000 and a != b:
            m = mid_date(a, b)
            if m in (a, b):
                print(f"  ! {rng}: {n}건 — 하루 1000+ 초과, 앞 1000건만")
                items += search_slice(rng)
                continue
            stack += [(a, m), (m, b)]
        else:
            print(f"  {rng}: {n}건")
            items += search_slice(rng)
    seen, out = set(), []
    for i in items:
        if i["number"] not in seen:
            seen.add(i["number"])
            out.append(i)
    return out


def is_question(issue):
    t = issue["title"]
    if "?" in t or "？" in t or "how to" in t.lower():
        return True
    if Q_WORDS.search(t):
        return True
    labels = {l["name"].lower() for l in issue.get("labels", [])}
    return bool(labels & {"question", "support", "docs"})


def link_density(text):
    links = re.findall(r"https?://\S+|#\d{2,}", text)
    return sum(len(l) for l in links) / max(len(text), 1)


def is_bot(login):
    return login.endswith("[bot]") or login in ("github-actions", "stale")


def acked(author, comments, ans):
    pat = re.compile(r"thank|works|solved|resolved|got it|that.s it|perfect|fixed my", re.I)
    return any(c["user"]["login"] == author and c["created_at"] > ans["created_at"]
               and pat.search(c.get("body") or "") for c in comments)


def main():
    os.makedirs(RAW2, exist_ok=True)
    closed = enumerate_closed()
    print(f"닫힌 이슈: {len(closed)}건 (수집 {time.strftime('%Y-%m-%dT%H:%M:%S')})")
    pool = [i for i in closed if is_question(i)
            and len(i.get("body") or "") >= MIN_BODY_CHARS
            and i.get("comments", 0) >= 1]
    print(f"질문형 판별 + 본문·코멘트 필터: {len(pool)}건 → 코멘트 수집")

    candidates, dropped = [], 0
    for k, issue in enumerate(sorted(pool, key=lambda i: i["created_at"])):
        n = issue["number"]
        comments = api(f"https://api.github.com/repos/{REPO}/issues/{n}/comments?per_page=100",
                       f"comments_{n}.json")
        author = issue["user"]["login"]
        subst = [c for c in comments
                 if c["user"]["login"] != author and not is_bot(c["user"]["login"])
                 and len(c.get("body") or "") >= MIN_ANSWER_CHARS
                 and link_density(c["body"]) < MAX_LINK_DENSITY]
        answers = [c for c in subst
                   if c.get("author_association") in TRUSTED or acked(author, comments, c)]
        if not answers:
            dropped += 1
            continue
        answers = sorted(answers, key=lambda c: c["created_at"])[-MAX_ANSWERS:]
        candidates.append({
            "number": n, "title": issue["title"],
            "state_reason": issue.get("state_reason"),
            "created_at": issue["created_at"], "closed_at": issue["closed_at"],
            "author": author, "labels": [l["name"] for l in issue.get("labels", [])],
            "body": (issue.get("body") or "")[:BODY_TRUNC],
            "answers": [{"id": c["id"], "user": c["user"]["login"],
                         "author_association": c.get("author_association", ""),
                         "created_at": c["created_at"],
                         "acknowledged": acked(author, comments, c),
                         "body": c["body"][:ANSWER_TRUNC]} for c in answers],
        })
        if (k + 1) % 100 == 0:
            print(f"  코멘트 {k + 1}/{len(pool)}…")

    with open(os.path.join(BASE, "candidates2.jsonl"), "w") as f:
        for c in candidates:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"기계 필터 최종: 통과 {len(candidates)} / 답변 후보 없음 {dropped}")


if __name__ == "__main__":
    main()
