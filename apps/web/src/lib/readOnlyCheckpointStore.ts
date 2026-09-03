/** 읽기 전용 탭의 체크포인트 저장 차단 — 쓰기 잠금을 쥔 탭만 체크포인트를 쓴다(SPEC §4.2).
 *
 *  Web Locks가 없는 환경에서 스냅샷 충돌로 뒤늦게 읽기 전용이 된 탭은 진행 중이던 라운드를 라운드
 *  경계에서 정지시키지만(dropExcept → pause), 엔진의 pause는 그 라운드를 마친 뒤 commit을 정상
 *  수행하므로 소유권을 잃은 탭이 같은 runId에 체크포인트를 한 번 더 덮어쓴다. 저장소 자체를 이 가드로
 *  감싸면 그 commit이 CheckpointSaveError로 끝나 저장·통지 모두 일어나지 않는다. 읽기(load)는 표시용
 *  이라 막지 않는다. */

import type { CheckpointStore } from "@harnest/loop-engine";

export const READ_ONLY_SAVE_MESSAGE =
  "다른 탭이 이 프로젝트를 소유해 이 탭에서는 진행 상태를 저장하지 않습니다.";

export function readOnlyGuardedStore<A>(
  store: CheckpointStore<A>,
  isReadOnly: () => boolean,
): CheckpointStore<A> {
  return {
    load: (runId) => store.load(runId),
    save: (cp) =>
      isReadOnly() ? Promise.reject(new Error(READ_ONLY_SAVE_MESSAGE)) : store.save(cp),
  };
}
