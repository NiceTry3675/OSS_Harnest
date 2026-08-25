/** 정식 내보내기·저장 봉투의 digest·승인 증거·실행 결과 결속 회귀 테스트. */

import { describe, expect, it } from "vitest";
import { sha256Canonical } from "./digest";
import type { ExaminerReport } from "./examiner";
import type { LoopCheckpoint } from "./loop";
import { digestScope, type EvaluationPack } from "./pack";
import {
  createProjectExportEnvelope,
  PROJECT_EXPORT_KIND,
  PROJECT_EXPORT_VERSION,
  ProjectExportContractError,
  projectExportIssues,
  type HoldoutRecord,
  type ProjectExportEnvelope,
  type ProjectExportInput,
} from "./storage";

const now = "2026-08-24T12:00:00.000Z";

async function makePack(kind: "deterministic" | "llm"): Promise<EvaluationPack> {
  const base: Omit<EvaluationPack, "definitionDigest"> = {
    packVersion: "skeleton-1",
    templateId: kind === "llm" ? "handover" : "timetable",
    criteria: [],
    gates: [],
    judgeProcedure:
      kind === "llm"
        ? {
            kind: "case_answering",
            judge: { provider: "mock", model: "모의 모델" },
            pairwiseNotice: "미적용",
          }
        : {
            kind: "deterministic_only",
            exemptions: { examinerReport: "면제", pairwise: "면제" },
          },
    holdoutPolicy:
      kind === "llm"
        ? {
            mode: "seeded_split",
            note: "시드 분할",
            guardCaseIds: ["case-3"],
            holdoutCaseIds: ["case-4"],
            guardTolerance: 4.2,
          }
        : { mode: "none", note: "없음" },
  };
  return { ...base, definitionDigest: await sha256Canonical(digestScope(base)) };
}

function checkpoint(pack: EvaluationPack): LoopCheckpoint<string> {
  return {
    runId: "run-1",
    packDigest: pack.definitionDigest,
    status: "done",
    doneReason: "max_rounds",
    round: 1,
    champion: "완료 문서",
    championScore: 80,
    championViolations: [],
    championGuardScore: null,
    curve: [50, 80],
    guardCurve: [null, null],
    tree: [
      {
        round: 1,
        candidateScore: 80,
        championScore: 80,
        adopted: true,
        gateRejected: false,
        violations: [],
        candidateGuardScore: null,
        guardSafe: true,
      },
    ],
    provenance: [],
    rngState: 1,
  };
}

function report(pack: EvaluationPack): ExaminerReport {
  return {
    checks: [
      { id: "stability", verdict: "pass", note: "안정성 통과" },
      { id: "hack_resistance", verdict: "pass", note: "꼼수 내성 통과" },
    ],
    overall: "pass",
    forDigest: pack.definitionDigest,
    judge: { provider: "mock", model: "모의 모델" },
    ranAt: "2026-08-24T11:00:00.000Z",
  };
}

const noHoldout: HoldoutRecord = { mode: "none" };
const scoredHoldout: HoldoutRecord = {
  mode: "measured",
  baseline: {
    status: "scored",
    evaluation: {
      gateRejected: false,
      score: 50,
      perCase: [
        {
          caseId: "case-4",
          question: "숨김 질문",
          score: 0.5,
          why: "부분 정답",
          caseType: "new",
        },
      ],
      violations: [],
    },
  },
  final: {
    status: "failed",
    error: "종료 홀드아웃 모델 호출 실패",
  },
};

const defaultLoopSpec = {
  maxRounds: 1,
  plateauRounds: 1,
  adoptionRule: "scalar_strict" as const,
  seed: 1,
};

function exportInput(
  pack: EvaluationPack,
  holdout: HoldoutRecord,
): ProjectExportInput<string> {
  const examinerReport = pack.judgeProcedure.kind === "deterministic_only" ? null : report(pack);
  return {
    exportedAt: now,
    project: {
      interview: { schemaVersion: "skeleton-1", templateId: pack.templateId, answers: {} },
      evaluation: {
        pack,
        examinerReport,
        approval: { forDigest: pack.definitionDigest, approvedAt: now },
      },
      loopSpec: { ...defaultLoopSpec },
    },
    result: { checkpoint: checkpoint(pack), holdout: structuredClone(holdout) },
  };
}

