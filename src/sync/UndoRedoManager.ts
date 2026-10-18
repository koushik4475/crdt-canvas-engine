
export interface UndoableAction {
  id: string;
  timestamp: number;
  undo: () => void;
  redo: () => void;
  description: string;
}

export class UndoRedoManager {
  private undoStack: UndoableAction[] = [];
  private redoStack: UndoableAction[] = [];
  private maxHistory: number;
  private isExecuting: boolean = false;

  constructor(maxHistory: number = 200) {
    this.maxHistory = maxHistory;
  }

  public record(action: UndoableAction): void {
    if (this.isExecuting) return; // Don't record during undo/redo replay
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo stack on new action
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(): boolean {
    if (!this.canUndo()) return false;
    const action = this.undoStack.pop()!;
    this.isExecuting = true;
    try {
      action.undo();
      this.redoStack.push(action);
      return true;
    } finally {
      this.isExecuting = false;
    }
  }

  public redo(): boolean {
    if (!this.canRedo()) return false;
    const action = this.redoStack.pop()!;
    this.isExecuting = true;
    try {
      action.redo();
      this.undoStack.push(action);
      return true;
    } finally {
      this.isExecuting = false;
    }
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public getRedoCount(): number {
    return this.redoStack.length;
  }
}
