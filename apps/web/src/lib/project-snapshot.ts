/** 브라우저 프로젝트 스냅샷 — 새로고침이 승인 불변식을 우회하지 못하게 한다.
 *  Evaluation Pack 정식 저장 계약이 아니라 단일 브라우저의 임시 영속화 계층이며,
 *  벤더 자격 증명과 access token은 이 타입과 저장 경로에 존재하지 않는다(SPEC §3 원칙 1, §7). */

import type { ExaminerReport, LoopCheckpoint } from "@harnest/contracts";
import { worstVerdict } from "@harnest/contracts";
import type { CompiledGeneric, HoldoutScores } from "../state";

/** v2 (2026-08-25): 캘리브레이션·재검증 계수·배터리 산출물 제거 — 리포트만 남는다 */
export const PROJECT_SNAPSHOT_VERSION = 2 as const;

export interface ProjectSnapshot {
  schemaVersion: typeof PROJECT_SNAPSHOT_VERSION;
  templateId: string | null;
  answers: Record<string, unknown>;
  compiled: CompiledGeneric | null;
  examinerReport: ExaminerReport | null;
  /** 승인 순간의 다이제스트 — 승인 전 상태에는 null */
  approvedDigest: string | null;
  approvedAt: string | null;
  runId: string | null;
  holdout: HoldoutScores;
}

/** v1 스냅샷 — 캘리브레이션·재검증 계수·배터리 산출물이 있던 시절의 형태(마이그레이션 전용).
 *  검사 4종(순서·변별력 포함) 리포트를 담고 있을 수 있다. */
interface ProjectSnapshotV1 {
  schemaVersion: 1;
  templateId: string | null;
  answers: Record<string, unknown>;
  compiled: CompiledGeneric | null;
  examinerRun: { report: ExaminerReport } | null;
  approvedDigest: string | null;
  approvedAt: string | null;
  runId: string | null;
  holdout: HoldoutScores;
}

export type StoredProjectSnapshot = ProjectSnapshot | ProjectSnapshotV1;

export interface RestoredProjectSnapshot {
  templateId: string | null;
  answers: Record<string, unknown>;
  compiled: CompiledGeneric | null;
  examinerReport: ExaminerReport | null;
  /** 승인 순간 캡처된 다이제스트 — 현재 팩과 일치할 때만 approvedAt과 함께 복원된다 */
  approvedDigest: string | null;
  approvedAt: string | null;
  runId: string | null;
  holdout: HoldoutScores;
}

const emptyHoldout = (): HoldoutScores => ({
  baseline: null,
  final: null,
  errors: { baseline: null, final: null },
});

const normalizeHoldout = (holdout: HoldoutScores): HoldoutScores => ({
  ...holdout,
  errors: holdout.errors ?? { baseline: null, final: null },
});

/**
 * 구버전·중간 저장에는 점수도 실패 사유도 없을 수 있다. 라운드 0 산출물을 따로 보존하지
 * 않으므로 이미 지나간 시작 단계만 '복원 불가'로 확정한다. 종료 단계는 완료 체크포인트의
 * 챔피언으로 다시 채점할 수 있으므로 대기 상태를 유지해 관제실이 복구한다.
 */
export function markUnavailableRestoredHoldout(
  holdout: HoldoutScores,
  checkpoint: LoopCheckpoint<unknown> | null,
  requiresHoldout: boolean,
): HoldoutScores {
  const normalized = normalizeHoldout(holdout);
  if (!requiresHoldout || checkpoint === null) return normalized;
  const errors = { ...normalized.errors! };
  if (checkpoint.round > 0 && normalized.baseline === null && errors.baseline === null) {
    errors.baseline = "저장된 기록에 시작 홀드아웃 결과가 없어 복원할 수 없습니다.";
  }
  return { ...normalized, errors };
}

/** v1 리포트는 검사 4종을 담고 있다 — 현재 배터리 2종(안정성·꼼수 내성)만 남기고
 *  overall을 다시 계산한다. 남긴 검사도 같은 저지로 실제 실행된 결과라 의미가 보존된다. */
function migrateV1Report(report: ExaminerReport | null): ExaminerReport | null {
  if (report === null) return null;
  const checks = report.checks.filter((c) => c.id === "stability" || c.id === "hack_resistance");
  if (checks.length !== 2) return null;
  return { ...report, checks, overall: worstVerdict(checks.map((c) => c.verdict)) };
}

/** 리포트는 불일치 상태도 복원해 재검증 자동 실행의 신호로 쓴다.
 *  승인 이후 상태만 approvedDigest 일치로 복원한다. 불일치면 승인·실행 흔적을 폐기한다. */
export function restoreProjectSnapshot(
  snapshot: StoredProjectSnapshot,
): RestoredProjectSnapshot | null {
  if (snapshot.schemaVersion !== PROJECT_SNAPSHOT_VERSION && snapshot.schemaVersion !== 1) {
    return null;
  }

  const approvalMatches =
    snapshot.approvedAt !== null &&
    snapshot.compiled !== null &&
    snapshot.approvedDigest === snapshot.compiled.pack.definitionDigest;

  return {
    templateId: snapshot.templateId,
    answers: snapshot.answers,
    compiled: snapshot.compiled,
    examinerReport:
      snapshot.schemaVersion === 1
        ? migrateV1Report(snapshot.examinerRun?.report ?? null)
        : snapshot.examinerReport,
    approvedDigest: approvalMatches ? snapshot.approvedDigest : null,
    approvedAt: approvalMatches ? snapshot.approvedAt : null,
    runId: approvalMatches ? snapshot.runId : null,
    holdout: approvalMatches ? normalizeHoldout(snapshot.holdout) : emptyHoldout(),
  };
}

const DB_NAME = "harnest-project";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";
const CURRENT_KEY = "current";

export class IndexedDbProjectStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly dbName: string = DB_NAME) {}

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, DB_VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE_NAME)) {
            req.result.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => {
          req.result.onversionchange = () => req.result.close();
          resolve(req.result);
        };
        req.onerror = () => reject(req.error ?? new Error("프로젝트 저장소 열기 실패"));
      });
    }
    return this.dbPromise;
  }

  async save(snapshot: ProjectSnapshot): Promise<void> {
    const value = structuredClone(snapshot);
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const db = await this.open();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).put(value, CURRENT_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("프로젝트 스냅샷 저장 실패"));
        });
      });
    return this.writeChain;
  }

  async load(): Promise<StoredProjectSnapshot | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(CURRENT_KEY);
      req.onsuccess = () => resolve((req.result as StoredProjectSnapshot | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("프로젝트 스냅샷 읽기 실패"));
    });
  }
}
