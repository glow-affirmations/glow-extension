import { afterEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

class MockUri {
  constructor(readonly fsPath: string) {}

  static joinPath(base: MockUri, ...parts: string[]): MockUri {
    return new MockUri(path.join(base.fsPath, ...parts));
  }
}

class MockFileSystemError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function translateNotFound<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") throw new MockFileSystemError("FileNotFound");
    throw error;
  }
}

mock.module("vscode", () => ({
  Uri: MockUri,
  FileSystemError: MockFileSystemError,
  workspace: {
    fs: {
      async createDirectory(uri: MockUri) {
        await fs.mkdir(uri.fsPath, { recursive: true });
      },
      async readFile(uri: MockUri) {
        return translateNotFound(async () => new Uint8Array(await fs.readFile(uri.fsPath)));
      },
      async writeFile(uri: MockUri, bytes: Uint8Array) {
        await fs.writeFile(uri.fsPath, bytes);
      },
      async rename(source: MockUri, target: MockUri) {
        await fs.rename(source.fsPath, target.fsPath);
      },
      async delete(uri: MockUri) {
        await translateNotFound(() => fs.rm(uri.fsPath));
      },
      async stat(uri: MockUri) {
        return translateNotFound(async () => {
          const stat = await fs.stat(uri.fsPath);
          return { mtime: stat.mtimeMs };
        });
      },
    },
  },
}));

