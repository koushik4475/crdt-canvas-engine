import { BoundingBox2D, CanvasShape } from '../crdt/ShapeCRDT';

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export class SpatialCollisionIndex {
  /**
   * Calculate precise 2D axis-aligned bounding box (AABB) taking into account 3D transforms, rotation, scale.
   */
  public static calculateAABB(shape: CanvasShape): BoundingBox2D {
    const t = shape.transform;
    const radZ = (t.rotationZ * Math.PI) / 180;
    const cosZ = Math.cos(radZ);
    const sinZ = Math.sin(radZ);

    let baseWidth = 100 * t.scaleX;
    let baseHeight = 100 * t.scaleY;

    if (shape.type === 'circle') {
      const radius = 50 * Math.max(t.scaleX, t.scaleY);
      return {
        x: t.x - radius,
        y: t.y - radius,
        width: radius * 2,
        height: radius * 2
      };
    } else if (shape.type === 'arrow' || shape.type === 'freehand') {
      if (shape.points && shape.points.length > 0) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const pt of shape.points) {
          const px = t.x + pt.x * t.scaleX;
          const py = t.y + pt.y * t.scaleY;
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
        }

        const padding = 10;
        return {
          x: minX - padding,
          y: minY - padding,
          width: Math.max(20, maxX - minX + padding * 2),
          height: Math.max(20, maxY - minY + padding * 2)
        };
      }
    } else if (shape.type === 'code-block' || shape.type === 'text') {
      baseWidth = Math.max(120, (shape.content?.length || 10) * 8.5) * t.scaleX;
      baseHeight = Math.max(60, ((shape.content?.split('\n').length || 1) * 20 + 20)) * t.scaleY;
    }

    // 4 local corners centered or top-left
    const halfW = baseWidth / 2;
    const halfH = baseHeight / 2;

    const corners = [
      { x: -halfW, y: -halfH },
      { x: halfW, y: -halfH },
      { x: halfW, y: halfH },
      { x: -halfW, y: halfH }
    ];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const c of corners) {
      const rotX = c.x * cosZ - c.y * sinZ + t.x;
      const rotY = c.x * sinZ + c.y * cosZ + t.y;

      minX = Math.min(minX, rotX);
      minY = Math.min(minY, rotY);
      maxX = Math.max(maxX, rotX);
      maxY = Math.max(maxY, rotY);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Check if a 2D point intersects a 2D AABB bounding box.
   */
  public static pointInAABB(point: Point2D, box: BoundingBox2D): boolean {
    return (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    );
  }

  /**
   * Check if two AABBs intersect.
   */
  public static intersects(a: BoundingBox2D, b: BoundingBox2D): boolean {
    return (
      a.x <= b.x + b.width &&
      a.x + a.width >= b.x &&
      a.y <= b.y + b.height &&
      a.y + a.height >= b.y
    );
  }

  /**
   * Check whether a point hits a shape taking into account its full transformation.
   */
  public static hitTestShape(point: Point2D, shape: CanvasShape): boolean {
    const aabb = this.calculateAABB(shape);
    if (!this.pointInAABB(point, aabb)) {
      return false;
    }

    const t = shape.transform;
    const dx = point.x - t.x;
    const dy = point.y - t.y;

    // Inverse rotate point to object local space
    const radZ = (-t.rotationZ * Math.PI) / 180;
    const localX = (dx * Math.cos(radZ) - dy * Math.sin(radZ)) / (t.scaleX || 1);
    const localY = (dx * Math.sin(radZ) + dy * Math.cos(radZ)) / (t.scaleY || 1);

    if (shape.type === 'circle') {
      const radius = 50;
      return localX * localX + localY * localY <= radius * radius;
    } else if (shape.type === 'rectangle' || shape.type === 'text' || shape.type === 'code-block') {
      const halfW = (aabb.width / (t.scaleX || 1)) / 2;
      const halfH = (aabb.height / (t.scaleY || 1)) / 2;
      return Math.abs(localX) <= halfW && Math.abs(localY) <= halfH;
    }

    return true;
  }
}
