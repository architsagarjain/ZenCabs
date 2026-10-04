export type Unsubscribe = () => void;

/** Minimal typed event emitter. */
export class Emitter<Events extends object> {
  private handlers = new Map<keyof Events, Set<(payload: any) => void>>();

  on<E extends keyof Events>(event: E, handler: (payload: Events[E]) => void): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[emitter] handler for ${String(event)} failed`, err);
      }
    }
  }

  clear() {
    this.handlers.clear();
  }
}
