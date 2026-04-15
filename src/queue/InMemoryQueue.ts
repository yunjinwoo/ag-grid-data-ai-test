import { EventEmitter } from 'events';

export class InMemoryQueue<T> extends EventEmitter {
  private readonly name: string;
  private items: T[] = [];

  constructor(name: string) {
    super();
    this.name = name;
  }

  push(item: T): void {
    this.items.push(item);
    this.emit('data', item);
  }

  pop(): T | undefined {
    return this.items.shift();
  }

  size(): number {
    return this.items.length;
  }

  drain(): T[] {
    const all = [...this.items];
    this.items = [];
    return all;
  }

  getName(): string {
    return this.name;
  }
}
