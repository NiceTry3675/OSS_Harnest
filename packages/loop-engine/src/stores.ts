/** 체크포인트 저장소 — 구조화 복제 가능한 순수 데이터만 저장한다.
 *  MemoryCheckpointStore는 테스트·SSR용, IndexedDbCheckpointStore는 브라우저 실사용(탭 회수 후 재개). */

import type { LoopCheckpoint } from "@harnest/contracts";
import type { CheckpointStore } from "./index";

export class MemoryCheckpointStore<A> implements CheckpointStore<A> {
  private readonly map = new Map<string, LoopCheckpoint<A>>();

  async save(cp: LoopCheckpoint<A>): Promise<void> {
    // 복제 저장 — 호출자가 이후 객체를 변이해도 저장본은 불변
    this.map.set(cp.runId, structuredClone(cp));
  }

  async load(runId: string): Promise<LoopCheckpoint<A> | null> {
    const found = this.map.get(runId);
    return found ? structuredClone(found) : null;
  }

  /** 소유 프로젝트가 runId를 폐기할 때 호출 — 고아 체크포인트를 남기지 않는다 */
  async delete(runId: string): Promise<void> {
    this.map.delete(runId);
  }

  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }

  /** keepRunId를 제외한 모든 체크포인트 삭제 — null이면 전부 */
  async deleteExcept(keepRunId: string | null): Promise<void> {
    for (const key of this.map.keys()) {
      if (key !== keepRunId) this.map.delete(key);
    }
  }
}

const DB_NAME = "harnest";
const STORE_NAME = "checkpoints";

export class IndexedDbCheckpointStore<A> implements CheckpointStore<A> {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /** 연결은 한 번 열어 공유하되, 열기 실패나 브라우저 측 강제 종료(저장소 정리·버전 변경)는
   *  캐시하지 않는다 — 다음 호출이 다시 연다. 실패한 Promise를 붙들고 있으면 새로고침 전까지
   *  모든 save/load가 같은 실패를 되풀이한다. */
  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE_NAME)) {
            req.result.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const forget = () => {
            db.close();
            if (this.dbPromise === opening) this.dbPromise = null;
          };
          db.onclose = forget;
          db.onversionchange = forget;
          resolve(db);
        };
        req.onerror = () => {
          if (this.dbPromise === opening) this.dbPromise = null;
          reject(req.error ?? new Error("IndexedDB 열기 실패"));
        };
      });
      this.dbPromise = opening;
    }
    return this.dbPromise;
  }

  async save(cp: LoopCheckpoint<A>): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(cp, cp.runId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("체크포인트 저장 실패"));
    });
  }

  async load(runId: string): Promise<LoopCheckpoint<A> | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(runId);
      req.onsuccess = () => resolve((req.result as LoopCheckpoint<A> | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("체크포인트 읽기 실패"));
    });
  }

  /** 소유 프로젝트가 runId를 폐기할 때 호출 — 고아 체크포인트를 남기지 않는다 */
  async delete(runId: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(runId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("체크포인트 삭제 실패"));
    });
  }

  async keys(): Promise<string[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () =>
        resolve(req.result.filter((key): key is string => typeof key === "string"));
      req.onerror = () => reject(req.error ?? new Error("체크포인트 키 조회 실패"));
    });
  }

  /** keepRunId를 제외한 모든 체크포인트 삭제 — null이면 전부. 한 트랜잭션에서 처리한다. */
  async deleteExcept(keepRunId: string | null): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const objectStore = tx.objectStore(STORE_NAME);
      const req = objectStore.getAllKeys();
      req.onsuccess = () => {
        for (const key of req.result) {
          if (key !== keepRunId) objectStore.delete(key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("체크포인트 정리 실패"));
    });
  }
}
