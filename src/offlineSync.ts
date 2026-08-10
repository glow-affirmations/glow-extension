import * as vscode from "vscode";
import { open, type FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const SYNC_STATE_FILE = "offline-sync-v1.json";
const STATE_LOCK_FILE = "offline-sync-state.lock";
const FLUSH_LOCK_FILE = "offline-sync-flush.lock";
export const LISTENING_PROGRESS_SYNC_MS = 5 * 60 * 1000;
export const LISTENING_SESSION_GAP_MS = 10 * 60 * 1000;

export type FavoriteMutation = {
  operationId: string;
  sequence: number;
  userId: string;
  type: "favorite";
  affirmationId: string;
  favorite: boolean;
  createdAt: string;
};

export type DeleteCustomMutation = {
  operationId: string;
  sequence: number;
  userId: string;
  type: "deleteCustom";
  affirmationId: string;
  createdAt: string;
};

export type OfflineMutation = FavoriteMutation | DeleteCustomMutation;

export type OfflineListeningSession = {
  id: string;
  userId: string;
  contextId: string;
  startedAt: string;
  endedAt: string;
  timezoneOffsetMinutes: number;
  nextSequence: number;
  revision: number;
  syncedRevision: number;
  lastSyncedAt: string | null;
};

export type OfflineListeningSegment = {
  id: string;
  sessionId: string;
  userId: string;
  contextId: string;
  affirmationId: string;
  sequence: number;
  startedAt: string;
  endedAt: string;
  completedListens: number;
  listenedMs: number;
  active: boolean;
  revision: number;
  syncedRevision: number;
};

export type ListeningSyncReference = {
  id: string;
  revision: number;
};

export type OfflineSyncSnapshot = {
  version: 1;
  revision: number;
  nextSequence: number;
  libraryInitialized: boolean;
  library: unknown | null;
  mutations: OfflineMutation[];
  listeningSessions: OfflineListeningSession[];
  listeningSegments: OfflineListeningSegment[];
};

type LockLease = {
  ownerId: string;
  handle: FileHandle;
  uri: vscode.Uri;
};

export class OfflineSyncStore {
  private readonly stateUri: vscode.Uri;

  constructor(private readonly storageUri: vscode.Uri) {
    this.stateUri = vscode.Uri.joinPath(storageUri, SYNC_STATE_FILE);
  }

  async initializeLibrary(library: unknown | null): Promise<OfflineSyncSnapshot> {
    return this.mutate((snapshot) => {
      if (!snapshot.libraryInitialized) {
        snapshot.library = library;
        snapshot.libraryInitialized = true;
      }
    });
  }

  async read(): Promise<OfflineSyncSnapshot> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.stateUri);
      return parseSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (error) {
      if (isFileNotFound(error) || error instanceof SyntaxError) return emptySnapshot();
      throw error;
    }
  }

  async setLibrary(library: unknown | null): Promise<OfflineSyncSnapshot> {
    return this.mutate((snapshot) => {
      snapshot.library = library;
      snapshot.libraryInitialized = true;
    });
  }

  async enqueueFavorite(
    userId: string,
    affirmationId: string,
    favorite: boolean,
  ): Promise<OfflineSyncSnapshot> {
    return this.mutate((snapshot) => {
      snapshot.mutations = snapshot.mutations.filter(
        (mutation) =>
          !(
            mutation.userId === userId &&
            mutation.type === "favorite" &&
            mutation.affirmationId === affirmationId
          ),
      );
      snapshot.mutations.push({
        operationId: randomUUID(),
        sequence: snapshot.nextSequence,
        userId,
        type: "favorite",
        affirmationId,
        favorite,
        createdAt: new Date().toISOString(),
      });
      snapshot.nextSequence += 1;
    });
  }

  async enqueueDeleteCustom(userId: string, affirmationId: string): Promise<OfflineSyncSnapshot> {
    return this.mutate((snapshot) => {
      snapshot.mutations = snapshot.mutations.filter(
        (mutation) =>
          !(
            mutation.userId === userId &&
            mutation.type === "deleteCustom" &&
            mutation.affirmationId === affirmationId
          ),
      );
      snapshot.mutations.push({
        operationId: randomUUID(),
        sequence: snapshot.nextSequence,
        userId,
        type: "deleteCustom",
        affirmationId,
        createdAt: new Date().toISOString(),
      });
      snapshot.nextSequence += 1;
    });
  }

  async recordListeningStarted(
    userId: string,
    contextId: string,
    affirmationId: string,
    occurredAt: string,
    timezoneOffsetMinutes: number,
  ): Promise<OfflineSyncSnapshot> {
    return this.mutate((snapshot) => {
      const occurredAtMs = Date.parse(occurredAt);
      if (!Number.isFinite(occurredAtMs)) return;

      const activeSegment = snapshot.listeningSegments.find(
        (segment) =>
          segment.userId === userId &&
          segment.contextId === contextId &&
          segment.active,
      );
      const activeSession = activeSegment
        ? snapshot.listeningSessions.find((session) => session.id === activeSegment.sessionId)
        : undefined;
      const activeSessionEndedAtMs = activeSession
        ? Date.parse(activeSession.endedAt)
        : Number.NaN;
      const activeSessionIsRecent =
        Number.isFinite(activeSessionEndedAtMs) &&
        occurredAtMs >= activeSessionEndedAtMs &&
        occurredAtMs - activeSessionEndedAtMs <= LISTENING_SESSION_GAP_MS;
      if (activeSegment?.affirmationId === affirmationId && activeSessionIsRecent) {
        touchListeningSegment(activeSegment, occurredAt);
        touchListeningSession(snapshot, activeSegment.sessionId, occurredAt);
        return;
      }
      if (activeSegment) {
        activeSegment.active = false;
        if (activeSessionIsRecent) {
          touchListeningSegment(activeSegment, occurredAt);
          touchListeningSession(snapshot, activeSegment.sessionId, occurredAt);
        }
      }

      let session = latestListeningSession(snapshot, userId, contextId);
      const sessionEndedAtMs = session ? Date.parse(session.endedAt) : Number.NaN;
      if (
        !session ||
        !Number.isFinite(sessionEndedAtMs) ||
        occurredAtMs - sessionEndedAtMs > LISTENING_SESSION_GAP_MS ||
        occurredAtMs < sessionEndedAtMs
      ) {
        session = {
          id: randomUUID(),
          userId,
          contextId,
          startedAt: occurredAt,
          endedAt: occurredAt,
          timezoneOffsetMinutes,
          nextSequence: 1,
          revision: 1,
          syncedRevision: 0,
          lastSyncedAt: null,
        };
        snapshot.listeningSessions.push(session);
      } else {
        touchListeningSession(snapshot, session.id, occurredAt);
      }

      const sequence = session.nextSequence;
      session.nextSequence += 1;
      session.revision += 1;
      snapshot.listeningSegments.push({
        id: randomUUID(),
        sessionId: session.id,
        userId,
        contextId,
        affirmationId,
        sequence,
        startedAt: occurredAt,
        endedAt: occurredAt,
        completedListens: 0,
        listenedMs: 0,
        active: true,
        revision: 1,
        syncedRevision: 0,
      });
    });
  }

  async recordListeningCompleted(
    userId: string,
    contextId: string,
    affirmationId: string,
    occurredAt: string,
    durationMs: number,
  ): Promise<OfflineSyncSnapshot> {
    return this.mutate((snapshot) => {
      const segment = snapshot.listeningSegments.find(
        (item) =>
          item.userId === userId &&
          item.contextId === contextId &&
          item.affirmationId === affirmationId &&
          item.active,
      );
      if (!segment) return;

      segment.completedListens += 1;
      segment.listenedMs += durationMs;
      touchListeningSegment(segment, occurredAt);
      touchListeningSession(snapshot, segment.sessionId, occurredAt);
    });
  }

  async recordListeningStopped(
    userId: string,
    contextId: string,
    affirmationId: string,
    occurredAt: string,
  ): Promise<OfflineSyncSnapshot> {
    return this.mutate((snapshot) => {
      const segment = snapshot.listeningSegments.find(
        (item) =>
          item.userId === userId &&
          item.contextId === contextId &&
          item.affirmationId === affirmationId &&
          item.active,
      );
      if (!segment) return;

      segment.active = false;
      touchListeningSegment(segment, occurredAt);
      touchListeningSession(snapshot, segment.sessionId, occurredAt);
    });
  }

  async acknowledgeListeningSync(
    sessionReferences: readonly ListeningSyncReference[],
    segmentReferences: readonly ListeningSyncReference[],
    synchronizedAt: string,
  ): Promise<OfflineSyncSnapshot> {
    if (sessionReferences.length === 0 && segmentReferences.length === 0) {
      return this.read();
    }
    const synchronizedAtMs = Date.parse(synchronizedAt);
    const cleanupNowMs = Number.isFinite(synchronizedAtMs)
      ? synchronizedAtMs
      : Date.now();
    return this.mutate((snapshot) => {
      const sessionRevisions = new Map(
        sessionReferences.map((reference) => [reference.id, reference.revision]),
      );
      const segmentRevisions = new Map(
        segmentReferences.map((reference) => [reference.id, reference.revision]),
      );

      for (const session of snapshot.listeningSessions) {
        const acknowledgedRevision = sessionRevisions.get(session.id);
        if (acknowledgedRevision === session.revision) {
          session.syncedRevision = acknowledgedRevision;
          session.lastSyncedAt = synchronizedAt;
        }
      }
      for (const segment of snapshot.listeningSegments) {
        const acknowledgedRevision = segmentRevisions.get(segment.id);
        if (acknowledgedRevision === segment.revision) {
          segment.syncedRevision = acknowledgedRevision;
        }
      }

      snapshot.listeningSegments = snapshot.listeningSegments.filter(
        (segment) => {
          const session = snapshot.listeningSessions.find(
            (candidate) => candidate.id === segment.sessionId,
          );
          const sessionIsRecent =
            session !== undefined &&
            !listeningSessionHasEnded(session, cleanupNowMs);
          return (
            (segment.active && sessionIsRecent) ||
            segment.syncedRevision < segment.revision
          );
        },
      );
      const cutoff = cleanupNowMs - LISTENING_SESSION_GAP_MS;
      snapshot.listeningSessions = snapshot.listeningSessions.filter((session) => {
        const stillReferenced = snapshot.listeningSegments.some(
          (segment) => segment.sessionId === session.id,
        );
        return (
          stillReferenced ||
          session.syncedRevision < session.revision ||
          Date.parse(session.endedAt) >= cutoff
        );
      });
    });
  }

  async pruneFinalizedListening(
    userId: string,
    nowMs: number,
  ): Promise<OfflineSyncSnapshot> {
    const current = await this.read();
    if (!hasPrunableListeningHistory(current, userId, nowMs)) return current;

    return this.mutate((snapshot) => {
      const prunableSessionIds = new Set(
        snapshot.listeningSessions
          .filter(
            (session) =>
              session.userId === userId &&
              listeningSessionHasEnded(session, nowMs) &&
              session.syncedRevision >= session.revision &&
              snapshot.listeningSegments
                .filter((segment) => segment.sessionId === session.id)
                .every((segment) => segment.syncedRevision >= segment.revision),
          )
          .map((session) => session.id),
      );
      if (prunableSessionIds.size === 0) return;

      snapshot.listeningSegments = snapshot.listeningSegments.filter(
        (segment) => !prunableSessionIds.has(segment.sessionId),
      );
      snapshot.listeningSessions = snapshot.listeningSessions.filter(
        (session) => !prunableSessionIds.has(session.id),
      );
    });
  }

  async removeOperations(operationIds: ReadonlySet<string>): Promise<OfflineSyncSnapshot> {
    if (operationIds.size === 0) return this.read();
    return this.mutate((snapshot) => {
      snapshot.mutations = snapshot.mutations.filter(
        (mutation) => !operationIds.has(mutation.operationId),
      );
    });
  }

  async clearUser(userId: string | null): Promise<OfflineSyncSnapshot> {
    return this.mutate((snapshot) => {
      snapshot.library = null;
      snapshot.libraryInitialized = true;
      snapshot.mutations = userId
        ? snapshot.mutations.filter((mutation) => mutation.userId !== userId)
        : [];
      snapshot.listeningSessions = userId
        ? snapshot.listeningSessions.filter((session) => session.userId !== userId)
        : [];
      snapshot.listeningSegments = userId
        ? snapshot.listeningSegments.filter((segment) => segment.userId !== userId)
        : [];
    });
  }

  async withFlushLock<T>(callback: () => Promise<T>): Promise<T> {
    const lease = await this.acquireLock(FLUSH_LOCK_FILE, 45_000, 2 * 60_000);
    const heartbeat = setInterval(() => {
      const now = new Date();
      void lease.handle.utimes(now, now).catch(() => undefined);
    }, 10_000);
    try {
      return await callback();
    } finally {
      clearInterval(heartbeat);
      await this.releaseLock(lease);
    }
  }

  private async mutate(
    mutation: (snapshot: OfflineSyncSnapshot) => void,
  ): Promise<OfflineSyncSnapshot> {
    const lease = await this.acquireLock(STATE_LOCK_FILE, 30_000, 10_000);
    try {
      const snapshot = await this.read();
      mutation(snapshot);
      snapshot.revision += 1;
      await this.write(snapshot);
      return snapshot;
    } finally {
      await this.releaseLock(lease);
    }
  }

  private async write(snapshot: OfflineSyncSnapshot): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    const temporaryUri = vscode.Uri.joinPath(
      this.storageUri,
      `${SYNC_STATE_FILE}.${randomUUID()}.part`,
    );
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    try {
      await vscode.workspace.fs.writeFile(temporaryUri, bytes);
      await vscode.workspace.fs.rename(temporaryUri, this.stateUri, { overwrite: true });
    } catch (error) {
      await deleteIfPresent(temporaryUri);
      throw error;
    }
  }

  private async acquireLock(
    fileName: string,
    staleAfterMs: number,
    timeoutMs: number,
  ): Promise<LockLease> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    const uri = vscode.Uri.joinPath(this.storageUri, fileName);
    const ownerId = randomUUID();
    const deadline = Date.now() + timeoutMs;

    while (true) {
      try {
        const handle = await open(uri.fsPath, "wx");
        try {
          await handle.writeFile(JSON.stringify({ ownerId, createdAt: Date.now() }), "utf8");
          return { ownerId, handle, uri };
        } catch (error) {
          await handle.close();
          await deleteIfPresent(uri);
          throw error;
        }
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        await this.removeStaleLock(uri, staleAfterMs);
        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for another Glow window to finish syncing.");
        }
        await delay(35 + Math.floor(Math.random() * 40));
      }
    }
  }

  private async removeStaleLock(uri: vscode.Uri, staleAfterMs: number): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (Date.now() - stat.mtime > staleAfterMs) await deleteIfPresent(uri);
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
  }

  private async releaseLock(lease: LockLease): Promise<void> {
    await lease.handle.close();
    try {
      const bytes = await vscode.workspace.fs.readFile(lease.uri);
      const contents = JSON.parse(new TextDecoder().decode(bytes)) as { ownerId?: unknown };
      if (contents.ownerId === lease.ownerId) await deleteIfPresent(lease.uri);
    } catch (error) {
      if (!isFileNotFound(error) && !(error instanceof SyntaxError)) throw error;
    }
  }
}

