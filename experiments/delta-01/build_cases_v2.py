#!/usr/bin/env python3
"""델타 실측 02 — 반복성 보존 분할 (PROTOCOL.md §9 개정 3·5).

CURATION2.md의 keep/answer_pick/cluster를 파싱해 cases2.json을 만든다.
델타 01과의 차이:
- 시간 분할을 먼저 하고, 동근원 병합(dedup)은 **가시 세트 내부에만** 적용.
  홀드아웃 시대의 반복 질문은 보존한다 — 그것이 측정 대상이다.
- probe_drops2.json이 있으면 적용(§5 재산정 1회).
"""

import json
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
RAW2 = os.path.join(BASE, "raw2")
VISIBLE_CAP = 45

SWEEPER_MARK = re.compile(r"<!--\s*hermes-sweeper.*?-->", re.S)
HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)


def parse_curation():
    """CURATION2.md 표 → {number: (keep, answer_pick, weak, cluster)}
    표 형식: | 번호 | 판정 | answer_pick | cluster | 사유 |  (cluster 없으면 '—')"""
    rows = {}
    for line in open(os.path.join(BASE, "CURATION2.md")):
        m = re.match(r"\|\s*(\d+)\s*\|\s*(keep[^|]*|drop)\s*\|\s*([^|]*)\|\s*([^|]*)\|", line)
        if not m:
            continue
        num = int(m.group(1))
        verdict, pick, cluster = m.group(2).strip(), m.group(3).strip(), m.group(4).strip()
        rows[num] = (verdict.startswith("keep"),
                     None if pick in ("—", "") else pick,
                     "약" in verdict,
                     None if cluster in ("—", "") else cluster)
    return rows


def load_candidates():
    return {c["number"]: c for c in
            (json.loads(l) for l in open(os.path.join(BASE, "candidates2.jsonl")))}


def pick_answer(cand, pick):
    answers = cand["answers"]
    if pick:
        first = pick.split("+")[0].strip()
        for a in answers:
            if a["user"] == first:
                return a
    return answers[-1]


def clean(text):
    return HTML_COMMENT.sub("", SWEEPER_MARK.sub("", text)).strip()


def main():
    curation = parse_curation()
    cands = load_candidates()
    cases = []
    for num, (keep, pick, weak, cluster) in sorted(curation.items()):
        if not keep:
            continue
        c = cands[num]
        ans = pick_answer(c, pick)
        cases.append({
            "id": f"case-{num}", "number": num, "title": c["title"],
            "created_at": c["created_at"], "question": c["body"].strip(),
            "answer": clean(ans["body"]), "answer_user": ans["user"],
            "answer_source": "sweeper" if "hermes-sweeper" in ans["body"] else "human",
            "weak": weak, "cluster": cluster,
        })

    # 프로브 기반 drop (§5 재산정 1회)
    pd_path = os.path.join(BASE, "probe_drops2.json")
    if os.path.exists(pd_path):
        dropped_ids = set(json.load(open(pd_path))["drops"])
        before = len(cases)
        cases = [c for c in cases if c["id"] not in dropped_ids]
        print(f"프로브 drop 적용: {before} → {len(cases)}")

    # 1) 시간 분할 먼저
    cases.sort(key=lambda c: c["created_at"])
    n_visible_raw = min(VISIBLE_CAP, (len(cases) * 2) // 3)
    visible, holdout = cases[:n_visible_raw], cases[n_visible_raw:]

    # 2) dedup은 가시 내부에만 — 클러스터당 최선 1건(비약 우선, 동률이면 이른 것)
    kept, merged = [], []
    seen_cluster = {}
    for c in visible:
        cl = c["cluster"]
        if cl is None:
            kept.append(c)
            continue
        if cl not in seen_cluster:
            seen_cluster[cl] = c
            kept.append(c)
        else:
            prev = seen_cluster[cl]
            if prev["weak"] and not c["weak"]:
                kept[kept.index(prev)] = c
                merged.append(prev["id"])
                seen_cluster[cl] = c
            else:
                merged.append(c["id"])
    visible = kept

    out = {
        "meta": {
            "repo": "NousResearch/hermes-agent", "protocol": "PROTOCOL.md §9 (델타 02)",
            "split_rule": "시간 분할 선행 → 가시 내부만 클러스터 병합, 홀드아웃 반복 보존",
            "visible_dedup_merged": merged,
            "visible": [c["id"] for c in visible],
            "holdout": [c["id"] for c in holdout],
        },
        "cases": visible + holdout,
    }
    json.dump(out, open(os.path.join(BASE, "cases2.json"), "w"), ensure_ascii=False, indent=1)
    mat = sum(len(c["question"]) + len(c["answer"]) for c in visible)
    rep = sum(1 for h in holdout if h["cluster"] and h["cluster"] in
              {v["cluster"] for v in visible if v["cluster"]})
    print(f"cases2.json: 가시 {len(visible)} (병합 {len(merged)}) + 홀드아웃 {len(holdout)}"
          f" (그중 가시 주제 반복 {rep}건)")
    print(f"가시 원료: ~{mat // 1024}KB / 절대 게이트 5,000자 대비 비율 {5000 / max(mat,1) * 100:.1f}%")


if __name__ == "__main__":
    main()
