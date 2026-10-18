import { CanvasShape, BoundingBox2D } from '../crdt/ShapeCRDT';
import { SpatialCollisionIndex } from './SpatialCollisionIndex';
import { CRDTDocument } from '../crdt/CRDTDocument';

export interface CameraViewport {
  x: number;
  y: number;
  zoom: number;
  pitch: number; // 3D tilt angle in degrees
  yaw: number;   // 3D rotation angle in degrees
  width: number;
  height: number;
}

export interface RenderContext2DLike {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  fillStyle: string | any;
  strokeStyle: string | any;
  lineWidth: number;
  font: string;
  globalAlpha: number;
}

export class InfiniteCanvasRenderer {
  public viewport: CameraViewport;
  private doc: CRDTDocument;
  private selectedShapeIds: Set<string> = new Set();

  constructor(doc: CRDTDocument, width: number = 1920, height: number = 1080) {
    this.doc = doc;
    this.viewport = {
      x: 0,
      y: 0,
      zoom: 1.0,
      pitch: 0,
      yaw: 0,
      width,
      height
    };
  }

  public setViewportSize(width: number, height: number): void {
    this.viewport.width = width;
    this.viewport.height = height;
  }

  public panBy(deltaX: number, deltaY: number): void {
    this.viewport.x += deltaX / this.viewport.zoom;
    this.viewport.y += deltaY / this.viewport.zoom;
  }

  public zoomAt(screenX: number, screenY: number, factor: number): void {
    const minZoom = 0.05;
    const maxZoom = 25.0;
    const oldZoom = this.viewport.zoom;
    const newZoom = Math.min(Math.max(oldZoom * factor, minZoom), maxZoom);

    if (newZoom === oldZoom) return;

    // Zoom centered around mouse coordinate
    const worldX = this.screenToWorldX(screenX);
    const worldY = this.screenToWorldY(screenY);

    this.viewport.zoom = newZoom;

    this.viewport.x = worldX - (screenX - this.viewport.width / 2) / newZoom;
    this.viewport.y = worldY - (screenY - this.viewport.height / 2) / newZoom;
  }

  public screenToWorldX(screenX: number): number {
    return this.viewport.x + (screenX - this.viewport.width / 2) / this.viewport.zoom;
  }

  public screenToWorldY(screenY: number): number {
    return this.viewport.y + (screenY - this.viewport.height / 2) / this.viewport.zoom;
  }

  public worldToScreenX(worldX: number): number {
    return (worldX - this.viewport.x) * this.viewport.zoom + this.viewport.width / 2;
  }

  public worldToScreenY(worldY: number): number {
    return (worldY - this.viewport.y) * this.viewport.zoom + this.viewport.height / 2;
  }

  public getVisibleWorldBounds(): BoundingBox2D {
    const halfW = (this.viewport.width / 2) / this.viewport.zoom;
    const halfH = (this.viewport.height / 2) / this.viewport.zoom;
    return {
      x: this.viewport.x - halfW,
      y: this.viewport.y - halfH,
      width: halfW * 2,
      height: halfH * 2
    };
  }

  public selectShape(id: string, multi: boolean = false): void {
    if (!multi) {
      this.selectedShapeIds.clear();
    }
    this.selectedShapeIds.add(id);
  }

  public deselectShape(id: string): void {
    this.selectedShapeIds.delete(id);
  }

  public clearSelection(): void {
    this.selectedShapeIds.clear();
  }

  public getSelectedShapes(): string[] {
    return Array.from(this.selectedShapeIds);
  }

