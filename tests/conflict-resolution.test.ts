import { LogootSequence } from '../src/crdt/LogootSequence';
import { allocatePositionBetween, comparePositions, START_POS, END_POS } from '../src/crdt/LogootPosition';
import { ShapeCRDTMap } from '../src/crdt/ShapeCRDT';
import { CRDTDocument } from '../src/crdt/CRDTDocument';

describe('Concurrent Editing and Conflict Resolution Tests', () => {
  describe('Logoot Position Ordering', () => {
    test('allocates positions maintaining strict total order', () => {
      let prev = START_POS;
      const positions = [START_POS];

      for (let i = 0; i < 20; i++) {
        const next = allocatePositionBetween(prev, END_POS, `site-${i % 3}`, i + 1);
        expect(comparePositions(prev, next)).toBeLessThan(0);
        expect(comparePositions(next, END_POS)).toBeLessThan(0);
        positions.push(next);
        prev = next;
      }
    });

    test('allocates dense positions between closely adjacent elements', () => {
      const p1 = allocatePositionBetween(START_POS, END_POS, 'site-A', 1);
      const p2 = allocatePositionBetween(p1, END_POS, 'site-A', 2);
      const pBetween = allocatePositionBetween(p1, p2, 'site-B', 1);

      expect(comparePositions(p1, pBetween)).toBeLessThan(0);
      expect(comparePositions(pBetween, p2)).toBeLessThan(0);
    });
  });

  describe('Concurrent Text Editing Conflict Resolution', () => {
    test('two sites concurrently inserting at same visible index', () => {
      const peerA = new LogootSequence<string>('peer-A');
      const peerB = new LogootSequence<string>('peer-B');

      // Base document has "AC"
      const op1 = peerA.insertAt(0, 'A');
      const op2 = peerA.insertAt(1, 'C');
      peerB.apply(op1);
      peerB.apply(op2);

      expect(peerA.toString()).toBe('AC');
      expect(peerB.toString()).toBe('AC');

      // Concurrent insert at index 1: Peer A inserts 'B1', Peer B inserts 'B2'
      const opA = peerA.insertAt(1, 'X');
      const opB = peerB.insertAt(1, 'Y');

      // Exchange operations
      peerA.apply(opB);
      peerB.apply(opA);

      // Both must converge to the EXACT same text sequence
      expect(peerA.toString()).toBe(peerB.toString());
      expect(peerA.length()).toBe(4);
      expect(peerB.length()).toBe(4);
    });

    test('concurrent insert and delete resolution', () => {
      const peerA = new LogootSequence<string>('peer-A');
      const peerB = new LogootSequence<string>('peer-B');

      // Initialize with "HELLO"
      for (const char of 'HELLO') {
        const op = peerA.insertAt(peerA.length(), char);
        peerB.apply(op);
      }

      // Peer A deletes 'E' at index 1
      const delOp = peerA.deleteAt(1);

      // Peer B concurrently inserts '!' at index 2 (after 'E')
      const insOp = peerB.insertAt(2, '!');

      // Replicate
      peerA.apply(insOp);
      peerB.apply(delOp);

      expect(peerA.toString()).toBe(peerB.toString());
      expect(peerA.toString()).toContain('H');
      expect(peerA.toString()).toContain('!');
      expect(peerA.toString()).not.toContain('E');
    });
  });

  describe('Concurrent Shape CRDT LWW Resolution', () => {
    test('concurrent modifications to distinct shape fields merge cleanly', () => {
      const site1 = new ShapeCRDTMap('site-1');
      const site2 = new ShapeCRDTMap('site-2');

      const createOp = site1.createShape('shape-rect-1', 'rectangle', { x: 100, y: 100 });
      site2.apply(createOp);

      // Site 1 updates position
      const op1 = site1.updateShape('shape-rect-1', {
        transform: { x: 250, y: 350, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }
      })!;

      // Site 2 concurrently updates fill color
      const op2 = site2.updateShape('shape-rect-1', {
        style: { fillColor: '#ff0000' }
      })!;

      // Cross apply
      site1.apply(op2);
      site2.apply(op1);

      const s1 = site1.getShape('shape-rect-1')!;
      const s2 = site2.getShape('shape-rect-1')!;

      expect(s1.transform.x).toBe(250);
      expect(s1.transform.y).toBe(350);
      expect(s1.style.fillColor).toBe('#ff0000');
      expect(s2).toEqual(s1);
    });

    test('concurrent updates to same field resolve deterministically via Lamport & siteId', () => {
      const siteA = new ShapeCRDTMap('site-A');
      const siteB = new ShapeCRDTMap('site-B');

      const createOp = siteA.createShape('shape-circle-1', 'circle', { x: 50, y: 50 });
      siteB.apply(createOp);

      const opA = siteA.updateShape('shape-circle-1', {
        style: { fillColor: '#111111' }
      })!;

      const opB = siteB.updateShape('shape-circle-1', {
        style: { fillColor: '#999999' }
      })!;

      siteA.apply(opB);
      siteB.apply(opA);

      const sA = siteA.getShape('shape-circle-1')!;
      const sB = siteB.getShape('shape-circle-1')!;

      expect(sA.style.fillColor).toBe(sB.style.fillColor);
    });
  });

  describe('Composite CRDT Document Convergence', () => {
    test('text and shapes converge across multiple peers', () => {
      const docA = new CRDTDocument('doc-test', 'peer-A');
      const docB = new CRDTDocument('doc-test', 'peer-B');

      docA.subscribe(p => docB.applyRemotePayload(p));
      docB.subscribe(p => docA.applyRemotePayload(p));

      docA.insertText(0, 'Hello World');
      docB.createShape('code-1', 'code-block', { x: 200, y: 300 }, {}, 'console.log("CRDT Canvas");');

      expect(docA.getTextContent()).toBe('Hello World');
      expect(docB.getTextContent()).toBe('Hello World');

      expect(docA.getShapes().length).toBe(1);
      expect(docB.getShapes().length).toBe(1);
      expect(docA.getShapes()[0].content).toBe('console.log("CRDT Canvas");');
    });
  });
});
