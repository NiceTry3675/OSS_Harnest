#!/usr/bin/env python3
"""멀티홉 실측 01 — 무문서 프로브 비교 러너 (PROTOCOL.md).

사용:
  LLM_PROVIDER=mock python3 probe.py                     # 드라이런(비용 0)
  GOOGLE_APPLICATION_CREDENTIALS=... VERTEX_PROJECT=... python3 probe.py

- responder·grader 프롬프트는 delta-01 harness.py §4 v1을 그대로 복사해 동결.
- 모든 LLM 호출은 runs/cache/에 해시 키로 캐시 — 중단·재개 안전.
"""

import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.dirname(os.path.abspath(__file__))
DELTA = os.path.join(BASE, "..", "delta-01")
RUNS = os.path.join(BASE, "runs")
CACHE = os.path.join(RUNS, "cache")
sys.path.insert(0, DELTA)  # vertex_auth 재사용(읽기 전용 import)

MODEL = os.environ.get("MODEL", "gemini-3.7-flash")
PROVIDER = os.environ.get("LLM_PROVIDER", "vertex")
N_CASES = 15

# ── 동결 평가자 프롬프트 — delta-01 harness.py §4 v1 사본 ─────────────────
P_RESPONDER = """You are answering a user question about the open-source project "Hermes Agent" (NousResearch/hermes-agent).
{doc_block}Answer the question concisely and concretely. If the provided document does not contain the information needed, say so and give your best guess.

## Question
{question}"""

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

# ── 생성 프롬프트 (동결 — PROTOCOL.md 조건 정의) ─────────────────────────
P_DRAFT_A = """You are drafting evaluation cases for an onboarding FAQ about the open-source project "Hermes Agent".
Source material: real Q&A logs from the project's issue tracker (below).
Draft exactly {n} cases. Each case is a question a future user might plausibly ask, plus a reference answer.
The reference answer must be fully grounded in the material — do not invent facts.
Reply with JSON only: [{{"question": "...", "answer": "..."}}, ...]

## Q&A logs
{material}"""

P_DRAFT_B = """You are drafting evaluation cases for an onboarding FAQ about the open-source project "Hermes Agent".
Source material: real Q&A logs from the project's issue tracker (below).
Draft exactly {n} cases. Each case is a question a future user might plausibly ask, plus a reference answer.
The reference answer must be fully grounded in the material — do not invent facts.
HARD REQUIREMENT: each question must be answerable ONLY by combining at least two distinct facts that appear in DIFFERENT issues of the material. A question answerable from a single issue alone is invalid.
For each case, also include "evidence": two verbatim quotes (exact substrings copied from the material, each 30-200 characters) from the two different issues the answer draws on.
Reply with JSON only: [{{"question": "...", "answer": "...", "evidence": ["...", "..."]}}, ...]

## Q&A logs
{material}"""

# 개정 1 (PROTOCOL.md): 복합 질문 실패 모드를 막는 진짜 종합 요구
P_DRAFT_C = """You are drafting evaluation cases for an onboarding FAQ about the open-source project "Hermes Agent".
Source material: real Q&A logs from the project's issue tracker (below).
Draft exactly {n} cases. Each case is a question a future user might plausibly ask, plus a reference answer.
The reference answer must be fully grounded in the material — do not invent facts.
HARD REQUIREMENTS:
- Each case must be ONE question with ONE short factual answer (1-3 sentences). Compound questions that join two independent questions with "and" are INVALID.
- Deriving the answer must REQUIRE combining two distinct facts that appear in DIFFERENT issues of the material. If either fact alone suffices to answer, the case is INVALID.
For each case, also include "evidence": two verbatim quotes (exact substrings copied from the material, each 30-200 characters) from the two different issues the answer draws on.
Reply with JSON only: [{{"question": "...", "answer": "...", "evidence": ["...", "..."]}}, ...]

## Q&A logs
{material}"""


# ── LLM 어댑터 — delta-01 harness와 같은 방식, 캐시만 이 실험 소유 ─────────
def _cache_key(prompt, temp):
    return hashlib.sha256(f"{PROVIDER}|{MODEL}|{temp}|{prompt}".encode()).hexdigest()[:32]


