/**
 * Shape types supported by the Infinite 2D/3D Canvas CRDT.
 */
export type CanvasShapeType = 'rectangle' | 'circle' | 'text' | 'code-block' | 'arrow' | 'freehand';

export interface BoundingBox2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform3D {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export interface ShapeStyle {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
  lineDash?: number[];
  borderRadius?: number;
}

export interface CanvasShape {
  id: string;
  type: CanvasShapeType;
  transform: Transform3D;
  style: ShapeStyle;
  content?: string; // Text content, code snippet, or svg path points
  points?: Array<{ x: number; y: number; z?: number }>; // For arrows and freehand
  zIndex: number;
  createdBy: string;
  lastModifiedBy: string;
  lamportTimestamp: number;
  isDeleted: boolean;
  metadata?: Record<string, unknown>;
}

export type ShapeOperation =
  | {
      type: 'shape-create';
      shape: CanvasShape;
      siteId: string;
      lamport: number;
      timestamp: number;
    }
  | {
      type: 'shape-update';
      shapeId: string;
      patch: Partial<Omit<CanvasShape, 'id' | 'createdBy'>>;
      siteId: string;
      lamport: number;
      timestamp: number;
    }
  | {
      type: 'shape-delete';
      shapeId: string;
      siteId: string;
      lamport: number;
      timestamp: number;
    };

/**
 * State-based and Operation-based Shape CRDT Map with Last-Write-Wins (LWW) Register resolution per field.
 */
export class ShapeCRDTMap {
  private shapes: Map<string, CanvasShape> = new Map();
  // Field-level LWW registers: shapeId -> fieldKey -> { lamport, timestamp, siteId }
  private fieldTimestamps: Map<string, Map<string, { lamport: number; timestamp: number; siteId: string }>> = new Map();
  public readonly siteId: string;
  private lamportClock: number = 0;

  constructor(siteId: string) {
    this.siteId = siteId;
  }

  public getLamport(): number {
    return this.lamportClock;
  }

  public advanceLamport(): number {
    return ++this.lamportClock;
  }

  public getShape(id: string): CanvasShape | undefined {
    const shape = this.shapes.get(id);
    if (!shape || shape.isDeleted) return undefined;
    return JSON.parse(JSON.stringify(shape));
  }

  public getAllShapes(): CanvasShape[] {
    return Array.from(this.shapes.values())
      .filter(s => !s.isDeleted)
      .sort((a, b) => {
        if (a.zIndex !== b.zIndex) {
          return a.zIndex - b.zIndex;
        }
        return a.id.localeCompare(b.id);
      });
  }

  public createShape(
    id: string,
    type: CanvasShapeType,
    transform: Partial<Transform3D>,
    style: ShapeStyle = {},
    content?: string,
    points?: Array<{ x: number; y: number; z?: number }>
  ): ShapeOperation {
    const lamport = this.advanceLamport();
    const now = Date.now();

    const fullTransform: Transform3D = {
      x: transform.x ?? 0,
      y: transform.y ?? 0,
      z: transform.z ?? 0,
      rotationX: transform.rotationX ?? 0,
      rotationY: transform.rotationY ?? 0,
      rotationZ: transform.rotationZ ?? 0,
      scaleX: transform.scaleX ?? 1,
      scaleY: transform.scaleY ?? 1,
      scaleZ: transform.scaleZ ?? 1
    };

    const shape: CanvasShape = {
      id,
      type,
      transform: fullTransform,
      style: {
        fillColor: '#3b82f6',
        strokeColor: '#1d4ed8',
        strokeWidth: 2,
        opacity: 1,
        ...style
      },
      content: content || '',
      points: points || [],
      zIndex: this.shapes.size + 1,
      createdBy: this.siteId,
      lastModifiedBy: this.siteId,
      lamportTimestamp: lamport,
      isDeleted: false
    };

    const op: ShapeOperation = {
      type: 'shape-create',
      shape,
      siteId: this.siteId,
      lamport,
      timestamp: now
    };

    this.apply(op);
    return op;
  }

  public updateShape(shapeId: string, patch: Partial<Omit<CanvasShape, 'id' | 'createdBy'>>): ShapeOperation | null {
    const existing = this.shapes.get(shapeId);
    if (!existing || existing.isDeleted) {
      return null;
    }

    const lamport = this.advanceLamport();
    const now = Date.now();

    const op: ShapeOperation = {
      type: 'shape-update',
      shapeId,
      patch,
      siteId: this.siteId,
      lamport,
      timestamp: now
    };

    this.apply(op);
    return op;
  }

  public deleteShape(shapeId: string): ShapeOperation | null {
    const existing = this.shapes.get(shapeId);
    if (!existing || existing.isDeleted) {
      return null;
    }

    const lamport = this.advanceLamport();
    const now = Date.now();

    const op: ShapeOperation = {
      type: 'shape-delete',
      shapeId,
      siteId: this.siteId,
      lamport,
      timestamp: now
    };

    this.apply(op);
    return op;
  }