describe("ProjectExportEnvelope", () => {
  it("결정적 완료 결과를 버전된 봉투로 만들고 JSON 왕복한다", async () => {
    const pack = await makePack("deterministic");
    const envelope = await createProjectExportEnvelope({
      exportedAt: now,
      project: {
        interview: { schemaVersion: "skeleton-1", templateId: pack.templateId, answers: { staff: "가온" } },
        evaluation: {
          pack,
          examinerReport: null,
          approval: { forDigest: pack.definitionDigest, approvedAt: now },
        },
        loopSpec: { maxRounds: 1, plateauRounds: 1, adoptionRule: "scalar_strict", seed: 1 },
      },
      result: { checkpoint: checkpoint(pack), holdout: noHoldout },
    });

    expect(envelope.kind).toBe(PROJECT_EXPORT_KIND);
    expect(envelope.envelopeVersion).toBe(PROJECT_EXPORT_VERSION);
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
    expect(JSON.stringify(envelope)).not.toContain("apiKey");
  });

  it("JSON에서 손실되거나 직렬화 훅으로 바뀌는 값을 부작용 없이 거부한다", async () => {
    const pack = await makePack("deterministic");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const make = (answers: Record<string, unknown>) =>
      createProjectExportEnvelope({
        exportedAt: now,
        project: {
          interview: { schemaVersion: "skeleton-1", templateId: pack.templateId, answers },
          evaluation: {
            pack,
            examinerReport: null,
            approval: { forDigest: pack.definitionDigest, approvedAt: now },
          },
          loopSpec: { maxRounds: 1, plateauRounds: 1, adoptionRule: "scalar_strict", seed: 1 },
        },
        result: { checkpoint: checkpoint(pack), holdout: noHoldout },
      });

    await expect(make({ value: Number.NaN })).rejects.toBeInstanceOf(ProjectExportContractError);
    await expect(make({ value: undefined })).rejects.toBeInstanceOf(ProjectExportContractError);
    await expect(make({ value: "\ud800" })).rejects.toBeInstanceOf(ProjectExportContractError);
    await expect(make({ ["\udc00"]: "잘못된 키" })).rejects.toBeInstanceOf(
      ProjectExportContractError,
    );
    await expect(make(cyclic)).rejects.toBeInstanceOf(ProjectExportContractError);

    const hooked: Record<string, unknown> = {};
    Object.defineProperty(hooked, "toJSON", {
      enumerable: false,
      value: () => ({ apiKey: "직렬화-훅-비밀" }),
    });
    await expect(make({ hooked })).rejects.toBeInstanceOf(ProjectExportContractError);

    let getterReads = 0;
    const accessorAnswers: Record<string, unknown> = {};
    Object.defineProperty(accessorAnswers, "secret", {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return "접근자-비밀";
      },
    });
    await expect(make(accessorAnswers)).rejects.toBeInstanceOf(ProjectExportContractError);
    expect(getterReads).toBe(0);
  });

  it("LLM 승인본은 report·approval·checkpoint를 같은 Pack에 결속한다", async () => {
    const pack = await makePack("llm");
    const examinerReport = report(pack);
    const envelope = await createProjectExportEnvelope({
      exportedAt: now,
      project: {
        interview: { schemaVersion: "skeleton-1", templateId: pack.templateId, answers: { material: "자료" } },
        evaluation: {
          pack,
          examinerReport,
          approval: { forDigest: pack.definitionDigest, approvedAt: now },
        },
        loopSpec: { maxRounds: 1, plateauRounds: 1, adoptionRule: "scalar_strict", seed: 1 },
      },
      result: { checkpoint: checkpoint(pack), holdout: scoredHoldout },
    });

    expect(await projectExportIssues(envelope)).toEqual([]);
  });

  it("시험관 리포트는 두 필수 검사(안정성·꼼수 내성)를 각각 정확히 한 번 포함해야 한다", async () => {
    const pack = await makePack("llm");
    const valid = await createProjectExportEnvelope(exportInput(pack, scoredHoldout));

    const missing = structuredClone(valid);
    missing.project.evaluation.examinerReport!.checks.pop();
    expect((await projectExportIssues(missing)).map((entry) => entry.path)).toContain(
      "project.evaluation.examinerReport.checks",
    );

    const duplicated = structuredClone(valid);
    duplicated.project.evaluation.examinerReport!.checks[1] = {
      ...duplicated.project.evaluation.examinerReport!.checks[0],
    };
    expect((await projectExportIssues(duplicated)).map((entry) => entry.path)).toContain(
      "project.evaluation.examinerReport.checks",
    );
  });

  it("완료 체크포인트를 loopSpec·strict 채택·게이트·곡선 불변식에 대조한다", async () => {
    const pack = await makePack("deterministic");
    const valid = await createProjectExportEnvelope(exportInput(pack, noHoldout));
    const broken = structuredClone(valid);
    broken.result.checkpoint.round = 2;
    broken.result.checkpoint.tree[0].round = 2;
    broken.result.checkpoint.tree[0].gateRejected = true;
    broken.result.checkpoint.championScore = 79;
    broken.result.checkpoint.doneReason = "plateau";

    const paths = (await projectExportIssues(broken)).map((entry) => entry.path);
    expect(paths).toContain("result.checkpoint.round");
    expect(paths).toContain("result.checkpoint.curve");
    expect(paths).toContain("result.checkpoint.tree");
    expect(paths).toContain("result.checkpoint.tree[0].round");
    expect(paths).toContain("result.checkpoint.tree[0].adopted");
    expect(paths).toContain("result.checkpoint.tree[0].championScore");
    expect(paths).toContain("result.checkpoint.championScore");
    expect(paths).toContain("result.checkpoint.doneReason");
  });

  it("체크포인트의 후보·챔피언·곡선 점수는 0~100 범위여야 한다", async () => {
    const pack = await makePack("deterministic");
    const broken = await createProjectExportEnvelope(exportInput(pack, noHoldout));
    broken.result.checkpoint.curve[0] = -1;
    broken.result.checkpoint.tree[0].candidateScore = 101;
    broken.result.checkpoint.championScore = 101;

    const paths = (await projectExportIssues(broken)).map((entry) => entry.path);
    expect(paths).toContain("result.checkpoint.curve[0]");
    expect(paths).toContain("result.checkpoint.tree[0].candidateScore");
    expect(paths).toContain("result.checkpoint.championScore");
  });

  it("게이트 기각 후보는 높은 점수여도 미채택 챔피언으로 기록할 수 있다", async () => {
    const pack = await makePack("deterministic");
    const input = exportInput(pack, noHoldout);
    input.result.checkpoint.championScore = 50;
    input.result.checkpoint.curve[1] = 50;
    input.result.checkpoint.tree[0] = {
      round: 1,
      candidateScore: 99,
      championScore: 50,
      adopted: false,
      gateRejected: true,
      violations: ["게이트 위반"],
      candidateGuardScore: null,
      guardSafe: true,
    };
    input.result.checkpoint.doneReason = "plateau";

    await expect(createProjectExportEnvelope(input)).resolves.toBeDefined();
  });

  it("검증 가드가 퇴보한 후보는 높은 점수여도 채택으로 기록할 수 없다", async () => {
    const pack = await makePack("llm");
    const input = exportInput(pack, scoredHoldout);
    input.result.checkpoint.championScore = 50;
    input.result.checkpoint.championGuardScore = 60;
    input.result.checkpoint.curve[1] = 50;
    input.result.checkpoint.guardCurve = [60, 60];
    input.result.checkpoint.tree[0] = {
      round: 1,
      candidateScore: 99,
      championScore: 50,
      adopted: false,
      gateRejected: false,
      violations: [],
      candidateGuardScore: 10,
      guardSafe: false,
    };
    input.result.checkpoint.doneReason = "plateau";
    const valid = await createProjectExportEnvelope(input);
    expect(await projectExportIssues(valid)).toEqual([]);

    const tampered = structuredClone(valid);
    tampered.result.checkpoint.tree[0].adopted = true;
    tampered.result.checkpoint.tree[0].championScore = 99;
    tampered.result.checkpoint.championScore = 99;
    tampered.result.checkpoint.curve[1] = 99;
    tampered.result.checkpoint.guardCurve[1] = 10;
    tampered.result.checkpoint.championGuardScore = 10;
    const paths = (await projectExportIssues(tampered)).map((entry) => entry.path);
    expect(paths).toContain("result.checkpoint.tree[0].adopted");
  });

  it("종료 사유는 plateau 우선순위와 정확한 꼬리 미채택 횟수를 따르고 seed는 정수다", async () => {
    const pack = await makePack("deterministic");
    const input = exportInput(pack, noHoldout);
    input.result.checkpoint.championScore = 50;
    input.result.checkpoint.curve[1] = 50;
    input.result.checkpoint.tree[0] = {
      round: 1,
      candidateScore: 40,
      championScore: 50,
      adopted: false,
      gateRejected: false,
      violations: [],
      candidateGuardScore: null,
      guardSafe: true,
    };
    input.result.checkpoint.doneReason = "plateau";
    const plateau = await createProjectExportEnvelope(input);

    const wrongPriority = structuredClone(plateau);
    wrongPriority.result.checkpoint.doneReason = "max_rounds";
    expect((await projectExportIssues(wrongPriority)).map((entry) => entry.path)).toContain(
      "result.checkpoint.doneReason",
    );

    const wrongCount = structuredClone(plateau);
    wrongCount.project.loopSpec.plateauRounds = 2;
    expect((await projectExportIssues(wrongCount)).map((entry) => entry.path)).toContain(
      "result.checkpoint.doneReason",
    );

    const invalidSeed = structuredClone(plateau);
    invalidSeed.project.loopSpec.seed = 1.5;
    expect((await projectExportIssues(invalidSeed)).map((entry) => entry.path)).toContain(
      "project.loopSpec.seed",
    );
  });

  it("척도 상한 도달 실행은 ceiling으로만 종료하고, ceiling은 100점에서만 유효하다", async () => {
    const pack = await makePack("deterministic");
    const input = exportInput(pack, noHoldout);
    input.result.checkpoint.championScore = 100;
    input.result.checkpoint.curve = [50, 100];
    input.result.checkpoint.tree[0] = {
      round: 1,
      candidateScore: 100,
      championScore: 100,
      adopted: true,
      gateRejected: false,
      violations: [],
      candidateGuardScore: null,
      guardSafe: true,
    };
    input.result.checkpoint.doneReason = "ceiling";
    const ceiling = await createProjectExportEnvelope(input);
    expect(await projectExportIssues(ceiling)).toEqual([]);

    const wrongReason = structuredClone(ceiling);
    wrongReason.result.checkpoint.doneReason = "max_rounds";
    expect((await projectExportIssues(wrongReason)).map((entry) => entry.path)).toContain(
      "result.checkpoint.doneReason",
    );

    const notAtCeiling = structuredClone(ceiling);
    notAtCeiling.result.checkpoint.championScore = 99;
    notAtCeiling.result.checkpoint.curve = [50, 99];
    notAtCeiling.result.checkpoint.tree[0].candidateScore = 99;
    notAtCeiling.result.checkpoint.tree[0].championScore = 99;
    expect((await projectExportIssues(notAtCeiling)).map((entry) => entry.path)).toContain(
      "result.checkpoint.doneReason",
    );
  });

  it("홀드아웃 채점은 동결 caseId 집합과 정확히 같고 중복이 없어야 한다", async () => {
    const pack = await makePack("llm");
    const valid = await createProjectExportEnvelope(exportInput(pack, scoredHoldout));

    const wrongCase = structuredClone(valid);
    if (wrongCase.result.holdout.mode !== "measured") throw new Error("fixture 오류");
    if (wrongCase.result.holdout.baseline.status !== "scored") throw new Error("fixture 오류");
    if (wrongCase.result.holdout.baseline.evaluation.gateRejected) throw new Error("fixture 오류");
    wrongCase.result.holdout.baseline.evaluation.perCase[0].caseId = "other-case";
    expect((await projectExportIssues(wrongCase)).map((entry) => entry.path)).toContain(
      "result.holdout.baseline.evaluation.perCase",
    );

    const duplicated = structuredClone(valid);
    if (duplicated.result.holdout.mode !== "measured") throw new Error("fixture 오류");
    if (duplicated.result.holdout.baseline.status !== "scored") throw new Error("fixture 오류");
    if (duplicated.result.holdout.baseline.evaluation.gateRejected) throw new Error("fixture 오류");
    duplicated.result.holdout.baseline.evaluation.perCase.push({
      ...duplicated.result.holdout.baseline.evaluation.perCase[0],
    });
    const duplicateIssues = await projectExportIssues(duplicated);
    expect(
      duplicateIssues.filter(
        (entry) => entry.path === "result.holdout.baseline.evaluation.perCase",
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("홀드아웃 케이스 점수·집계와 baseline/final 케이스 설명이 서로 일치해야 한다", async () => {
    const pack = await makePack("llm");
    const valid = await createProjectExportEnvelope(exportInput(pack, scoredHoldout));
    if (valid.result.holdout.mode !== "measured") throw new Error("fixture 오류");
    valid.result.holdout.final = structuredClone(valid.result.holdout.baseline);
    if (valid.result.holdout.baseline.status !== "scored") throw new Error("fixture 오류");
    if (valid.result.holdout.baseline.evaluation.gateRejected) throw new Error("fixture 오류");
    valid.result.holdout.baseline.evaluation.perCase[0].score = 0.25;
    valid.result.holdout.baseline.evaluation.score = 80;
    if (valid.result.holdout.final.status !== "scored") throw new Error("fixture 오류");
    if (valid.result.holdout.final.evaluation.gateRejected) throw new Error("fixture 오류");
    valid.result.holdout.final.evaluation.perCase[0].question = "다른 질문";

    const paths = (await projectExportIssues(valid)).map((entry) => entry.path);
    expect(paths).toContain("result.holdout.baseline.evaluation.perCase[0].score");
    expect(paths).toContain("result.holdout.baseline.evaluation.score");
    expect(paths).toContain("result.holdout");
  });

  it("홀드아웃 실패와 게이트 기각은 caseId 채점 없이도 명시적으로 기록한다", async () => {
    const pack = await makePack("llm");
    const input = exportInput(pack, scoredHoldout);
    if (input.result.holdout.mode !== "measured") throw new Error("fixture 오류");
    input.result.holdout.baseline = {
      status: "scored",
      evaluation: {
        gateRejected: true,
        score: null,
        perCase: [],
        violations: ["분량 게이트 위반"],
      },
    };
    const valid = await createProjectExportEnvelope(input);

    const invalid = structuredClone(valid);
    if (invalid.result.holdout.mode !== "measured") throw new Error("fixture 오류");
    if (invalid.result.holdout.baseline.status !== "scored") throw new Error("fixture 오류");
    Object.assign(invalid.result.holdout.baseline.evaluation, {
      perCase: [
        {
          caseId: "case-4",
          question: "채점되면 안 됨",
          score: 1,
          why: "-",
          caseType: "new",
        },
      ],
    });
    expect((await projectExportIssues(invalid)).map((entry) => entry.path)).toContain(
      "result.holdout.baseline.evaluation",
    );
  });

  it("builder는 고정 계약 계층의 런타임 추가 필드를 내보내지 않는다", async () => {
    const pack = await makePack("llm");
    const input = exportInput(pack, scoredHoldout);
    const sentinel = "절대-내보내지-않음";
    input.project.interview.answers = { custom: { nested: "보존" } };

    Object.assign(input, { internal: sentinel });
    Object.assign(input.project, { draft: sentinel });
    Object.assign(input.project.interview, { apiKey: sentinel, private_key: sentinel });
    Object.assign(input.project.evaluation, { artifacts: sentinel });
    Object.assign(input.project.evaluation.pack, { apiKey: sentinel });
    Object.assign(input.project.evaluation.pack.judgeProcedure, { internal: sentinel });
    Object.assign(input.project.evaluation.pack.holdoutPolicy, { internal: sentinel });
    Object.assign(input.project.evaluation.examinerReport!, { artifacts: sentinel });
    Object.assign(input.project.evaluation.examinerReport!.checks[0], { raw: sentinel });
    Object.assign(input.project.evaluation.approval, { actor: sentinel });
    Object.assign(input.project.loopSpec, { debug: sentinel });
    Object.assign(input.result, { transient: sentinel });
    Object.assign(input.result.checkpoint, { apiKey: sentinel, access_token: sentinel });
    Object.assign(input.result.checkpoint.tree[0], { rawCandidate: sentinel });
    input.result.checkpoint.provenance.push({
      at: now,
      type: "finished",
      detail: "완료",
    });
    Object.assign(input.result.checkpoint.provenance[0], { viewedBy: sentinel });
    if (input.result.holdout.mode !== "measured") throw new Error("fixture 오류");
    Object.assign(input.result.holdout, { pending: sentinel });
    Object.assign(input.result.holdout.baseline, { internal: sentinel });
    if (input.result.holdout.baseline.status !== "scored") throw new Error("fixture 오류");
    Object.assign(input.result.holdout.baseline.evaluation, { raw: sentinel });
    if (input.result.holdout.baseline.evaluation.gateRejected) throw new Error("fixture 오류");
    Object.assign(input.result.holdout.baseline.evaluation.perCase[0], { expectedAnswer: sentinel });

    const envelope = await createProjectExportEnvelope(input);
    const json = JSON.stringify(envelope);
    expect(json).not.toContain(sentinel);
    expect(envelope.project.interview.answers).toEqual({ custom: { nested: "보존" } });
  });

  it("Pack 본문 변조와 report·checkpoint 결속 불일치를 모두 거부한다", async () => {
    const pack = await makePack("llm");
    const examinerReport = report(pack);
    const valid = await createProjectExportEnvelope({
      exportedAt: now,
      project: {
        interview: { schemaVersion: "skeleton-1", templateId: pack.templateId, answers: {} },
        evaluation: {
          pack,
          examinerReport,
          approval: { forDigest: pack.definitionDigest, approvedAt: now },
        },
        loopSpec: { maxRounds: 1, plateauRounds: 1, adoptionRule: "scalar_strict", seed: 1 },
      },
      result: { checkpoint: checkpoint(pack), holdout: scoredHoldout },
    });
    const broken = structuredClone(valid) as ProjectExportEnvelope<string>;
    broken.project.evaluation.pack.criteria.push({
      id: "tampered",
      kind: "deterministic",
      scorer: "tampered",
      params: {},
      weight: 1,
      label: "변조",
    });
    broken.project.evaluation.examinerReport!.forDigest = "b".repeat(64);
    broken.result.checkpoint.packDigest = "c".repeat(64);

    const paths = (await projectExportIssues(broken)).map((entry) => entry.path);
    expect(paths).toContain("project.evaluation.pack.definitionDigest");
    expect(paths).toContain("project.evaluation.examinerReport.forDigest");
    expect(paths).toContain("result.checkpoint.packDigest");
  });

  it("인터뷰·Pack 버전과 템플릿·저지 식별자의 빈 값을 거부한다", async () => {
    const pack = await makePack("llm");
    const valid = await createProjectExportEnvelope(exportInput(pack, scoredHoldout));
    const broken = structuredClone(valid) as ProjectExportEnvelope<string>;
    Object.assign(broken.project.interview, { schemaVersion: "skeleton-2", templateId: "" });
    Object.assign(broken.project.evaluation.pack, { packVersion: "skeleton-2", templateId: "" });
    if (broken.project.evaluation.pack.judgeProcedure.kind !== "case_answering") {
      throw new Error("fixture 오류");
    }
    broken.project.evaluation.pack.judgeProcedure.judge.model = "";

    const paths = (await projectExportIssues(broken)).map((entry) => entry.path);
    expect(paths).toContain("project.interview.schemaVersion");
    expect(paths).toContain("project.interview.templateId");
    expect(paths).toContain("project.evaluation.pack.packVersion");
    expect(paths).toContain("project.evaluation.pack.templateId");
    expect(paths).toContain("project.evaluation.pack.judgeProcedure.judge.model");
  });

  it("모든 BYO provider는 지원하고 알 수 없는 provider는 거부한다", async () => {
    let validEnvelope: ProjectExportEnvelope<string> | null = null;
    for (const provider of ["vertex", "anthropic", "openrouter", "ollama"] as const) {
      const pack = await makePack("llm");
      if (pack.judgeProcedure.kind !== "case_answering") throw new Error("fixture 오류");
      pack.judgeProcedure.judge = { provider, model: `${provider}-model` };
      pack.definitionDigest = await sha256Canonical(digestScope(pack));
      const input = exportInput(pack, scoredHoldout);
      if (input.project.evaluation.examinerReport === null) throw new Error("fixture 오류");
      input.project.evaluation.examinerReport.judge = { provider, model: `${provider}-model` };
      validEnvelope = await createProjectExportEnvelope(input);
      const paths = (await projectExportIssues(validEnvelope)).map((entry) => entry.path);
      expect(paths).not.toContain("project.evaluation.pack.judgeProcedure.judge.provider");
    }
    if (validEnvelope === null) throw new Error("fixture 오류");

    const broken = structuredClone(validEnvelope) as ProjectExportEnvelope<string>;
    if (broken.project.evaluation.pack.judgeProcedure.kind !== "case_answering") {
      throw new Error("fixture 오류");
    }
    Object.assign(broken.project.evaluation.pack.judgeProcedure.judge, { provider: "unknown" });
    const brokenPaths = (await projectExportIssues(broken)).map((entry) => entry.path);
    expect(brokenPaths).toContain("project.evaluation.pack.judgeProcedure.judge.provider");
  });

  it("실패 증거나 진행 중 체크포인트를 정식 완료 기록으로 만들지 않는다", async () => {
    const pack = await makePack("llm");
    const examinerReport = report(pack);
    examinerReport.overall = "fail";
    examinerReport.checks[0].verdict = "fail";
    const running = checkpoint(pack);
    running.status = "running";

    await expect(
      createProjectExportEnvelope({
        exportedAt: now,
        project: {
          interview: { schemaVersion: "skeleton-1", templateId: pack.templateId, answers: {} },
          evaluation: {
            pack,
            examinerReport,
            approval: { forDigest: pack.definitionDigest, approvedAt: now },
          },
          loopSpec: { maxRounds: 1, plateauRounds: 1, adoptionRule: "scalar_strict", seed: 1 },
        },
        result: { checkpoint: running, holdout: scoredHoldout },
      }),
    ).rejects.toBeInstanceOf(ProjectExportContractError);
  });

  it("봉투 메타데이터와 승인 증거는 definitionDigest 범위를 바꾸지 않는다", async () => {
    const pack = await makePack("llm");
    const before = pack.definitionDigest;
    const examinerReport = report(pack);
    examinerReport.checks[0].note = "봉투 안에서 바뀐 설명";

    expect(await sha256Canonical(digestScope({
      packVersion: pack.packVersion,
      templateId: pack.templateId,
      criteria: pack.criteria,
      gates: pack.gates,
      judgeProcedure: pack.judgeProcedure,
      holdoutPolicy: pack.holdoutPolicy,
    }))).toBe(before);
  });
});
