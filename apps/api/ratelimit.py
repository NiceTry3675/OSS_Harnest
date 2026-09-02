"""공유 키 프록시(/proxy/*)의 남용을 막는 최소한의 안전장치 — IP별 시간당 요청 수 제한.

관리자 키는 계정 전체가 함께 쓰므로, 방문자 한 명이 스크립트로 두드리면 관리자의
벤더 청구액이 그대로 올라간다. 이 제한은 그 최악의 경우를 정해진 상한으로 묶어 두는
용도이지 정교한 남용 탐지가 아니다. 실질적인 방어선은 벤더 콘솔(OpenAI·Google Cloud)의
지출 한도이며, 이 한도는 그 한도가 걸리기 전에 계정이 소진되는 것을 늦추는 역할만 한다.

단일 프로세스 전제다 — 여러 인스턴스로 수평 확장하는 배포라면 공유 저장소(Redis,
DynamoDB 등)로 바꿔야 카운터가 정확히 맞는다.
"""

from __future__ import annotations

import time
from typing import Dict


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._counts: Dict[str, int] = {}

    def check(self, key: str, limit: int) -> bool:
        """이번 시간대 한도 안이면 True, 넘었으면 False."""
        hour = int(time.time() // 3600)
        self._evict_before(hour)
        bucket = f"{key}#{hour}"
        self._counts[bucket] = self._counts.get(bucket, 0) + 1
        return self._counts[bucket] <= limit

    def _evict_before(self, hour: int) -> None:
        # 지난 시간대 버킷은 다시 읽히지 않는다 — 두지 않으면 방문자 수만큼 무한히 쌓인다.
        stale = [bucket for bucket in self._counts if int(bucket.rsplit("#", 1)[1]) < hour]
        for bucket in stale:
            del self._counts[bucket]


def build_rate_limiter() -> InMemoryRateLimiter:
    return InMemoryRateLimiter()