const {
  LISTENING_PROGRESS_SYNC_MS,
  LISTENING_SESSION_GAP_MS,
  OfflineSyncStore,
  listeningSessionCheckpointIsDue,
  listeningSessionHasEnded,
  nextListeningSessionSyncDelay,
} = await import("../src/offlineSync");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("OfflineSyncStore", () => {
  test("compacts repeated favorite changes using the last shared sequence", async () => {
    const { first, second } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const affirmationId = "00000000-0000-4000-8000-000000000002";

    await first.enqueueFavorite(userId, affirmationId, true);
    await second.enqueueFavorite(userId, affirmationId, false);
    const snapshot = await first.enqueueFavorite(userId, affirmationId, true);

    expect(snapshot.mutations).toHaveLength(1);
    expect(snapshot.mutations[0]).toMatchObject({
      sequence: 3,
      type: "favorite",
      affirmationId,
      favorite: true,
    });
    expect(snapshot.nextSequence).toBe(4);
  });

  test("does not lose concurrent changes from separate hosts", async () => {
    const { first, second } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";

    await Promise.all([
      first.enqueueFavorite(userId, "00000000-0000-4000-8000-000000000002", true),
      second.enqueueFavorite(userId, "00000000-0000-4000-8000-000000000003", true),
    ]);
    const snapshot = await first.read();

    expect(snapshot.mutations).toHaveLength(2);
    expect(new Set(snapshot.mutations.map((item) => item.sequence))).toEqual(new Set([1, 2]));
  });

  test("shares an optimistic custom deletion across separate hosts", async () => {
    const { first, second } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const affirmationId = "00000000-0000-4000-8000-000000000002";

    await first.enqueueDeleteCustom(userId, affirmationId);
    const snapshot = await second.read();

    expect(snapshot.mutations).toHaveLength(1);
    expect(snapshot.mutations[0]).toMatchObject({
      userId,
      type: "deleteCustom",
      affirmationId,
    });
  });

  test("does not acknowledge a newer superseding operation", async () => {
    const { first, second } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const affirmationId = "00000000-0000-4000-8000-000000000002";
    const original = await first.enqueueFavorite(userId, affirmationId, true);
    const originalId = original.mutations[0]!.operationId;

    const replacement = await second.enqueueFavorite(userId, affirmationId, false);
    const result = await first.removeOperations(new Set([originalId]));

    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0]!.operationId).toBe(replacement.mutations[0]!.operationId);
    expect(result.mutations[0]).toMatchObject({ favorite: false, sequence: 2 });
  });

  test("serializes flushes across hosts", async () => {
    const { first, second } = await stores();
    let activeFlushes = 0;
    let maximumActiveFlushes = 0;

    const flush = (store: InstanceType<typeof OfflineSyncStore>) =>
      store.withFlushLock(async () => {
        activeFlushes += 1;
        maximumActiveFlushes = Math.max(maximumActiveFlushes, activeFlushes);
        await new Promise((resolve) => setTimeout(resolve, 80));
        activeFlushes -= 1;
      });

    await Promise.all([flush(first), flush(second)]);
    expect(maximumActiveFlushes).toBe(1);
  });

  test("records completed loops in one ordered listening segment", async () => {
    const { first } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const affirmationId = "00000000-0000-4000-8000-000000000002";
    const contextId = "00000000-0000-4000-8000-000000000003";

    await first.recordListeningStarted(
      userId,
      contextId,
      affirmationId,
      "2026-07-27T10:00:00.000Z",
      -180,
    );
    await first.recordListeningCompleted(
      userId,
      contextId,
      affirmationId,
      "2026-07-27T10:00:04.000Z",
      4_000,
    );
    await first.recordListeningCompleted(
      userId,
      contextId,
      affirmationId,
      "2026-07-27T10:00:09.000Z",
      4_000,
    );
    const snapshot = await first.recordListeningStopped(
      userId,
      contextId,
      affirmationId,
      "2026-07-27T10:00:10.000Z",
    );

    expect(snapshot.listeningSessions).toHaveLength(1);
    expect(snapshot.listeningSegments).toHaveLength(1);
    expect(snapshot.listeningSegments[0]).toMatchObject({
      affirmationId,
      sequence: 1,
      completedListens: 2,
      listenedMs: 8_000,
      active: false,
    });
  });

  test("groups affirmation changes within ten minutes into one session", async () => {
    const { first } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const firstAffirmationId = "00000000-0000-4000-8000-000000000002";
    const secondAffirmationId = "00000000-0000-4000-8000-000000000003";
    const contextId = "00000000-0000-4000-8000-000000000004";

    await first.recordListeningStarted(
      userId,
      contextId,
      firstAffirmationId,
      "2026-07-27T10:00:00.000Z",
      0,
    );
    await first.recordListeningStopped(
      userId,
      contextId,
      firstAffirmationId,
      "2026-07-27T10:01:00.000Z",
    );
    const snapshot = await first.recordListeningStarted(
      userId,
      contextId,
      secondAffirmationId,
      "2026-07-27T10:05:00.000Z",
      0,
    );

    expect(snapshot.listeningSessions).toHaveLength(1);
    expect(snapshot.listeningSegments.map((segment) => segment.sequence)).toEqual([1, 2]);
    expect(snapshot.listeningSegments[1]).toMatchObject({
      affirmationId: secondAffirmationId,
      active: true,
    });
  });

  test("schedules a progressive checkpoint before the inactivity deadline", async () => {
    const { first } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const affirmationId = "00000000-0000-4000-8000-000000000002";
    const contextId = "00000000-0000-4000-8000-000000000003";
    const endedAtMs = Date.parse("2026-07-27T10:00:00.000Z");
    const snapshot = await first.recordListeningStarted(
      userId,
      contextId,
      affirmationId,
      new Date(endedAtMs).toISOString(),
      0,
    );
    const session = snapshot.listeningSessions[0]!;

    expect(
      nextListeningSessionSyncDelay(
        snapshot,
        userId,
        endedAtMs + LISTENING_PROGRESS_SYNC_MS - 1,
      ),
    ).toBe(1);
    expect(
      listeningSessionCheckpointIsDue(
        session,
        endedAtMs + LISTENING_PROGRESS_SYNC_MS - 1,
      ),
    ).toBe(false);
    expect(
      listeningSessionHasEnded(
        session,
        endedAtMs + LISTENING_SESSION_GAP_MS - 1,
      ),
    ).toBe(false);
    expect(
      nextListeningSessionSyncDelay(
        snapshot,
        userId,
        endedAtMs + LISTENING_PROGRESS_SYNC_MS,
      ),
    ).toBe(0);
    expect(
      listeningSessionCheckpointIsDue(
        session,
        endedAtMs + LISTENING_PROGRESS_SYNC_MS,
      ),
    ).toBe(true);
    expect(
      listeningSessionHasEnded(
        session,
        endedAtMs + LISTENING_SESSION_GAP_MS,
      ),
    ).toBe(true);
  });

  test("schedules the next dirty checkpoint five minutes after acknowledgement", async () => {
    const { first } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const affirmationId = "00000000-0000-4000-8000-000000000002";
    const contextId = "00000000-0000-4000-8000-000000000003";
    const startedAtMs = Date.parse("2026-07-27T10:00:00.000Z");
    const synchronizedAtMs = startedAtMs + LISTENING_PROGRESS_SYNC_MS;
    const original = await first.recordListeningStarted(
      userId,
      contextId,
      affirmationId,
      new Date(startedAtMs).toISOString(),
      0,
    );
    await first.acknowledgeListeningSync(
      original.listeningSessions.map(({ id, revision }) => ({ id, revision })),
      original.listeningSegments.map(({ id, revision }) => ({ id, revision })),
      new Date(synchronizedAtMs).toISOString(),
    );
    const changed = await first.recordListeningCompleted(
      userId,
      contextId,
      affirmationId,
      new Date(synchronizedAtMs + 4_000).toISOString(),
      4_000,
    );

    expect(
      nextListeningSessionSyncDelay(
        changed,
        userId,
        synchronizedAtMs + LISTENING_PROGRESS_SYNC_MS - 1,
      ),
    ).toBe(1);
    expect(
      nextListeningSessionSyncDelay(
        changed,
        userId,
        synchronizedAtMs + LISTENING_PROGRESS_SYNC_MS,
      ),
    ).toBe(0);
  });

  test("prunes acknowledged listening history only after the session becomes final", async () => {
    const { first } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const affirmationId = "00000000-0000-4000-8000-000000000002";
    const contextId = "00000000-0000-4000-8000-000000000003";
    const startedAtMs = Date.parse("2026-07-27T10:00:00.000Z");
    const original = await first.recordListeningStarted(
      userId,
      contextId,
      affirmationId,
      new Date(startedAtMs).toISOString(),
      0,
    );
    await first.acknowledgeListeningSync(
      original.listeningSessions.map(({ id, revision }) => ({ id, revision })),
      original.listeningSegments.map(({ id, revision }) => ({ id, revision })),
      new Date(startedAtMs + LISTENING_PROGRESS_SYNC_MS).toISOString(),
    );

    const resumable = await first.pruneFinalizedListening(
      userId,
      startedAtMs + LISTENING_SESSION_GAP_MS - 1,
    );
    expect(resumable.listeningSessions).toHaveLength(1);
    expect(resumable.listeningSegments).toHaveLength(1);

    const finalized = await first.pruneFinalizedListening(
      userId,
      startedAtMs + LISTENING_SESSION_GAP_MS,
    );
    expect(finalized.listeningSessions).toHaveLength(0);
    expect(finalized.listeningSegments).toHaveLength(0);
  });

  test("starts a new session instead of reviving a stale active segment", async () => {
    const { first } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const affirmationId = "00000000-0000-4000-8000-000000000002";
    const contextId = "00000000-0000-4000-8000-000000000003";

    await first.recordListeningStarted(
      userId,
      contextId,
      affirmationId,
      "2026-07-27T10:00:00.000Z",
      0,
    );
    const snapshot = await first.recordListeningStarted(
      userId,
      contextId,
      affirmationId,
      "2026-07-27T10:11:00.000Z",
      0,
    );

    expect(snapshot.listeningSessions).toHaveLength(2);
    expect(snapshot.listeningSegments).toHaveLength(2);
    expect(snapshot.listeningSegments.map((segment) => segment.active)).toEqual([
      false,
      true,
    ]);
  });

  test("keeps simultaneous IDE windows in independent sessions", async () => {
    const { first, second } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const affirmationId = "00000000-0000-4000-8000-000000000002";

    await Promise.all([
      first.recordListeningStarted(
        userId,
        "00000000-0000-4000-8000-000000000003",
        affirmationId,
        "2026-07-27T10:00:00.000Z",
        0,
      ),
      second.recordListeningStarted(
        userId,
        "00000000-0000-4000-8000-000000000004",
        affirmationId,
        "2026-07-27T10:00:00.000Z",
        0,
      ),
    ]);
    const snapshot = await first.read();

    expect(snapshot.listeningSessions).toHaveLength(2);
    expect(snapshot.listeningSegments).toHaveLength(2);
    expect(new Set(snapshot.listeningSegments.map((segment) => segment.sessionId)).size).toBe(2);
  });

  test("does not acknowledge listening progress added during an in-flight sync", async () => {
    const { first, second } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";
    const affirmationId = "00000000-0000-4000-8000-000000000002";
    const contextId = "00000000-0000-4000-8000-000000000003";

    const original = await first.recordListeningStarted(
      userId,
      contextId,
      affirmationId,
      "2026-07-27T10:00:00.000Z",
      0,
    );
    const originalSegment = original.listeningSegments[0]!;
    await second.recordListeningCompleted(
      userId,
      contextId,
      affirmationId,
      "2026-07-27T10:00:04.000Z",
      4_000,
    );
    const acknowledged = await first.acknowledgeListeningSync(
      original.listeningSessions.map(({ id, revision }) => ({ id, revision })),
      [{ id: originalSegment.id, revision: originalSegment.revision }],
      "2026-07-27T10:05:00.000Z",
    );

    expect(acknowledged.listeningSegments[0]).toMatchObject({
      completedListens: 1,
      listenedMs: 4_000,
      syncedRevision: 0,
    });
    expect(acknowledged.listeningSegments[0]!.revision).toBeGreaterThan(
      originalSegment.revision,
    );
  });

  test("keeps a shared sign-out tombstone from being replaced by stale window state", async () => {
    const { first, second } = await stores();
    const userId = "00000000-0000-4000-8000-000000000001";

    await first.initializeLibrary({ user: { id: userId } });
    await first.clearUser(userId);
    const snapshot = await second.initializeLibrary({ user: { id: userId } });

    expect(snapshot.libraryInitialized).toBe(true);
    expect(snapshot.library).toBeNull();
  });
});

async function stores() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sol-offline-sync-"));
  temporaryDirectories.push(directory);
  const root = new MockUri(directory);
  return {
    first: new OfflineSyncStore(root as never),
    second: new OfflineSyncStore(root as never),
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