export function listeningSessionHasEnded(
  session: OfflineListeningSession,
  nowMs: number,
): boolean {
  const endedAtMs = Date.parse(session.endedAt);
  return (
    Number.isFinite(endedAtMs) &&
    nowMs >= endedAtMs + LISTENING_SESSION_GAP_MS
  );
}

export function nextListeningSessionSyncDelay(
  snapshot: OfflineSyncSnapshot,
  userId: string,
  nowMs: number,
): number | null {
  let earliestDeadline = Number.POSITIVE_INFINITY;
  for (const session of snapshot.listeningSessions) {
    if (session.userId !== userId) continue;
    const endedAtMs = Date.parse(session.endedAt);
    if (!Number.isFinite(endedAtMs)) continue;
    const finalizationDeadline = endedAtMs + LISTENING_SESSION_GAP_MS;
    if (session.revision > session.syncedRevision) {
      const checkpointAnchorMs = Date.parse(
        session.lastSyncedAt ?? session.startedAt,
      );
      const checkpointDeadline = Number.isFinite(checkpointAnchorMs)
        ? checkpointAnchorMs + LISTENING_PROGRESS_SYNC_MS
        : nowMs;
      earliestDeadline = Math.min(
        earliestDeadline,
        checkpointDeadline,
        finalizationDeadline,
      );
    } else {
      earliestDeadline = Math.min(earliestDeadline, finalizationDeadline);
    }
  }
  return Number.isFinite(earliestDeadline)
    ? Math.max(0, earliestDeadline - nowMs)
    : null;
}

