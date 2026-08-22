#!/usr/bin/env python3
"""델타 실측 01 — 동결 평가자 + 비교 조건 러너 (PROTOCOL.md §4~§7).

사용:
  LLM_PROVIDER=mock  python3 harness.py --cond 0        # 드라이런(비용 0, 파이프라인 검증)
  GOOGLE_API_KEY=... python3 harness.py --cond 0        # 무문서 프로브 (저장소 적합성 게이트)
  GOOGLE_API_KEY=... python3 harness.py --cond all      # ①~④ 전체 (본 실행)
  python3 harness.py --report                            # runs/ 결과로 report.md 생성

- 모든 LLM 호출은 runs/cache/에 해시 키로 캐시 — 중단·재개 안전, 같은 입력 재과금 없음.
- 홀드아웃 불변식(§6): 홀드아웃 채점은 조건 종료 후 최종 문서에만 수행. 루프(③)의
  채택·트레이스는 가시 케이스만 사용한다.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(BASE, os.environ.get("RUNS_DIR", "runs"))   # 델타 02: runs2
CACHE = os.path.join(BASE, "runs", "cache")                     # 캐시는 실측 간 공유(동일 호출 재과금 방지)

MODEL = os.environ.get("MODEL", "gemini-3.7-flash")   # 체험 티어 구성 (§7)
PROVIDER = os.environ.get("LLM_PROVIDER", "gemini")
ROUNDS = 10                                            # 생성 예산 (§5)
LENGTH_CAP_RATIO = 0.15                                # 분량 게이트 (§3)

# ── 동결 프롬프트 (§4 — 버전 v1, 채점 실행 후 변경 금지) ─────────────────
P_RESPONDER = """You are answering a user question about the open-source project "Hermes Agent" (NousResearch/hermes-agent).
{doc_block}Answer the question concisely and concretely. If the provided document does not contain the information needed, say so and give your best guess.

## Question
{question}"""

P_DOC_BLOCK = """You may ONLY use the following onboarding document as your knowledge source.

## Onboarding document
{doc}

"""

P_GRADER = """You are grading whether a response captures the essential content of a reference answer.

## Question
{question}

## Reference answer (ground truth)
{gt}

## Response to grade
{resp}

Score strictly:
- 1.0 — response conveys the key facts/solution of the reference answer
- 0.5 — partially correct: right direction but missing a key element or adding a wrong claim
- 0.0 — wrong, irrelevant, or "I don't know"

Reply with JSON only: {{"score": 0 | 0.5 | 1, "why": "<one sentence>"}}"""

P_LIMIT = ("HARD LIMIT: {cap} characters — any document over this is DISQUALIFIED (score 0). "
           "Character counts are hard to judge, so target about {target} characters "
           "(roughly {words} words) to stay safely under the limit.")

P_ONESHOT = """You are writing an onboarding FAQ document for new users of the open-source project "Hermes Agent".
Source material: real Q&A logs from the project's issue tracker (below).
Write ONE self-contained document (markdown) that lets a reader answer as many future user questions as possible WITHOUT access to these logs.
{limit}

## Q&A logs
{material}"""

P_ITERATE = """Below is an onboarding FAQ document for "Hermes Agent", plus the Q&A logs it was built from.
Improve the document. Keep it self-contained.
{limit}

## Q&A logs
{material}

## Current document
{doc}

Output the full improved document only."""

P_MUTATE = """Below is an onboarding FAQ document for "Hermes Agent", the Q&A logs it was built from, and a per-case error report from a frozen evaluator (a responder answered each logged question using ONLY the document; failures are listed).
Revise the document to fix the reported failures without breaking what already works. Trade-offs are real: the length limit means adding coverage may require compressing elsewhere.
{limit}

## Q&A logs
{material}

## Current document (visible-case score: {score:.1f}/100)
{doc}

## Error report (visible cases only)
{traces}

Output the full revised document only."""


P_RETRY = """Your previous attempt at the onboarding FAQ document for "Hermes Agent" was DISQUALIFIED by the evaluator:
document length {n} characters exceeds the HARD LIMIT of {cap} characters (score 0). No other feedback is available.
Rewrite the document to comply.
{limit}

## Q&A logs
{material}

## Your previous (disqualified) document
{doc}

Output the full rewritten document only."""

P_MUTATE_SCORE = """Below is an onboarding FAQ document for "Hermes Agent", plus the Q&A logs it was built from.
A frozen evaluator scored it {score:.1f}/100 on how well a reader could answer real user questions using ONLY the document. No further detail about the failures is available.
Revise the document to improve that score. Trade-offs are real: the length limit means adding coverage may require compressing elsewhere.
{limit}

