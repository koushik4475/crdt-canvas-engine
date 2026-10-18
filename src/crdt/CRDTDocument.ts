import { LogootSequence, CRDTOperation } from './LogootSequence';
import { ShapeCRDTMap, ShapeOperation, CanvasShape } from './ShapeCRDT';
import { VectorClock } from '../sync/VectorClock';

export interface DocumentMetadata {
  id: string;
  title: string;
  version: number;
  createdAt: number;
  lastModifiedAt: number;
}

export type CRDTPayload =
  | { kind: 'text'; op: CRDTOperation<string> }
  | { kind: 'shape'; op: ShapeOperation }
  | { kind: 'state-sync'; textState: any[]; shapeState: CanvasShape[]; vectorClock: Record<string, number> };

export class CRDTDocument {
  public readonly id: string;
  public readonly siteId: string;
  public readonly textCRDT: LogootSequence<string>;
  public readonly shapeCRDT: ShapeCRDTMap;
  public readonly vectorClock: VectorClock;
  private changeListeners: Array<(payload: CRDTPayload) => void> = [];

  constructor(id: string, siteId: string) {
    this.id = id;
    this.siteId = siteId;
    this.textCRDT = new LogootSequence<string>(siteId);
    this.shapeCRDT = new ShapeCRDTMap(siteId);
    this.vectorClock = new VectorClock();
  }

  public subscribe(listener: (payload: CRDTPayload) => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter(l => l !== listener);
    };
  }

  private notify(payload: CRDTPayload): void {
    for (const listener of this.changeListeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('Error in CRDTDocument subscriber:', err);
      }
    }
  }

  public insertText(index: number, text: string): CRDTOperation<string>[] {
    const ops: CRDTOperation<string>[] = [];
    for (let i = 0; i < text.length; i++) {
      this.vectorClock.increment(this.siteId);
      const op = this.textCRDT.insertAt(index + i, text[i]);
      ops.push(op);
      this.notify({ kind: 'text', op });
    }
    return ops;
  }

  public deleteText(index: number, count: number = 1): CRDTOperation<string>[] {
    const ops: CRDTOperation<string>[] = [];
    for (let i = 0; i < count; i++) {
      this.vectorClock.increment(this.siteId);
      const op = this.textCRDT.deleteAt(index);
      ops.push(op);
      this.notify({ kind: 'text', op });
    }
    return ops;
  }

  public createShape(
    id: string,
    type: CanvasShape['type'],
    transform: Partial<CanvasShape['transform']>,
    style?: CanvasShape['style'],
    content?: string,
    points?: CanvasShape['points']
  ): ShapeOperation {
    this.vectorClock.increment(this.siteId);
    const op = this.shapeCRDT.createShape(id, type, transform, style, content, points);
    this.notify({ kind: 'shape', op });
    return op;
  }

  public updateShape(id: string, patch: Partial<Omit<CanvasShape, 'id' | 'createdBy'>>): ShapeOperation | null {
    this.vectorClock.increment(this.siteId);
    const op = this.shapeCRDT.updateShape(id, patch);
    if (op) {
      this.notify({ kind: 'shape', op });
    }
    return op;
  }

  public deleteShape(id: string): ShapeOperation | null {
    this.vectorClock.increment(this.siteId);
    const op = this.shapeCRDT.deleteShape(id);
    if (op) {
      this.notify({ kind: 'shape', op });
    }
    return op;
  }

  public applyRemotePayload(payload: CRDTPayload): boolean {
    if (payload.kind === 'text') {
      const applied = this.textCRDT.apply(payload.op);
      if (applied) {
        this.vectorClock.increment(payload.op.siteId);
      }
      return applied;
    } else if (payload.kind === 'shape') {
      const applied = this.shapeCRDT.apply(payload.op);
      if (applied) {
        this.vectorClock.increment(payload.op.siteId);
      }
      return applied;
    } else if (payload.kind === 'state-sync') {
      this.textCRDT.mergeState(payload.textState);
      this.shapeCRDT.mergeState(payload.shapeState);
      this.vectorClock.merge(VectorClock.fromJSON(payload.vectorClock));
      return true;
    }
    return false;
  }

  public exportState(): {
    textState: any[];
    shapeState: CanvasShape[];
    vectorClock: Record<string, number>;
  } {
    return {
      textState: this.textCRDT.getState(),
      shapeState: this.shapeCRDT.exportState(),
      vectorClock: this.vectorClock.toJSON()
    };
  }

  public getTextContent(): string {
    return this.textCRDT.toString();
  }

  public getShapes(): CanvasShape[] {
    return this.shapeCRDT.getAllShapes();
  }
}
