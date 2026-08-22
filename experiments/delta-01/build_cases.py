#!/usr/bin/env python3
"""델타 실측 01 — 케이스 확정 (PROTOCOL.md §2.4·§2.5).

CURATION.md의 keep/answer_pick을 파싱해 raw/ 캐시에서 질문·정답 **전문**을 꺼내
cases.json을 만든다 (candidates.jsonl은 큐레이션용 절단본이라 쓰지 않는다).

시간 분할: created_at 오름차순, 앞 2/3 가시(상한 25), 나머지 홀드아웃.
"""

import glob
import json
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(BASE, "raw")
VISIBLE_CAP = 25

SWEEPER_MARK = re.compile(r"<!--\s*hermes-sweeper.*?-->", re.S)
HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)


def load_issues():
    issues = {}
    for path in sorted(glob.glob(os.path.join(RAW, "issues_p*.json"))):
        for i in json.load(open(path)):
            if "pull_request" not in i:
                issues[i["number"]] = i
    return issues


def parse_curation():
    """CURATION.md 표 → {number: (keep, answer_pick, weak)}"""
    rows = {}
    for line in open(os.path.join(BASE, "CURATION.md")):
        m = re.match(r"\|\s*(\d+)\s*\|\s*(keep[^|]*|drop)\s*\|\s*([^|]*)\|", line)
        if not m:
            continue
        num, verdict, pick = int(m.group(1)), m.group(2).strip(), m.group(3).strip()
        rows[num] = (verdict.startswith("keep"), None if pick in ("—", "") else pick,
                     "약" in verdict)
    return rows


def pick_answer(comments, issue, pick):
    author = issue["user"]["login"]
    subst = [c for c in comments
             if c["user"]["login"] != author
             and not c["user"]["login"].endswith("[bot]")
             and len(c.get("body") or "") >= 200]
    if not subst:
        return None
    if pick:
        first_user = pick.split("+")[0].strip()
        for c in subst:
            if c["user"]["login"] == first_user:
                return c
    return subst[-1]


def clean(text):
    text = SWEEPER_MARK.sub("", text)
    text = HTML_COMMENT.sub("", text)
    return text.strip()


def main():
    issues = load_issues()
    curation = parse_curation()
    cases = []
    for num, (keep, pick, weak) in sorted(curation.items()):
        if not keep:
            continue
        issue = issues[num]
        comments = json.load(open(os.path.join(RAW, f"comments_{num}.json")))
        ans = pick_answer(comments, issue, pick)
        if ans is None:
            print(f"  ! #{num}: 정답 코멘트 미발견 — 제외")
            continue
        is_sweeper = "hermes-sweeper" in (ans.get("body") or "")
        cases.append({
            "id": f"case-{num}",
            "number": num,
            "title": issue["title"],
            "created_at": issue["created_at"],
            "question": (issue.get("body") or "").strip(),
            "answer": clean(ans["body"]),
            "answer_user": ans["user"]["login"],
            "answer_source": "sweeper" if is_sweeper else "human",
            "weak": weak,
        })

    cases.sort(key=lambda c: c["created_at"])
    n_visible = min(VISIBLE_CAP, (len(cases) * 2) // 3)
    out = {
        "meta": {
            "repo": "NousResearch/hermes-agent",
            "protocol": "PROTOCOL.md",
            "split_rule": f"created_at 오름차순, 앞 {n_visible}건 가시 / 뒤 {len(cases) - n_visible}건 홀드아웃",
            "visible": [c["id"] for c in cases[:n_visible]],
            "holdout": [c["id"] for c in cases[n_visible:]],
        },
        "cases": cases,
    }
    path = os.path.join(BASE, "cases.json")
    with open(path, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    q_toks = sum(len(c["question"]) + len(c["answer"]) for c in cases[:n_visible])
    print(f"cases.json: 총 {len(cases)}건 = 가시 {n_visible} + 홀드아웃 {len(cases) - n_visible}")
    print(f"가시 원료 크기: ~{q_toks // 1024}KB (분량 게이트 환산 기준)")
    print(f"출처: sweeper {sum(1 for c in cases if c['answer_source']=='sweeper')} / "
          f"human {sum(1 for c in cases if c['answer_source']=='human')}")


if __name__ == "__main__":
    main()