## Q&A logs
{material}

## Current document (score: {score:.1f}/100)
{doc}

Output the full revised document only."""


def limit_block(cap):
    return P_LIMIT.format(cap=cap, target=int(cap * 0.8), words=int(cap * 0.8 / 6.5))


# ── LLM 어댑터 ───────────────────────────────────────────────────────────
# 디코딩 동결(§4): 평가자(responder·grader) temp 0.0 / 생성(원샷·변이 등) temp 0.7
def _cache_key(prompt, temp):
    return hashlib.sha256(f"{PROVIDER}|{MODEL}|{temp}|{prompt}".encode()).hexdigest()[:32]


def llm(prompt, tag="", temp=0.7):
    os.makedirs(CACHE, exist_ok=True)
    key = _cache_key(prompt, temp)
    path = os.path.join(CACHE, key + ".json")
    if os.path.exists(path):
        return json.load(open(path))["text"]
    if PROVIDER == "mock":
        text = f"[mock:{tag}] " + hashlib.sha256(prompt.encode()).hexdigest()[:8]
        if "Reply with JSON only" in prompt:
            text = '{"score": 0.5, "why": "mock"}'
        json.dump({"text": text, "tag": tag, "model": MODEL}, open(path, "w"))
        return text
    body = json.dumps({"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                       "generationConfig": {"temperature": temp, "maxOutputTokens": 8192}}).encode()
    if PROVIDER == "gemini":
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
        headers = {"Content-Type": "application/json",
                   "x-goog-api-key": os.environ["GOOGLE_API_KEY"]}
    elif PROVIDER == "vertex":
        from vertex_auth import get_token
        proj = os.environ["VERTEX_PROJECT"]
        loc = os.environ.get("VERTEX_LOCATION", "global")
        host = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
        url = (f"https://{host}/v1/projects/{proj}/locations/{loc}"
               f"/publishers/google/models/{MODEL}:generateContent")
        headers = {"Content-Type": "application/json",
                   "Authorization": f"Bearer {get_token()}"}
    else:
        raise SystemExit(f"unknown LLM_PROVIDER={PROVIDER}")
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.load(r)
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            break
        except Exception as e:
            if attempt == 4:
                raise
            time.sleep(6 * (attempt + 1))
    json.dump({"text": text, "tag": tag, "model": MODEL}, open(path, "w"))
    return text


# ── 동결 평가자 (§4) ─────────────────────────────────────────────────────
def grade_case(doc, case):
    doc_block = P_DOC_BLOCK.format(doc=doc) if doc is not None else ""
    resp = llm(P_RESPONDER.format(doc_block=doc_block, question=case["question"]),
               tag=f"resp:{case['id']}", temp=0.0)
    raw = llm(P_GRADER.format(question=case["question"], gt=case["answer"], resp=resp),
              tag=f"grade:{case['id']}", temp=0.0)
    m = re.search(r'"score"\s*:\s*(1(?:\.0)?|0\.5|0(?:\.0)?)', raw)
    score = float(m.group(1)) if m else 0.0
    why = (re.search(r'"why"\s*:\s*"([^"]*)"', raw) or [None, ""])[1]
    return score, why, resp


def _grade_all(doc, cases):
    """케이스 병렬 채점 — 케이스 순서 보존."""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as ex:
        return list(ex.map(lambda c: grade_case(doc, c), cases))


def evaluate(doc, cases, cap=None):
    """(평균 점수 0~100, 케이스 트레이스, gate 위반)"""
    if cap is not None and doc is not None and len(doc) > cap:
        return 0.0, [f"HARD GATE 실패: 분량 {len(doc)} > {cap}자 — 실격"], True
    results = _grade_all(doc, cases)
    scores, traces = [], []
    for c, (s, why, _) in zip(cases, results):
        scores.append(s)
        if s < 1.0:
            traces.append(f"{c['id']} ({c['title'][:60]}): {'부분 정답' if s == 0.5 else '오답'} — {why}")
    return sum(scores) / len(scores) * 100, traces, False


def ngram_overlap(doc, cases, n=13):
    """암기 검사(§4): 가시 정답과 문서 간 13-gram(단어) 중복률 최대값."""
    def grams(t):
        w = re.findall(r"\w+", t.lower())
        return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}
    d = grams(doc)
    worst = 0.0
    for c in cases:
        g = grams(c["answer"])
        if g:
            worst = max(worst, len(d & g) / len(g))
    return worst


# ── 비교 조건 (§5) ───────────────────────────────────────────────────────
def material_of(visible):
    return "\n\n".join(f"### Q ({c['id']}): {c['title']}\n{c['question']}\n\n"
                       f"### A:\n{c['answer']}" for c in visible)


def save(name, obj):
    os.makedirs(RUNS, exist_ok=True)
    json.dump(obj, open(os.path.join(RUNS, f"{name}.json"), "w"),
              ensure_ascii=False, indent=1)
    print(f"→ runs/{name}.json")


def run_probe(visible, holdout):
    cases = visible + holdout
    results = _grade_all(None, cases)
    scores = [s for s, _, _ in results]
    traces = [{"id": c["id"], "score": s, "why": why}
              for c, (s, why, _) in zip(cases, results)]
    rate = sum(scores) / len(scores) * 100
    verdict = "통과" if rate < 30 else ("주의" if rate <= 50 else "부적합-중단")
    save("cond0_probe", {"contamination_rate": rate, "verdict": verdict, "cases": traces})
    print(f"⓪ 무문서 정답률 {rate:.1f} → {verdict} (게이트: <30 통과 / 30~50 주의 / >50 중단)")
    return verdict


def run_oneshot(material, cap, visible):
    doc = llm(P_ONESHOT.format(limit=limit_block(cap), material=material), tag="oneshot")
    vis, traces, gate = evaluate(doc, visible, cap)
    save("cond1_oneshot", {"doc": doc, "visible": vis, "gate_violation": gate, "traces": traces})
    return doc


def run_iterate(material, cap, visible):
    doc = llm(P_ONESHOT.format(limit=limit_block(cap), material=material), tag="iter0")
    for i in range(1, ROUNDS):
        doc = llm(P_ITERATE.format(limit=limit_block(cap), material=material, doc=doc), tag=f"iter{i}")
    vis, traces, gate = evaluate(doc, visible, cap)
    save("cond2_iterate", {"doc": doc, "visible": vis, "gate_violation": gate})
    return doc


def run_harnest(material, cap, visible):
    champ = llm(P_ONESHOT.format(limit=limit_block(cap), material=material), tag="h0")
    champ_score, champ_traces, _ = evaluate(champ, visible, cap)
    curve = [champ_score]
    for i in range(1, ROUNDS):
        # 라운드 논스: 챔피언 불변 구간에서 동일 프롬프트→캐시 히트로 탐색이 붕괴하는
        # 결함(§9.3, 2026-08-22 발견)의 수정 — temp 0.7 샘플링이 실제로 일어나게 한다.
        cand = llm(P_MUTATE.format(limit=limit_block(cap), material=material, doc=champ,
                                   score=champ_score, traces="\n".join(champ_traces) or "(전 케이스 정답)")
                   + f"\n<!-- round {i} -->",
                   tag=f"h{i}")
        s, traces, gate = evaluate(cand, visible, cap)
        if not gate and s > champ_score:            # 제3 채택 모드: 엄격 개선 시 채택
            champ, champ_score, champ_traces = cand, s, traces
        curve.append(champ_score)
    save("cond3_harnest", {"doc": champ, "visible": champ_score, "curve": curve})
    return champ


def run_retry(material, cap, visible):
    """⑤ 실격 재시도 (§9.2): 실격 사실+길이만 통지, 준수 문서가 나오면 정지."""
    doc = llm(P_ONESHOT.format(limit=limit_block(cap), material=material), tag="oneshot")
    used = 1
    while len(doc) > cap and used < ROUNDS:
        doc = llm(P_RETRY.format(n=len(doc), cap=cap, limit=limit_block(cap),
                                 material=material, doc=doc), tag=f"r{used}")
        used += 1
    vis, traces, gate = evaluate(doc, visible, cap)
    save("cond5_retry", {"doc": doc, "visible": vis, "gate_violation": gate,
                         "rounds_used": used})
    return doc


def run_scoreloop(material, cap, visible):
    """⑥ 점수-온리 루프 (§9.2): 스칼라 점수만 피드백, 채택 규칙은 ③과 동일."""
    champ = llm(P_ONESHOT.format(limit=limit_block(cap), material=material), tag="oneshot")
    champ_score, _, _ = evaluate(champ, visible, cap)
    curve = [champ_score]
    for i in range(1, ROUNDS):
        cand = llm(P_MUTATE_SCORE.format(limit=limit_block(cap), material=material,
                                         doc=champ, score=champ_score)
                   + f"\n<!-- round {i} -->", tag=f"s{i}")
        s, _, gate = evaluate(cand, visible, cap)
        if not gate and s > champ_score:
            champ, champ_score = cand, s
        curve.append(champ_score)
    save("cond6_scoreloop", {"doc": champ, "visible": champ_score, "curve": curve})
    return champ


def run_bestof(material, cap, visible):
    best, best_score = None, -1
    for i in range(ROUNDS):
        doc = llm(P_ONESHOT.format(limit=limit_block(cap), material=material) + f"\n\n<!-- sample {i} -->",
                  tag=f"bo{i}")
        s, _, gate = evaluate(doc, visible, cap)
        if not gate and s > best_score:
            best, best_score = doc, s
    save("cond4_bestof", {"doc": best, "visible": best_score})
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cond", default=None, help="0|1|2|3|4|all")
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    data = json.load(open(os.path.join(BASE, os.environ.get("CASES_FILE", "cases.json"))))
    cases = {c["id"]: c for c in data["cases"]}
    visible = [cases[i] for i in data["meta"]["visible"]]
    holdout = [cases[i] for i in data["meta"]["holdout"]]
    material = material_of(visible)
    # 분량 게이트: LENGTH_CAP(절대값, §9 개정 4) 우선, 없으면 상대 15%(델타 01)
    cap = int(os.environ.get("LENGTH_CAP", len(material) * LENGTH_CAP_RATIO))
    print(f"가시 {len(visible)} / 홀드아웃 {len(holdout)} / 원료 {len(material)}자 / 분량 게이트 {cap}자 / {PROVIDER}:{MODEL}")

    if args.report:
        report(visible, holdout, cap)
        return
    if args.cond in ("0", "all"):
        verdict = run_probe(visible, holdout)
        if verdict == "부적합-중단" and args.cond == "all":
            sys.exit("프로브 게이트 실패 — 중단 (PROTOCOL §5, 폴백 없음)")
    runners = {"1": run_oneshot, "2": run_iterate, "3": run_harnest, "4": run_bestof,
               "5": run_retry, "6": run_scoreloop}
    finals = {}
    for k, fn in runners.items():
        if args.cond in (k, "all"):
            print(f"조건 {k} 실행…")
            finals[k] = fn(material, cap, visible)
    # 홀드아웃 채점: 종료 시에만 (§6)
    for k, doc in finals.items():
        if doc is None:
            continue
        h, _, _ = evaluate(doc, holdout, cap)
        mem = ngram_overlap(doc, visible)
        fname = {"1": "oneshot", "2": "iterate", "3": "harnest", "4": "bestof",
                 "5": "retry", "6": "scoreloop"}[k]
        path = os.path.join(RUNS, f"cond{k}_{fname}.json")
        obj = json.load(open(path))
        obj["holdout"], obj["memorization_13gram"] = h, mem
        json.dump(obj, open(path, "w"), ensure_ascii=False, indent=1)
        print(f"조건 {k}: 홀드아웃 {h:.1f} / 암기 {mem:.2f}")


def report(visible, holdout, cap):
    rows, names = [], {"0": "무문서 프로브", "1": "원샷", "2": "반복 첨삭", "3": "Harnest 루프",
                       "4": "best-of-10", "5": "실격 재시도", "6": "점수-온리 루프"}
    for k in "0123456":
        for f in os.listdir(RUNS) if os.path.isdir(RUNS) else []:
            if f.startswith(f"cond{k}") and f.endswith(".json"):
                d = json.load(open(os.path.join(RUNS, f)))
                rows.append((k, names[k], d))
    lines = ["# 델타 실측 01 — 결과", "",
             f"- 케이스: 가시 {len(visible)} / 홀드아웃 {len(holdout)}, 분량 게이트 {cap}자, 모델 {MODEL}",
             "", "| 조건 | 가시 | 홀드아웃 | 암기(13g) |", "|---|---|---|---|"]
    for k, name, d in rows:
        if k == "0":
            lines.append(f"| ⓪ {name} | — | 전체 {d['contamination_rate']:.1f} ({d['verdict']}) | — |")
        else:
            lines.append(f"| {name} | {d.get('visible', 0):.1f} | {d.get('holdout', '—')} | {d.get('memorization_13gram', '—')} |")
    c3 = next((d for k, _, d in rows if k == "3"), None)
    if c3 and "curve" in c3:
        lines += ["", "개선 곡선(③ 가시): " + " → ".join(f"{s:.0f}" for s in c3["curve"])]
    open(os.path.join(BASE, "report.md"), "w").write("\n".join(lines) + "\n")
    print("→ report.md")


if __name__ == "__main__":
    main()
