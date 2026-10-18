import { CRDTDocument } from '../src/crdt/CRDTDocument';
import { VectorClock } from '../src/sync/VectorClock';
import { UndoRedoManager } from '../src/sync/UndoRedoManager';
import { SpatialCollisionIndex } from '../src/canvas/SpatialCollisionIndex';
import { InfiniteCanvasRenderer, RenderContext2DLike } from '../src/canvas/InfiniteCanvasRenderer';

describe('State Convergence, Sync, Collision & Canvas Engine Tests', () => {
  describe('N-Peer Random Eventual Consistency', () => {
    test('3 peers generate random interleaved mutations and converge to identical state', () => {
      const N = 3;
      const peers: CRDTDocument[] = [];
      for (let i = 0; i < N; i++) {
        peers.push(new CRDTDocument('convergence-room', `peer-${i}`));
      }

      // Collect operations in an un-ordered network pool
      const networkQueue: any[] = [];

      peers[0].subscribe(p => networkQueue.push({ from: 0, payload: p }));
      peers[1].subscribe(p => networkQueue.push({ from: 1, payload: p }));
      peers[2].subscribe(p => networkQueue.push({ from: 2, payload: p }));

      // Peer 0 performs text inserts
      peers[0].insertText(0, 'ALPHA ');
      // Peer 1 performs text inserts
      peers[1].insertText(0, 'BETA ');
      // Peer 2 creates a shape
      peers[2].createShape('box-1', 'rectangle', { x: 50, y: 50 }, { fillColor: '#00ff00' });
      // Peer 0 creates a shape
      peers[0].createShape('box-2', 'circle', { x: 120, y: 120 });

      // Shuffle network messages to simulate arbitrary out-of-order delivery & packet delay
      for (let i = networkQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [networkQueue[i], networkQueue[j]] = [networkQueue[j], networkQueue[i]];
      }

      // Deliver all messages to other peers
      for (const item of networkQueue) {
        for (let target = 0; target < N; target++) {
          if (target !== item.from) {
            peers[target].applyRemotePayload(item.payload);
          }
        }
      }

      // Assert strong eventual consistency across all peers
      const text0 = peers[0].getTextContent();
      const text1 = peers[1].getTextContent();
      const text2 = peers[2].getTextContent();

      expect(text0).toBe(text1);
      expect(text1).toBe(text2);

      const shapes0 = peers[0].getShapes();
      const shapes1 = peers[1].getShapes();
      const shapes2 = peers[2].getShapes();

      expect(shapes0.length).toBe(2);
      expect(shapes1.length).toBe(2);
      expect(shapes2.length).toBe(2);

      expect(JSON.stringify(shapes0)).toBe(JSON.stringify(shapes1));
      expect(JSON.stringify(shapes1)).toBe(JSON.stringify(shapes2));
    });
  });

  describe('Vector Clock Causality Tracking', () => {
    test('tracks happens-before and concurrency correctly', () => {
      const vc1 = new VectorClock({ A: 1, B: 0 });
      const vc2 = new VectorClock({ A: 1, B: 1 });

      expect(vc1.compare(vc2)).toBe(-1); // vc1 < vc2
      expect(vc2.compare(vc1)).toBe(1);  // vc2 > vc1

      const vcConcurrent1 = new VectorClock({ A: 2, B: 0 });
      const vcConcurrent2 = new VectorClock({ A: 1, B: 1 });
      expect(vcConcurrent1.compare(vcConcurrent2)).toBeNull(); // concurrent

      vc1.merge(vcConcurrent1);
      expect(vc1.get('A')).toBe(2);
      expect(vc1.get('B')).toBe(0);
    });
  });

  describe('Undo/Redo Manager', () => {
    test('supports undo and redo stack semantics', () => {
      const undoMgr = new UndoRedoManager();
      let value = 0;

      undoMgr.record({
        id: 'inc-1',
        timestamp: Date.now(),
        undo: () => { value -= 10; },
        redo: () => { value += 10; },
        description: 'Add 10'
      });
      value += 10;

      expect(value).toBe(10);
      expect(undoMgr.canUndo()).toBe(true);

      undoMgr.undo();
      expect(value).toBe(0);
      expect(undoMgr.canRedo()).toBe(true);

      undoMgr.redo();
      expect(value).toBe(10);
    });
  });

  describe('Spatial Collision Index & Infinite Canvas Rendering', () => {
    test('bounding box calculation and point hit-testing', () => {
      const doc = new CRDTDocument('test-doc', 'test-site');
      doc.createShape('target-rect', 'rectangle', { x: 100, y: 100, scaleX: 1, scaleY: 1 });

      const shape = doc.shapeCRDT.getShape('target-rect')!;
      const aabb = SpatialCollisionIndex.calculateAABB(shape);

      expect(aabb.x).toBeLessThanOrEqual(100);
      expect(aabb.x + aabb.width).toBeGreaterThanOrEqual(100);

      // Hit test center
      expect(SpatialCollisionIndex.hitTestShape({ x: 100, y: 100 }, shape)).toBe(true);
      // Hit test outside
      expect(SpatialCollisionIndex.hitTestShape({ x: 500, y: 500 }, shape)).toBe(false);
    });

    test('infinite canvas viewport coordinates and pan/zoom', () => {
      const doc = new CRDTDocument('test-doc', 'test-site');
      const renderer = new InfiniteCanvasRenderer(doc, 800, 600);

      expect(renderer.viewport.zoom).toBe(1.0);
      expect(renderer.screenToWorldX(400)).toBe(0);
      expect(renderer.screenToWorldY(300)).toBe(0);

      renderer.panBy(100, 50);
      expect(renderer.viewport.x).toBe(100);
      expect(renderer.viewport.y).toBe(50);

      renderer.zoomAt(400, 300, 2.0);
      expect(renderer.viewport.zoom).toBe(2.0);
    });

    test('mock canvas render pass executes without error', () => {
      const doc = new CRDTDocument('test-doc', 'test-site');
      doc.insertText(0, 'Collaborative Canvas');
      doc.createShape('circle-1', 'circle', { x: 50, y: 50 });
      doc.createShape('code-1', 'code-block', { x: 200, y: 200 }, {}, 'const engine = true;');

      const renderer = new InfiniteCanvasRenderer(doc, 1920, 1080);
      renderer.selectShape('circle-1');

      const mockCtx: RenderContext2DLike = {
        save: jest.fn(),
        restore: jest.fn(),
        translate: jest.fn(),
        scale: jest.fn(),
        rotate: jest.fn(),
        clearRect: jest.fn(),
        fillRect: jest.fn(),
        strokeRect: jest.fn(),
        beginPath: jest.fn(),
        closePath: jest.fn(),
        arc: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        fill: jest.fn(),
        stroke: jest.fn(),
        fillText: jest.fn(),
        measureText: jest.fn().mockReturnValue({ width: 50 }),
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        font: '12px sans-serif',
        globalAlpha: 1.0
      };

      renderer.render(mockCtx);
      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    });
  });
});
