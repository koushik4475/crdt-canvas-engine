import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { CRDTPayload } from '../crdt/CRDTDocument';

export interface PeerClient {
  id: string;
  roomId: string;
  ws: WebSocket;
  lastSeen: number;
  userName?: string;
  cursor?: { x: number; y: number; z?: number };
}

export type WireMessage =
  | { type: 'join'; roomId: string; siteId: string; userName?: string }
  | { type: 'leave'; roomId: string; siteId: string }
  | { type: 'crdt-payload'; roomId: string; siteId: string; payload: CRDTPayload }
  | { type: 'awareness'; roomId: string; siteId: string; cursor: { x: number; y: number; z?: number }; selection?: string[] }
  | { type: 'request-state'; roomId: string; siteId: string }
  | { type: 'sync-state'; roomId: string; siteId: string; state: any };

export class PeerSyncServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, PeerClient> = new Map();
  private rooms: Map<string, Set<WebSocket>> = new Map();
  private roomStates: Map<string, any> = new Map();

  constructor(private port: number = 8080) {}

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port }, () => resolve());
      this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        this.handleConnection(ws, req);
      });
      this.wss.on('error', reject);
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          this.wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    ws.on('message', (data: Buffer | string) => {
      try {
        const msg: WireMessage = JSON.parse(data.toString());
        this.processMessage(ws, msg);
      } catch (err) {
        console.error('Failed to parse incoming WebSocket message:', err);
      }
    });

    ws.on('close', () => this.removeClient(ws));
    ws.on('error', (err) => {
      console.error('WebSocket client error:', err);
      this.removeClient(ws);
    });
  }

  private processMessage(ws: WebSocket, msg: WireMessage): void {
    if (msg.type === 'join') {
      if (
        typeof msg.roomId !== 'string' || msg.roomId.trim().length === 0 ||
        typeof msg.siteId !== 'string' || msg.siteId.trim().length === 0
      ) {
        return;
      }

      // A socket may belong to only one room. Remove any previous membership
      // before accepting a new join so it cannot retain access to old rooms.
      this.removeClient(ws);
      const client: PeerClient = {
        id: msg.siteId,
        roomId: msg.roomId,
        ws,
        lastSeen: Date.now(),
        userName: msg.userName
      };
      this.clients.set(ws, client);

      if (!this.rooms.has(msg.roomId)) this.rooms.set(msg.roomId, new Set());
      this.rooms.get(msg.roomId)!.add(ws);

      this.broadcastToRoom(msg.roomId, ws, msg);
      const existingState = this.roomStates.get(msg.roomId);
      if (existingState !== undefined) {
        ws.send(JSON.stringify({
          type: 'sync-state',
          roomId: msg.roomId,
          siteId: 'SERVER',
          state: existingState
        }));
      }
      return;
    }

    // Never trust room/site identifiers supplied by the wire message. They
    // must match the membership established for this exact socket at join.
    const client = this.clients.get(ws);
    if (!client || msg.roomId !== client.roomId || msg.siteId !== client.id) {
      return;
    }

    switch (msg.type) {
      case 'crdt-payload':
      case 'awareness':
        if (msg.type === 'awareness') {
          client.cursor = msg.cursor;
          client.lastSeen = Date.now();
        }
        this.broadcastToRoom(client.roomId, ws, msg);
        break;

      case 'sync-state':
        this.roomStates.set(client.roomId, msg.state);
        this.broadcastToRoom(client.roomId, ws, msg);
        break;

      case 'request-state': {
        const roomPeers = this.rooms.get(client.roomId);
        if (roomPeers && roomPeers.size > 1) {
          for (const peer of roomPeers) {
            if (peer !== ws && peer.readyState === WebSocket.OPEN) {
              peer.send(JSON.stringify(msg));
              break;
            }
          }
        }
        break;
      }

      case 'leave':
        this.removeClient(ws);
        break;
    }
  }

  private broadcastToRoom(roomId: string, sender: WebSocket, msg: WireMessage): void {
    const peers = this.rooms.get(roomId);
    if (!peers) return;
    const payload = JSON.stringify(msg);
    for (const peer of peers) {
      if (peer !== sender && peer.readyState === WebSocket.OPEN) peer.send(payload);
    }
  }

  private removeClient(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;
    const roomPeers = this.rooms.get(client.roomId);
    if (roomPeers) {
      roomPeers.delete(ws);
      if (roomPeers.size === 0) {
        this.rooms.delete(client.roomId);
      } else {
        this.broadcastToRoom(client.roomId, ws, {
          type: 'leave',
          roomId: client.roomId,
          siteId: client.id
        });
      }
    }
    this.clients.delete(ws);
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
  }
}
