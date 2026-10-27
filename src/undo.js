// Undo/redo history of the design, as JSON snapshots. Changes that come in
// quick succession (typing a word, dragging an item) merge into one step.

export class UndoHistory {
  constructor(state, { limit = 100, mergeMs = 700, now = () => Date.now() } = {}) {
    this.current = state;
    this.past = [];
    this.future = [];
    this.limit = limit;
    this.mergeMs = mergeMs;
    this.now = now;
    this.lastAt = -Infinity;
  }

  // Records the design's state after a change. `merge` keeps it in the same
  // step as the previous change, e.g. while a drag is still going.
  record(state, { merge = false } = {}) {
    if (state === this.current) return false;
    const t = this.now();
    if (!(merge || t - this.lastAt < this.mergeMs) || !this.past.length) {
      this.past.push(this.current);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.current = state;
    this.future = [];
    this.lastAt = t;
    return true;
  }

  // Starts a new step at the next change, however soon it comes.
  checkpoint() {
    this.lastAt = -Infinity;
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  // Return the state to restore, or null.
  undo() {
    if (!this.past.length) return null;
    this.future.push(this.current);
    this.current = this.past.pop();
    this.checkpoint();
    return this.current;
  }

  redo() {
    if (!this.future.length) return null;
    this.past.push(this.current);
    this.current = this.future.pop();
    this.checkpoint();
    return this.current;
  }
}