export function listeningSessionCheckpointIsDue(
  session: OfflineListeningSession,
  nowMs: number,
): boolean {
  if (listeningSessionHasEnded(session, nowMs)) return true;
  const checkpointAnchorMs = Date.parse(
    session.lastSyncedAt ?? session.startedAt,
  );
  return (
    !Number.isFinite(checkpointAnchorMs) ||
    nowMs >= checkpointAnchorMs + LISTENING_PROGRESS_SYNC_MS
  );
}

function emptySnapshot(): OfflineSyncSnapshot {
  return {
    version: 1,
    revision: 0,
    nextSequence: 1,
    libraryInitialized: false,
    library: null,
    mutations: [],
    listeningSessions: [],
    listeningSegments: [],
  };
}

function parseSnapshot(value: unknown): OfflineSyncSnapshot {
  if (!isRecord(value) || value.version !== 1) return emptySnapshot();
  const revision = readNonNegativeInteger(value.revision);
  const nextSequence = readPositiveInteger(value.nextSequence);
  const mutations = Array.isArray(value.mutations)
    ? value.mutations.map(parseMutation).filter((item): item is OfflineMutation => item !== null)
    : [];
  const listeningSessions = Array.isArray(value.listeningSessions)
    ? value.listeningSessions
        .map(parseListeningSession)
        .filter((item): item is OfflineListeningSession => item !== null)
    : [];
  const listeningSessionIds = new Set(listeningSessions.map((session) => session.id));
  const listeningSegments = Array.isArray(value.listeningSegments)
    ? value.listeningSegments
        .map(parseListeningSegment)
        .filter(
          (item): item is OfflineListeningSegment =>
            item !== null && listeningSessionIds.has(item.sessionId),
        )
    : [];

  return {
    version: 1,
    revision,
    nextSequence: Math.max(nextSequence, ...mutations.map((item) => item.sequence + 1)),
    libraryInitialized:
      typeof value.libraryInitialized === "boolean"
        ? value.libraryInitialized
        : revision > 0 || value.library !== null,
    library: value.library ?? null,
    mutations,
    listeningSessions,
    listeningSegments,
  };
}

