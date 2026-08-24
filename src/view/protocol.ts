/**
 * The host↔frame message protocol.
 *
 * Every message is validated on receipt on both sides. Origin checking cannot
 * do that job here: the frame has an opaque origin, so its messages arrive with
 * an origin of `'null'`, which authenticates nothing. What the host trusts is
 * the message *source* (it must be this frame's window) plus the shape below.
 */
export const PROTOCOL_VERSION = 1;

export interface Measurement {
  readonly width: number;
  readonly height: number;
}

export type HostMessage =
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'ping'; readonly id: number }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'measure'; readonly id: number };

export type FrameMessage =
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'ready' }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'pong'; readonly id: number }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'measured';
      readonly id: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'violation';
      readonly directive: string;
      readonly blockedUri: string;
    }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'error'; readonly message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function asFrameMessage(data: unknown): FrameMessage | null {
  const message = asRecord(data);
  if (message === null || message['v'] !== PROTOCOL_VERSION) return null;
  const id = message['id'];
  switch (message['type']) {
    case 'ready':
      return { v: PROTOCOL_VERSION, type: 'ready' };
    case 'pong':
      return typeof id === 'number' ? { v: PROTOCOL_VERSION, type: 'pong', id } : null;
    case 'measured': {
      const width = message['width'];
      const height = message['height'];
      if (typeof id !== 'number' || typeof width !== 'number' || typeof height !== 'number') return null;
      return { v: PROTOCOL_VERSION, type: 'measured', id, width, height };
    }
    case 'violation': {
      const directive = message['directive'];
      const blockedUri = message['blockedUri'];
      if (typeof directive !== 'string' || typeof blockedUri !== 'string') return null;
      return { v: PROTOCOL_VERSION, type: 'violation', directive, blockedUri };
    }
    case 'error': {
      const text = message['message'];
      return typeof text === 'string' ? { v: PROTOCOL_VERSION, type: 'error', message: text } : null;
    }
    default:
      return null;
  }
}

export function asHostMessage(data: unknown): HostMessage | null {
  const message = asRecord(data);
  if (message === null || message['v'] !== PROTOCOL_VERSION) return null;
  const id = message['id'];
  if (typeof id !== 'number') return null;
  const type = message['type'];
  if (type !== 'ping' && type !== 'measure') return null;
  return { v: PROTOCOL_VERSION, type, id };
}
