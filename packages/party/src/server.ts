import type * as Party from "partykit/server";

const MAX_MESSAGE_BYTES = 512 * 1024;
const MAX_PEER_LABEL_LENGTH = 32;
const MAX_PROJECTS_PER_MESSAGE = 64;

type FleetSyncPayload = {
  type: "fleet-sync";
  peerId: string;
  peerLabel?: string;
  nickname?: string;
  sentAt?: string;
  projects: unknown[];
};

function normalizedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

function parseFleetSyncPayload(message: string): FleetSyncPayload | null {
  if (message.length === 0 || message.length > MAX_MESSAGE_BYTES) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(message);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  if (candidate.type !== "fleet-sync" || !Array.isArray(candidate.projects)) {
    return null;
  }

  const peerId = normalizedText(candidate.peerId, 128);
  if (!peerId) {
    return null;
  }

  return {
    type: "fleet-sync",
    peerId,
    peerLabel: normalizedText(candidate.peerLabel, MAX_PEER_LABEL_LENGTH) ?? undefined,
    nickname: normalizedText(candidate.nickname, 12) ?? undefined,
    sentAt: normalizedText(candidate.sentAt, 64) ?? undefined,
    projects: candidate.projects.slice(0, MAX_PROJECTS_PER_MESSAGE)
  };
}

export default class Server implements Party.Server {
  readonly options = {
    hibernate: true
  };

  constructor(readonly room: Party.Room) {}

  onConnect(connection: Party.Connection): void {
    connection.send(
      JSON.stringify({
        type: "room-status",
        room: this.room.id,
        connections: Array.from(this.room.getConnections()).length
      })
    );
  }

  onMessage(message: string | ArrayBuffer, _sender: Party.Connection): void {
    if (typeof message !== "string") {
      return;
    }

    const payload = parseFleetSyncPayload(message);
    if (!payload) {
      return;
    }

    this.room.broadcast(JSON.stringify(payload));
  }

  onRequest(): Response {
    return Response.json({
      ok: true,
      room: this.room.id,
      transport: "partykit",
      protocol: "fleet-sync",
      connections: Array.from(this.room.getConnections()).length
    });
  }
}