  public queryShapeAt(worldX: number, worldY: number): CanvasShape | null {
    const shapes = this.doc.getShapes();
    // Search in reverse z-index (topmost first)
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (SpatialCollisionIndex.hitTestShape({ x: worldX, y: worldY }, s)) {
        return s;
      }
    }
    return null;
  }

  /**
   * Render infinite grid, shapes, and collaborative bounding markers.
   */
  public render(ctx: RenderContext2DLike): void {
    ctx.save();

    // Clear canvas
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);

    // Apply Camera Transform
    ctx.translate(this.viewport.width / 2, this.viewport.height / 2);
    ctx.scale(this.viewport.zoom, this.viewport.zoom);
    ctx.translate(-this.viewport.x, -this.viewport.y);

    // Render Infinite Background Grid
    this.renderGrid(ctx);

    // Render Shapes with frustum/viewport culling
    const viewportBounds = this.getVisibleWorldBounds();
    const shapes = this.doc.getShapes();

    for (const shape of shapes) {
      const aabb = SpatialCollisionIndex.calculateAABB(shape);
      if (SpatialCollisionIndex.intersects(viewportBounds, aabb)) {
        this.renderShape(ctx, shape);
      }
    }

    // Render selection indicators
    for (const selectedId of this.selectedShapeIds) {
      const shape = this.doc.shapeCRDT.getShape(selectedId);
      if (shape) {
        this.renderSelectionOutline(ctx, shape);
      }
    }

    ctx.restore();
  }

  private renderGrid(ctx: RenderContext2DLike): void {
    const bounds = this.getVisibleWorldBounds();
    const gridSize = 50;

    const startX = Math.floor(bounds.x / gridSize) * gridSize;
    const endX = Math.ceil((bounds.x + bounds.width) / gridSize) * gridSize;
    const startY = Math.floor(bounds.y / gridSize) * gridSize;
    const endY = Math.ceil((bounds.y + bounds.height) / gridSize) * gridSize;

    ctx.save();
    ctx.lineWidth = 1 / this.viewport.zoom;
    ctx.strokeStyle = '#e2e8f0';

    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
      ctx.moveTo(x, bounds.y);
      ctx.lineTo(x, bounds.y + bounds.height);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.moveTo(bounds.x, y);
      ctx.lineTo(bounds.x + bounds.width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private renderShape(ctx: RenderContext2DLike, shape: CanvasShape): void {
    ctx.save();
    const t = shape.transform;
    ctx.translate(t.x, t.y);
    ctx.rotate((t.rotationZ * Math.PI) / 180);
    ctx.scale(t.scaleX, t.scaleY);

    ctx.fillStyle = shape.style.fillColor || '#3b82f6';
    ctx.strokeStyle = shape.style.strokeColor || '#1d4ed8';
    ctx.lineWidth = shape.style.strokeWidth || 2;
    ctx.globalAlpha = shape.style.opacity ?? 1.0;

    if (shape.type === 'rectangle') {
      ctx.fillRect(-50, -50, 100, 100);
      ctx.strokeRect(-50, -50, 100, 100);
    } else if (shape.type === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, 50, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (shape.type === 'text') {
      ctx.font = `${shape.style.fontSize || 16}px ${shape.style.fontFamily || 'Inter, sans-serif'}`;
      ctx.fillText(shape.content || '', -40, 0);
    } else if (shape.type === 'code-block') {
      // Render code-block frame and text
      ctx.fillStyle = '#1e1e2e';
      ctx.fillRect(-80, -40, 160, 80);
      ctx.strokeRect(-80, -40, 160, 80);
      ctx.fillStyle = '#a6adc8';
      ctx.font = '12px "Fira Code", monospace';
      ctx.fillText(shape.content || 'const x = 42;', -70, 0);
    } else if (shape.type === 'arrow' && shape.points && shape.points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(shape.points[i].x, shape.points[i].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private renderSelectionOutline(ctx: RenderContext2DLike, shape: CanvasShape): void {
    const aabb = SpatialCollisionIndex.calculateAABB(shape);
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2 / this.viewport.zoom;
    ctx.strokeRect(aabb.x - 4, aabb.y - 4, aabb.width + 8, aabb.height + 8);
    ctx.restore();
  }
}
