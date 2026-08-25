/** 브라우저 프로젝트 스냅샷 — 새로고침이 승인·캘리브레이션 불변식을 우회하지 못하게 한다.
 *  Evaluation Pack 정식 저장 계약이 아니라 단일 브라우저의 임시 영속화 계층이며,
 *  벤더 자격 증명과 access token은 이 타입과 저장 경로에 존재하지 않는다(SPEC §3 원칙 1, §7). */

import type { CalibrationResult, LoopCheckpoint } from "@harnest/contracts";
import type {
  CompiledGeneric,
  ExaminerAttempts,
  ExaminerRunGeneric,
  HoldoutScores,
} from "../state";

export const PROJECT_SNAPSHOT_VERSION = 1 as const;

export interface ProjectSnapshot {
  schemaVersion: typeof PROJECT_SNAPSHOT_VERSION;
  templateId: string | null;
  answers: Record<string, unknown>;
  compiled: CompiledGeneric | null;
  examinerRun: ExaminerRunGeneric | null;
  /** 검증 배터리 실행 계수 — 새로고침이 재검증 쿼터(SPEC §5.2)를 초기화하지 못하게 한다.
   *  이 필드가 없는 구버전 스냅샷은 계수 0으로 읽는다. */
  examinerAttempts?: ExaminerAttempts | null;
  calibration: CalibrationResult | null;
  /** 승인 순간의 다이제스트 — 승인 전 상태에는 null */
  approvedDigest: string | null;
  approvedAt: string | null;
  runId: string | null;
  holdout: HoldoutScores;
}

export interface RestoredProjectSnapshot {
  templateId: string | null;
  answers: Record<string, unknown>;
  compiled: CompiledGeneric | null;
  examinerRun: ExaminerRunGeneric | null;
  examinerAttempts: ExaminerAttempts | null;
  calibration: CalibrationResult | null;
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

/** 리포트·캘리브레이션은 불일치 상태도 복원해 수정→재검증 안내와 실패 고착을 보존한다.
 *  승인 이후 상태만 approvedDigest 일치로 복원한다. 불일치면 승인·실행 흔적을 폐기한다. */
export function restoreProjectSnapshot(
  snapshot: ProjectSnapshot,
): RestoredProjectSnapshot | null {
  if (snapshot.schemaVersion !== PROJECT_SNAPSHOT_VERSION) return null;

  const approvalMatches =
    snapshot.approvedAt !== null &&
    snapshot.compiled !== null &&
    snapshot.approvedDigest === snapshot.compiled.pack.definitionDigest;

  return {
    templateId: snapshot.templateId,
    answers: snapshot.answers,
    compiled: snapshot.compiled,
    examinerRun: snapshot.examinerRun,
    examinerAttempts: snapshot.examinerAttempts ?? null,
    calibration: snapshot.calibration,
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

  async load(): Promise<ProjectSnapshot | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(CURRENT_KEY);
      req.onsuccess = () => resolve((req.result as ProjectSnapshot | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("프로젝트 스냅샷 읽기 실패"));
    });
  }
}
