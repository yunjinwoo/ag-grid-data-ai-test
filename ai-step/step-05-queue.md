# Step 05 — 인메모리 큐

## 목적
Redis 없이 로컬 개발 환경에서 에이전트 간 비동기 메시지 전달을 구현.

---

## 파일: `src/queue/InMemoryQueue.ts`

```typescript
import { EventEmitter } from 'events';

export class InMemoryQueue<T> extends EventEmitter {
  private items: T[] = [];

  push(item: T): void {
    this.items.push(item);
    this.emit('data', item);   // 이벤트 발행 (subscribe 패턴 지원)
  }

  pop(): T | undefined {
    return this.items.shift(); // FIFO
  }

  drain(): T[] {               // 전체 소비 (Snapshot Agent용)
    const all = [...this.items];
    this.items = [];
    return all;
  }

  size(): number { return this.items.length; }
}
```

---

## 큐 인스턴스

시스템은 2개의 큐를 사용:

```
taskQueue   (TaskMessage)    Coordinator  →  Worker
resultQueue (ResultMessage)  Worker       →  Snapshot Agent
```

---

## Redis와의 대응 관계

| InMemoryQueue 메서드 | Redis 명령 |
|----------------------|------------|
| `push(item)` | `LPUSH queue payload` |
| `pop()` | `BRPOP queue 0` |
| `drain()` | `LRANGE queue 0 -1` + `DEL queue` |
| `size()` | `LLEN queue` |

운영 전환 시 이 클래스만 `ioredis` + BullMQ 기반으로 교체하면 됨.