  /**
   * Apply CRDT operation with LWW register arbitration.
   */
  public apply(op: ShapeOperation): boolean {
    if (op.lamport > this.lamportClock) {
      this.lamportClock = op.lamport;
    }

    if (op.type === 'shape-create') {
      const existing = this.shapes.get(op.shape.id);
      if (!existing) {
        this.shapes.set(op.shape.id, JSON.parse(JSON.stringify(op.shape)));
        this.recordAllFieldTimestamps(op.shape.id, op.lamport, op.timestamp, op.siteId);
        return true;
      }
      return false;
    } else if (op.type === 'shape-update') {
      const existing = this.shapes.get(op.shapeId);
      if (!existing || existing.isDeleted) {
        return false;
      }

      let modified = false;
      let fieldMap = this.fieldTimestamps.get(op.shapeId);
      if (!fieldMap) {
        fieldMap = new Map();
        this.fieldTimestamps.set(op.shapeId, fieldMap);
      }

      for (const [key, value] of Object.entries(op.patch)) {
        if (this.shouldOverwriteField(fieldMap.get(key), op.lamport, op.timestamp, op.siteId)) {
          if (key === 'transform') {
            existing.transform = { ...existing.transform, ...(value as Transform3D) };
          } else if (key === 'style') {
            existing.style = { ...existing.style, ...(value as ShapeStyle) };
          } else {
            (existing as any)[key] = value;
          }
          fieldMap.set(key, { lamport: op.lamport, timestamp: op.timestamp, siteId: op.siteId });
          modified = true;
        }
      }

      if (modified) {
        if (op.lamport > existing.lamportTimestamp ||
           (op.lamport === existing.lamportTimestamp && op.siteId > existing.lastModifiedBy)) {
          existing.lastModifiedBy = op.siteId;
          existing.lamportTimestamp = op.lamport;
        }
      }
      return modified;
    } else if (op.type === 'shape-delete') {
      const existing = this.shapes.get(op.shapeId);
      let fieldMap = this.fieldTimestamps.get(op.shapeId);
      if (!fieldMap) {
        fieldMap = new Map();
        this.fieldTimestamps.set(op.shapeId, fieldMap);
      }

      if (this.shouldOverwriteField(fieldMap.get('isDeleted'), op.lamport, op.timestamp, op.siteId)) {
        if (existing) {
          existing.isDeleted = true;
          existing.lamportTimestamp = Math.max(existing.lamportTimestamp, op.lamport);
          existing.lastModifiedBy = op.siteId;
        } else {
          // Record tombstone
          this.shapes.set(op.shapeId, {
            id: op.shapeId,
            type: 'rectangle',
            transform: { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
            style: {},
            zIndex: 0,
            createdBy: op.siteId,
            lastModifiedBy: op.siteId,
            lamportTimestamp: op.lamport,
            isDeleted: true
          });
        }
        fieldMap.set('isDeleted', { lamport: op.lamport, timestamp: op.timestamp, siteId: op.siteId });
        return true;
      }
      return false;
    }

    return false;
  }

  private shouldOverwriteField(
    current: { lamport: number; timestamp: number; siteId: string } | undefined,
    incomingLamport: number,
    incomingTimestamp: number,
    incomingSiteId: string
  ): boolean {
    if (!current) return true;
    if (incomingLamport !== current.lamport) {
      return incomingLamport > current.lamport;
    }
    if (incomingTimestamp !== current.timestamp) {
      return incomingTimestamp > current.timestamp;
    }
    return incomingSiteId > current.siteId; // deterministic tie-breaker
  }

  private recordAllFieldTimestamps(shapeId: string, lamport: number, timestamp: number, siteId: string): void {
    let fieldMap = this.fieldTimestamps.get(shapeId);
    if (!fieldMap) {
      fieldMap = new Map();
      this.fieldTimestamps.set(shapeId, fieldMap);
    }
    const fields = ['type', 'transform', 'style', 'content', 'points', 'zIndex', 'isDeleted'];
    for (const f of fields) {
      fieldMap.set(f, { lamport, timestamp, siteId });
    }
  }

  public exportState(): CanvasShape[] {
    return Array.from(this.shapes.values());
  }

  public mergeState(remoteShapes: CanvasShape[]): void {
    for (const shape of remoteShapes) {
      const existing = this.shapes.get(shape.id);
      if (!existing) {
        this.shapes.set(shape.id, JSON.parse(JSON.stringify(shape)));
        this.recordAllFieldTimestamps(shape.id, shape.lamportTimestamp, Date.now(), shape.lastModifiedBy);
      } else {
        if (shape.lamportTimestamp > existing.lamportTimestamp ||
            (shape.lamportTimestamp === existing.lamportTimestamp && shape.lastModifiedBy > existing.lastModifiedBy)) {
          this.shapes.set(shape.id, JSON.parse(JSON.stringify(shape)));
          this.recordAllFieldTimestamps(shape.id, shape.lamportTimestamp, Date.now(), shape.lastModifiedBy);
        }
      }
    }
  }
}
