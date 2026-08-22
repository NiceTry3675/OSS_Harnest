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
}

const DB_NAME = "harnest";
const STORE_NAME = "checkpoints";

export class IndexedDbCheckpointStore<A> implements CheckpointStore<A> {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE_NAME)) {
            req.result.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB 열기 실패"));
      });
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
}