function parseMutation(value: unknown): OfflineMutation | null {
  if (
    !isRecord(value) ||
    typeof value.operationId !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.affirmationId !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }
  const sequence = readPositiveInteger(value.sequence);
  if (value.type === "favorite" && typeof value.favorite === "boolean") {
    return {
      operationId: value.operationId,
      sequence,
      userId: value.userId,
      type: "favorite",
      affirmationId: value.affirmationId,
      favorite: value.favorite,
      createdAt: value.createdAt,
    };
  }
  if (value.type === "deleteCustom") {
    return {
      operationId: value.operationId,
      sequence,
      userId: value.userId,
      type: "deleteCustom",
      affirmationId: value.affirmationId,
      createdAt: value.createdAt,
    };
  }
  return null;
}

function parseListeningSession(value: unknown): OfflineListeningSession | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.contextId !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.endedAt !== "string" ||
    !isIntegerInRange(value.timezoneOffsetMinutes, -840, 840)
  ) {
    return null;
  }
  const revision = readPositiveInteger(value.revision);
  return {
    id: value.id,
    userId: value.userId,
    contextId: value.contextId,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    timezoneOffsetMinutes: value.timezoneOffsetMinutes,
    nextSequence: readPositiveInteger(value.nextSequence),
    revision,
    syncedRevision: Math.min(revision, readNonNegativeInteger(value.syncedRevision)),
    lastSyncedAt:
      typeof value.lastSyncedAt === "string" &&
      Number.isFinite(Date.parse(value.lastSyncedAt))
        ? value.lastSyncedAt
        : null,
  };
}

