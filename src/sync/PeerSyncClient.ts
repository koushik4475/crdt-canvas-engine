import { WebSocket } from 'ws';
import { CRDTDocument, CRDTPayload } from '../crdt/CRDTDocument';
import { WireMessage } from './PeerSyncServer';

export interface PeerClientOptions {
  serverUrl: string;
  roomId: string;
  siteId: string;
  userName?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export type AwarenessUpdateHandler = (data: { siteId: string; cursor: { x: number; y: number; z?: number }; selection?: string[] }) => void;

export class PeerSyncClient {
  public readonly siteId: string;
  public readonly roomId: string;
  private serverUrl: string;
  private ws: WebSocket | null = null;
  private doc: CRDTDocument;
  private isConnected: boolean = false;
  private awarenessListeners: AwarenessUpdateHandler[] = [];
  private peerJoinedListeners: Array<(siteId: string, userName?: string) => void> = [];
  private peerLeftListeners: Array<(siteId: string) => void> = [];
  private unsubscribeDoc?: () => void;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number;
  private reconnectInterval: number;
  private explicitDisconnect: boolean = false;

  constructor(doc: CRDTDocument, options: PeerClientOptions) {
    this.doc = doc;
    this.siteId = options.siteId;
    this.roomId = options.roomId;
    this.serverUrl = options.serverUrl;
    this.reconnectInterval = options.reconnectInterval || 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;

    // Listen to local CRDT modifications and broadcast
    this.unsubscribeDoc = this.doc.subscribe((payload: CRDTPayload) => {
      this.sendPayload(payload);
    });
  }

  public connect(): Promise<void> {
    this.explicitDisconnect = false;
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.on('open', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;

          // Announce join
          const joinMsg: WireMessage = {
            type: 'join',
            roomId: this.roomId,
            siteId: this.siteId
          };
          this.ws?.send(JSON.stringify(joinMsg));

          // Request state synchronization
          const reqMsg: WireMessage = {
            type: 'request-state',
            roomId: this.roomId,
            siteId: this.siteId
          };
          this.ws?.send(JSON.stringify(reqMsg));

          resolve();
        });

        this.ws.on('message', (data: Buffer | string) => {
          this.handleIncoming(data.toString());
        });

        this.ws.on('close', () => {
          this.isConnected = false;
          if (!this.explicitDisconnect) {
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (err) => {
          if (!this.isConnected) {
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public disconnect(): void {
    this.explicitDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.unsubscribeDoc) {
      this.unsubscribeDoc();
      this.unsubscribeDoc = undefined;
    }
    if (this.ws) {
      if (this.isConnected) {
        const leaveMsg: WireMessage = {
          type: 'leave',
          roomId: this.roomId,
          siteId: this.siteId
        };
        try {
          this.ws.send(JSON.stringify(leaveMsg));
        } catch {
          // ignore send error on close
        }
      }
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, this.reconnectInterval);
  }

  public sendPayload(payload: CRDTPayload): void {
    if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      const msg: WireMessage = {
        type: 'crdt-payload',
        roomId: this.roomId,
        siteId: this.siteId,
        payload
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  public sendAwareness(cursor: { x: number; y: number; z?: number }, selection?: string[]): void {
    if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      const msg: WireMessage = {
        type: 'awareness',
        roomId: this.roomId,
        siteId: this.siteId,
        cursor,
        selection
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleIncoming(dataStr: string): void {
    try {
      const msg: WireMessage = JSON.parse(dataStr);
      if (msg.roomId !== this.roomId) return;
      if (msg.siteId === this.siteId) return; // Ignore echoes

      switch (msg.type) {
        case 'crdt-payload': {
          this.doc.applyRemotePayload(msg.payload);
          break;
        }

        case 'request-state': {
          // Send back current state
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const resp: WireMessage = {
              type: 'sync-state',
              roomId: this.roomId,
              siteId: this.siteId,
              state: this.doc.exportState()
            };
            this.ws.send(JSON.stringify(resp));
          }
          break;
        }

        case 'sync-state': {
          if (msg.state) {
            this.doc.applyRemotePayload({
              kind: 'state-sync',
              textState: msg.state.textState,
              shapeState: msg.state.shapeState,
              vectorClock: msg.state.vectorClock
            });
          }
          break;
        }

        case 'awareness': {
          for (const listener of this.awarenessListeners) {
            listener({ siteId: msg.siteId, cursor: msg.cursor, selection: msg.selection });
          }
          break;
        }

        case 'join': {
          for (const listener of this.peerJoinedListeners) {
            listener(msg.siteId, msg.userName);
          }
          break;
        }

        case 'leave': {
          for (const listener of this.peerLeftListeners) {
            listener(msg.siteId);
          }
          break;
        }
      }
    } catch (err) {
      console.error('Failed to parse incoming peer message:', err);
    }
  }

  public onAwareness(listener: AwarenessUpdateHandler): () => void {
    this.awarenessListeners.push(listener);
    return () => {
      this.awarenessListeners = this.awarenessListeners.filter(l => l !== listener);
    };
  }

  public onPeerJoined(listener: (siteId: string, userName?: string) => void): () => void {
    this.peerJoinedListeners.push(listener);
    return () => {
      this.peerJoinedListeners = this.peerJoinedListeners.filter(l => l !== listener);
    };
  }

  public onPeerLeft(listener: (siteId: string) => void): () => void {
    this.peerLeftListeners.push(listener);
    return () => {
      this.peerLeftListeners = this.peerLeftListeners.filter(l => l !== listener);
    };
  }

  public getOnlineStatus(): boolean {
    return this.isConnected;
  }
}
