import { WebSocket } from 'ws';
import { PeerSyncServer, WireMessage } from '../src/sync/PeerSyncServer';

type FakeSocket = {
  readyState: number;
  send: jest.Mock;
};

function socket(): FakeSocket {
  return { readyState: WebSocket.OPEN, send: jest.fn() };
}

describe('PeerSyncServer room isolation', () => {
  let server: PeerSyncServer;

  beforeEach(() => {
    server = new PeerSyncServer();
  });

  function send(ws: FakeSocket, message: WireMessage): void {
    (server as any).processMessage(ws, message);
  }

  test('does not forward a message into a room the socket has not joined', () => {
    const sender = socket();
    const victim = socket();

    send(sender, { type: 'join', roomId: 'room-a', siteId: 'sender' });
    send(victim, { type: 'join', roomId: 'room-b', siteId: 'victim' });
    victim.send.mockClear();

    send(sender, {
      type: 'crdt-payload',
      roomId: 'room-b',
      siteId: 'sender',
      payload: {} as any
    });

    expect(victim.send).not.toHaveBeenCalled();
  });

  test('rejects a spoofed site id even when the room id is correct', () => {
    const sender = socket();
    const peer = socket();

    send(sender, { type: 'join', roomId: 'room-a', siteId: 'sender' });
    send(peer, { type: 'join', roomId: 'room-a', siteId: 'peer' });
    peer.send.mockClear();

    send(sender, {
      type: 'crdt-payload',
      roomId: 'room-a',
      siteId: 'impersonated-peer',
      payload: {} as any
    });

    expect(peer.send).not.toHaveBeenCalled();
  });

  test('removes previous room membership when a socket joins another room', () => {
    const moving = socket();
    const oldRoomPeer = socket();
    const newRoomPeer = socket();

    send(moving, { type: 'join', roomId: 'old-room', siteId: 'moving' });
    send(oldRoomPeer, { type: 'join', roomId: 'old-room', siteId: 'old-peer' });
    send(newRoomPeer, { type: 'join', roomId: 'new-room', siteId: 'new-peer' });
    oldRoomPeer.send.mockClear();
    newRoomPeer.send.mockClear();

    send(moving, { type: 'join', roomId: 'new-room', siteId: 'moving' });
    oldRoomPeer.send.mockClear();
    newRoomPeer.send.mockClear();

    send(moving, {
      type: 'crdt-payload',
      roomId: 'old-room',
      siteId: 'moving',
      payload: {} as any
    });
    expect(oldRoomPeer.send).not.toHaveBeenCalled();

    send(moving, {
      type: 'crdt-payload',
      roomId: 'new-room',
      siteId: 'moving',
      payload: {} as any
    });
    expect(newRoomPeer.send).toHaveBeenCalledTimes(1);
  });
});
