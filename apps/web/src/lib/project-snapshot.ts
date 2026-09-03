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

/** 저장소에 실제로 놓인 형태 — 판 번호(revision)는 저장소가 붙인다(호출자는 모른다).
 *  구버전 저장본에는 없을 수 있으며 그때는 0판으로 본다. */
export type StoredProjectSnapshot = (ProjectSnapshot | ProjectSnapshotV1) & { revision?: number };

/** 저장 거부 — 이 인스턴스가 마지막으로 읽거나 쓴 뒤 다른 곳(다른 탭)이 먼저 저장했다.
 *  Web Locks가 없는 환경(비보안 컨텍스트·구형 브라우저)에서 잠금 대신 덮어쓰기를 막는 최소 방어. */
export class SnapshotConflictError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `프로젝트 스냅샷 충돌 — 다른 탭이 먼저 저장했습니다 (이 탭 ${expected}판, 저장소 ${actual}판)`,
    );
    this.name = "SnapshotConflictError";
  }
}

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
    errors.baseline = "저장된 기록에 시작할 때의 최종 확인 결과가 없어 복원할 수 없습니다.";
  }
  return { ...normalized, errors };
}

/** 복원 시 저장된 체크포인트를 화면 상태로 투영하는 규칙. 현재 팩에 결속되지 않은 저장본은 버린다.
 *  running 저장본은 탭 회수(새로고침·닫기)의 흔적이므로 사용자가 재개할 수 있게 paused로 투영하고,
 *  진행 중이던 회차가 저장되지 않았다는 안내를 위해 그 runId를 interruptedRunId로 돌려준다 — 단
 *  잠금을 쥔 탭(owned)만이다. 읽기 전용 탭의 running 저장본은 다른 탭이 지금 돌리고 있는 것이다.
 *  관제실 화면은 이 판단을 스스로 하지 못한다: 세션 확보 effect가 같은 커밋에서 세션을 만들므로
 *  저장본을 읽은 시점에는 세션 유무로 탭 회수를 가릴 수 없다. */
export function projectRestoredCheckpoint(
  saved: LoopCheckpoint<unknown> | null,
  packDigest: string,
  owned: boolean,
): { checkpoint: LoopCheckpoint<unknown> | null; interruptedRunId: string | null } {
  if (saved === null || saved.packDigest !== packDigest) {
    return { checkpoint: null, interruptedRunId: null };
  }
  if (saved.status !== "running") return { checkpoint: saved, interruptedRunId: null };
  return {
    checkpoint: { ...saved, status: "paused" },
    interruptedRunId: owned ? saved.runId : null,
  };
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

  // seeded_split 도입 전(auto_tail) 팩은 현재 계약으로 렌더·실행할 수 없다 — 답변은 남기고
  // 컴파일 산출물만 버려 재컴파일(=새 분할·새 다이제스트·재승인)을 유도한다.
  const compiled =
    snapshot.compiled !== null &&
    (snapshot.compiled.pack.holdoutPolicy as { mode?: string }).mode === "auto_tail"
      ? null
      : snapshot.compiled;

  const approvalMatches =
    snapshot.approvedAt !== null &&
    compiled !== null &&
    snapshot.approvedDigest === compiled.pack.definitionDigest;

  return {
    templateId: snapshot.templateId,
    answers: snapshot.answers,
    compiled,
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

const revisionOf = (stored: unknown): number => {
  const revision = (stored as { revision?: unknown } | undefined)?.revision;
  return typeof revision === "number" && Number.isFinite(revision) ? revision : 0;
};

/** 키 순서에 무관한 직렬화 — 저장본과 새 스냅샷의 내용이 같은지 비교하는 데만 쓴다 */
const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );

/** 저장본(판 번호 제외)과 내용이 같은가 */
const sameSnapshot = (stored: unknown, value: ProjectSnapshot): boolean => {
  if (stored === null || typeof stored !== "object") return false;
  const { revision: _revision, ...rest } = stored as StoredProjectSnapshot;
  return stableJson(rest) === stableJson(value);
};

/** 단일 키('current') 스냅샷 저장소. 저장은 "읽은 판 그대로인지 확인 → 다음 판으로 기록"을 한
 *  readwrite 트랜잭션 안에서 수행한다(IndexedDB 트랜잭션은 원자적이다). 이 인스턴스가 마지막으로
 *  읽거나 쓴 판과 저장소의 판이 다르면 SnapshotConflictError로 거부한다 — 다른 탭이 먼저 저장한
 *  것이므로 오래된 상태로 덮어쓰지 않는다. */
export class IndexedDbProjectStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  /** 마지막으로 읽거나 쓴 판 — null이면 아직 읽지 않았다(첫 저장은 저장소의 현재 판을 잇는다) */
  private revision: number | null = null;

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
          const store = tx.objectStore(STORE_NAME);
          const current = store.get(CURRENT_KEY);
          let conflict: SnapshotConflictError | null = null;
          let next = 0;
          current.onsuccess = () => {
            const actual = revisionOf(current.result);
            const expected = this.revision ?? actual;
            if (actual !== expected) {
              conflict = new SnapshotConflictError(expected, actual);
              tx.abort();
              return;
            }
            if (sameSnapshot(current.result, value)) {
              // 내용이 같으면 판을 올리지 않는다 — 잠금 없는 환경에서 갓 열린 유휴 탭의 하이드레이션
              // 직후 저장이 실행 중인 탭을 읽기 전용으로 밀어내는 일이 없게
              next = actual;
              return;
            }
            next = actual + 1;
            store.put({ ...value, revision: next }, CURRENT_KEY);
          };
          tx.oncomplete = () => {
            this.revision = next;
            resolve();
          };
          const fail = (): void =>
            reject(conflict ?? tx.error ?? new Error("프로젝트 스냅샷 저장 실패"));
          tx.onabort = fail;
          tx.onerror = fail;
        });
      });
    return this.writeChain;
  }

  async load(): Promise<StoredProjectSnapshot | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(CURRENT_KEY);
      req.onsuccess = () => {
        const stored = (req.result as StoredProjectSnapshot | undefined) ?? null;
        this.revision = revisionOf(stored);
        resolve(stored);
      };
      req.onerror = () => reject(req.error ?? new Error("프로젝트 스냅샷 읽기 실패"));
    });
  }
}