def llm(prompt, tag="", temp=0.7):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, _cache_key(prompt, temp) + ".json")
    if os.path.exists(path):
        return json.load(open(path))["text"]
    if PROVIDER == "mock":
        text = f"[mock:{tag}] " + hashlib.sha256(prompt.encode()).hexdigest()[:8]
        if "Reply with JSON only" in prompt and '"score"' in prompt:
            text = '{"score": 0.5, "why": "mock"}'
        elif "Reply with JSON only" in prompt:
            text = json.dumps([{"question": f"q{i}", "answer": f"a{i}",
                                "evidence": ["e1", "e2"]} for i in range(N_CASES)])
        json.dump({"text": text, "tag": tag, "model": MODEL}, open(path, "w"))
        return text
    body = json.dumps({"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                       "generationConfig": {"temperature": temp, "maxOutputTokens": 16384}}).encode()
    if PROVIDER == "vertex":
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
        except Exception:
            if attempt == 4:
                raise
            time.sleep(6 * (attempt + 1))
    json.dump({"text": text, "tag": tag, "model": MODEL}, open(path, "w"))
    return text


# ── 원료 — delta-01 cases2.json 가시 세트, material_of와 같은 형식 ─────────
def load_material():
    data = json.load(open(os.path.join(DELTA, "cases2.json")))
    by_id = {c["id"]: c for c in data["cases"]}
    visible = [by_id[i] for i in data["meta"]["visible"]]
    return "\n\n".join(f"### Q ({c['id']}): {c['title']}\n{c['question']}\n\n"
                       f"### A:\n{c['answer']}" for c in visible)


def parse_cases(raw, arm):
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.S)
    start, end = text.find("["), text.rfind("]")
    items = json.loads(text[start:end + 1])
    out = []
    for i, it in enumerate(items):
        case = {"id": f"{arm}-{i + 1}", "question": it["question"].strip(),
                "answer": it["answer"].strip()}
        if "evidence" in it:
            case["evidence"] = [e.strip() for e in it["evidence"]]
        out.append(case)
    return out


# ── 근거 실존 검증 (B만, 로컬·모델 호출 없음) ─────────────────────────────
def _norm(s):
    return re.sub(r"\s+", " ", s).strip().lower()


def evidence_check(case, material):
    norm_mat = _norm(material)
    # 섹션 경계: 정규화 후에도 헤더 문자열로 위치를 잡는다
    headers = [(m.start(), m.group(1)) for m in
               re.finditer(r"### q \((case-\d+)\)", norm_mat)]

    def section_of(pos):
        sec = None
        for start, cid in headers:
            if start <= pos:
                sec = cid
            else:
                break
        return sec

    found, sections = [], []
    for quote in case.get("evidence", [])[:2]:
        pos = norm_mat.find(_norm(quote))
        found.append(pos >= 0)
        sections.append(section_of(pos) if pos >= 0 else None)
    both_found = len(found) == 2 and all(found)
    distinct = both_found and sections[0] is not None and sections[0] != sections[1]
    return {"both_found": both_found, "distinct_issues": distinct, "sections": sections}


# ── 무문서 프로브 — delta-01 grade_case(doc=None)와 동일한 절차 ────────────
def probe_case(case):
    resp = llm(P_RESPONDER.format(doc_block="", question=case["question"]),
               tag=f"resp:{case['id']}", temp=0.0)
    raw = llm(P_GRADER.format(question=case["question"], gt=case["answer"], resp=resp),
              tag=f"grade:{case['id']}", temp=0.0)
    m = re.search(r'"score"\s*:\s*(1(?:\.0)?|0\.5|0(?:\.0)?)', raw)
    score = float(m.group(1)) if m else 0.0
    why = (re.search(r'"why"\s*:\s*"([^"]*)"', raw) or [None, ""])[1]
    return score, why, resp


def main():
    material = load_material()
    print(f"원료 {len(material)}자 / {PROVIDER}:{MODEL} / {N_CASES}케이스 × 3 arm")

    arms = {}
    for arm, prompt in (("A", P_DRAFT_A), ("B", P_DRAFT_B), ("C", P_DRAFT_C)):
        raw = llm(prompt.format(n=N_CASES, material=material), tag=f"draft:{arm}", temp=0.7)
        arms[arm] = parse_cases(raw, arm)
        print(f"arm {arm}: {len(arms[arm])}케이스 생성")

    os.makedirs(RUNS, exist_ok=True)
    summary = {}
    for arm, cases in arms.items():
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(probe_case, cases))
        traces = []
        for c, (score, why, resp) in zip(cases, results):
            t = {"id": c["id"], "question": c["question"], "answer": c["answer"],
                 "nodoc_score": score, "why": why, "response": resp}
            if arm in ("B", "C"):
                t["evidence"] = c.get("evidence", [])
                t["evidence_check"] = evidence_check(c, material)
            traces.append(t)
        scores = [t["nodoc_score"] for t in traces]
        stat = {
            "n": len(scores),
            "nodoc_mean": round(sum(scores) / len(scores), 3),
            "nodoc_full_rate": round(sum(1 for s in scores if s == 1.0) / len(scores), 3),
            "nodoc_zero_rate": round(sum(1 for s in scores if s == 0.0) / len(scores), 3),
        }
        if arm in ("B", "C"):
            checks = [t["evidence_check"] for t in traces]
            stat["evidence_both_found_rate"] = round(
                sum(1 for e in checks if e["both_found"]) / len(checks), 3)
            stat["evidence_distinct_rate"] = round(
                sum(1 for e in checks if e["distinct_issues"]) / len(checks), 3)
        summary[arm] = stat
        json.dump({"stat": stat, "cases": traces},
                  open(os.path.join(RUNS, f"arm_{arm}.json"), "w"),
                  ensure_ascii=False, indent=1)
        print(f"arm {arm}: 무문서 평균 {stat['nodoc_mean']:.2f} / "
              f"만점 {stat['nodoc_full_rate']:.0%} / 0점 {stat['nodoc_zero_rate']:.0%}"
              + (f" / 근거 실존 {stat['evidence_both_found_rate']:.0%}"
                 f" / 서로 다른 이슈 {stat['evidence_distinct_rate']:.0%}"
                 if arm in ("B", "C") else ""))

    for arm in ("B", "C"):
        if arm not in summary:
            continue
        delta = summary["A"]["nodoc_mean"] - summary[arm]["nodoc_mean"]
        verdict = "효과 있음" if delta >= 0.1 else "효과 불충분"
        summary[f"delta_A_minus_{arm}"] = round(delta, 3)
        summary[f"verdict_{arm}"] = verdict
        print(f"Δ(A−{arm}) = {delta:+.2f} → {verdict} (기준: ≥0.10)")
    json.dump(summary, open(os.path.join(RUNS, "summary.json"), "w"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