function parseListeningSegment(value: unknown): OfflineListeningSegment | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.contextId !== "string" ||
    typeof value.affirmationId !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.endedAt !== "string" ||
    typeof value.active !== "boolean"
  ) {
    return null;
  }
  const revision = readPositiveInteger(value.revision);
  return {
    id: value.id,
    sessionId: value.sessionId,
    userId: value.userId,
    contextId: value.contextId,
    affirmationId: value.affirmationId,
    sequence: readPositiveInteger(value.sequence),
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    completedListens: readNonNegativeInteger(value.completedListens),
    listenedMs: readNonNegativeInteger(value.listenedMs),
    active: value.active,
    revision,
    syncedRevision: Math.min(revision, readNonNegativeInteger(value.syncedRevision)),
  };
}

function latestListeningSession(
  snapshot: OfflineSyncSnapshot,
  userId: string,
  contextId: string,
): OfflineListeningSession | undefined {
  return snapshot.listeningSessions
    .filter((session) => session.userId === userId && session.contextId === contextId)
    .sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt))[0];
}

function hasPrunableListeningHistory(
  snapshot: OfflineSyncSnapshot,
  userId: string,
  nowMs: number,
): boolean {
  return snapshot.listeningSessions.some(
    (session) =>
      session.userId === userId &&
      listeningSessionHasEnded(session, nowMs) &&
      session.syncedRevision >= session.revision &&
      snapshot.listeningSegments
        .filter((segment) => segment.sessionId === session.id)
        .every((segment) => segment.syncedRevision >= segment.revision),
  );
}

function touchListeningSession(
  snapshot: OfflineSyncSnapshot,
  sessionId: string,
  occurredAt: string,
): void {
  const session = snapshot.listeningSessions.find((item) => item.id === sessionId);
  if (!session) return;
  if (Date.parse(occurredAt) > Date.parse(session.endedAt)) session.endedAt = occurredAt;
  session.revision += 1;
}

function touchListeningSegment(
  segment: OfflineListeningSegment,
  occurredAt: string,
): void {
  if (Date.parse(occurredAt) > Date.parse(segment.endedAt)) segment.endedAt = occurredAt;
  segment.revision += 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readPositiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileNotFound";
}

async function deleteIfPresent(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
