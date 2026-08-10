import { afterEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

class MockUri {
  constructor(readonly fsPath: string) {}

  static parse(value: string): MockUri {
    return new MockUri(value);
  }

  static joinPath(base: MockUri, ...parts: string[]): MockUri {
    return new MockUri(path.join(base.fsPath, ...parts));
  }
}

class MockFileSystemError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

class MockEventEmitter<T> {
  private readonly listeners = new Set<(value: T) => unknown>();
  readonly event = (listener: (value: T) => unknown) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

async function translateNotFound<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new MockFileSystemError("FileNotFound");
    }
    throw error;
  }
}

mock.module("vscode", () => ({
  Uri: MockUri,
  FileSystemError: MockFileSystemError,
  EventEmitter: MockEventEmitter,
  env: {
    async openExternal() {
      return true;
    },
  },
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
  normalizePairingCode,
  buildRedeemBody,
  validateAuthorizationCodeReady,
  validateStartResponse,
  PRODUCTION_OAUTH_CLIENT_ID,
  PAIRING_PROTOCOL_VERSION,
  OAUTH_SCOPE,
} = await import("../src/oauthProtocol");
const { ExtensionPairingController, OAuthSessionManager } = await import("../src/oauthAuth");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Glow OAuth pairing protocol", () => {
  test("uses the fixed production public-client contract", () => {
    expect(PRODUCTION_OAUTH_CLIENT_ID).toBe(
      "9cacc440-55f7-4efe-b8f8-4e5e4c805248",
    );
    expect(PAIRING_PROTOCOL_VERSION).toBe(2);
    expect(OAUTH_SCOPE).toBe("email");
  });

  test("normalizes the supported human-code formats", () => {
    expect(normalizePairingCode("482917")).toBe("482917");
    expect(normalizePairingCode("482 917")).toBe("482917");
    expect(normalizePairingCode("482-917")).toBe("482917");
    expect(normalizePairingCode(" 482 917 ")).toBe("482917");
  });

  test("reports completion until the webview acknowledges successful sign-in", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glow-oauth-"));
    temporaryDirectories.push(directory);
    const requestId = "00000000-0000-4000-8000-000000000003";
    const subject = "00000000-0000-4000-8000-000000000001";
    let expectedState = "";
    const fetchImpl = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith("/api/extension-auth/start")) {
        const body = JSON.parse(String(init?.body)) as { state: string };
        expectedState = body.state;
        return Response.json(
          {
            protocolVersion: 2,
            scope: "email",
            requestId,
            requestSecret: "pairing_secret",
            verificationUri: `https://auth.justglow.dev/code?request=${requestId}`,
            requestExpiresIn: 3600,
          },
          { status: 201 },
        );
      }
      if (url.endsWith("/api/extension-auth/redeem")) {
        return Response.json({
          status: "authorization_code_ready",
          authorizationCode: "authorization-code",
          state: expectedState,
        });
      }
      if (url.endsWith("/auth/v1/oauth/token")) {
        return Response.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          scope: "email",
        });
      }
      if (url.endsWith("/auth/v1/oauth/userinfo")) {
        return Response.json({ sub: subject });
      }
      throw new Error(`Unexpected auth request: ${url}`);
    }) as unknown as typeof fetch;
    const manager = new OAuthSessionManager(
      new SecretHub({}).connect(0) as never,
      new MockUri(directory) as never,
      fetchImpl,
    );
    const controller = new ExtensionPairingController("0.1.3", manager, fetchImpl);
    const statuses: string[] = [];
    const subscription = controller.onDidChangeState((state) => statuses.push(state.status));

    try {
      await controller.begin();
      await controller.submitCode("482917");

      expect(statuses).toEqual([
        "starting",
        "waiting_for_code",
        "redeeming",
        "exchanging_tokens",
        "complete",
      ]);
      expect(controller.getState()).toEqual({ status: "complete" });

      controller.acknowledgeComplete();
      expect(controller.getState()).toEqual({ status: "idle" });
    } finally {
      subscription.dispose();
      controller.dispose();
      manager.dispose();
    }
  });

  test("rejects malformed human codes", () => {
    expect(normalizePairingCode("48291")).toBeNull();
    expect(normalizePairingCode("482--917")).toBeNull();
    expect(normalizePairingCode("482a917")).toBeNull();
  });

  test("accepts only the exact versioned start response", () => {
    expect(
      validateStartResponse({
        protocolVersion: 2,
        scope: "email",
        requestId: "b73e30b9-1f65-44ff-a9de-f7b2dc10d91f",
        requestSecret: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789-",
        verificationUri:
          "https://auth.justglow.dev/code?request=b73e30b9-1f65-44ff-a9de-f7b2dc10d91f",
        requestExpiresIn: 3600,
      }),
    ).toMatchObject({
      protocolVersion: 2,
      scope: "email",
      requestExpiresIn: 3600,
    });
  });

  test("rejects a downgraded protocol or changed scope", () => {
    const response = {
      protocolVersion: 2,
      scope: "email",
      requestId: "b73e30b9-1f65-44ff-a9de-f7b2dc10d91f",
      requestSecret: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789-",
      verificationUri:
        "https://auth.justglow.dev/code?request=b73e30b9-1f65-44ff-a9de-f7b2dc10d91f",
      requestExpiresIn: 3600,
    };

    expect(() => validateStartResponse({ ...response, protocolVersion: 1 })).toThrow();
    expect(() => validateStartResponse({ ...response, scope: "openid" })).toThrow();
  });

  test("rejects a verification URI on another origin", () => {
    expect(() =>
      validateStartResponse({
        protocolVersion: 2,
        scope: "email",
        requestId: "b73e30b9-1f65-44ff-a9de-f7b2dc10d91f",
        requestSecret: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789-",
        verificationUri:
          "https://example.com/code?request=b73e30b9-1f65-44ff-a9de-f7b2dc10d91f",
        requestExpiresIn: 3600,
      }),
    ).toThrow();
  });

  test("keeps the PKCE verifier out of redemption", () => {
    expect(
      buildRedeemBody(
        "b73e30b9-1f65-44ff-a9de-f7b2dc10d91f",
        "482917",
      ),
    ).toEqual({
      requestId: "b73e30b9-1f65-44ff-a9de-f7b2dc10d91f",
      code: "482917",
    });
  });

  test("accepts only an immediate authorization-code response", () => {
    expect(
      validateAuthorizationCodeReady({
        status: "authorization_code_ready",
        authorizationCode: "supabase-code",
        state: "original-oauth-state",
      }),
    ).toEqual({
      status: "authorization_code_ready",
      authorizationCode: "supabase-code",
      state: "original-oauth-state",
    });
    expect(() =>
      validateAuthorizationCodeReady({ status: "waiting_for_browser" }),
    ).toThrow();
  });
});

describe("Glow OAuth session lifecycle", () => {
  test("force-refreshes a still-valid token after an authenticated request rejects it", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glow-oauth-"));
    temporaryDirectories.push(directory);
    const subject = "00000000-0000-4000-8000-000000000001";
    const session = storedSession(
      subject,
      "rejected-access",
      "refresh-token",
      Date.now() + 30 * 60_000,
    );
    const hub = new SecretHub({ "glow.oauth.session.v1": JSON.stringify(session) });
    const secrets = hub.connect(0);
    const refreshedAccessToken = jwt(subject);
    let refreshCalls = 0;
    const fetchImpl = mock(async () => {
      refreshCalls += 1;
      return Response.json({
        access_token: refreshedAccessToken,
        refresh_token: "rotated-refresh",
        token_type: "bearer",
        expires_in: 3600,
        scope: "email",
      });
    }) as unknown as typeof fetch;
    const manager = new OAuthSessionManager(
      secrets as never,
      new MockUri(directory) as never,
      fetchImpl,
    );

    try {
      expect(await manager.getValidAccessToken()).toBe("rejected-access");
      expect(await manager.refreshAccessTokenAfterRejection()).toBe(
        refreshedAccessToken,
      );
      expect(refreshCalls).toBe(1);
    } finally {
      manager.dispose();
    }
  });

  test("serializes refresh across IDE windows and waits for rotated SecretStorage", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glow-oauth-"));
    temporaryDirectories.push(directory);
    const subject = "00000000-0000-4000-8000-000000000001";
    const oldSession = storedSession(subject, "old-access", "old-refresh", Date.now() - 1);
    const hub = new SecretHub({ "glow.oauth.session.v1": JSON.stringify(oldSession) });
    const firstSecrets = hub.connect(0);
    const secondSecrets = hub.connect(180);
    let refreshCalls = 0;
    const refreshedAccessToken = jwt(subject);
    const fetchImpl = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body?.toString() ?? "";
      if (!body.includes("grant_type=refresh_token")) throw new Error("unexpected request");
      refreshCalls += 1;
      await wait(80);
      return Response.json({
        access_token: refreshedAccessToken,
        refresh_token: "rotated-refresh",
        token_type: "bearer",
        expires_in: 3600,
        scope: "email",
      });
    }) as unknown as typeof fetch;
    const first = new OAuthSessionManager(
      firstSecrets as never,
      new MockUri(directory) as never,
      fetchImpl,
    );
    const second = new OAuthSessionManager(
      secondSecrets as never,
      new MockUri(directory) as never,
      fetchImpl,
    );

    try {
      const [firstToken, secondToken] = await Promise.all([
        first.getValidAccessToken(),
        second.getValidAccessToken(),
      ]);
      expect(firstToken).toBe(refreshedAccessToken);
      expect(secondToken).toBe(refreshedAccessToken);
      expect(refreshCalls).toBe(1);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  test("preserves a still-valid access token after a rejected proactive refresh", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glow-oauth-"));
    temporaryDirectories.push(directory);
    const subject = "00000000-0000-4000-8000-000000000001";
    const session = storedSession(
      subject,
      "still-valid-access",
      "rejected-refresh",
      Date.now() + 30_000,
    );
    const hub = new SecretHub({ "glow.oauth.session.v1": JSON.stringify(session) });
    const firstSecrets = hub.connect(0);
    const secondSecrets = hub.connect(0);
    let refreshCalls = 0;
    const fetchImpl = mock(async () => {
      refreshCalls += 1;
      return Response.json(
        { error: "invalid_grant", error_description: "Invalid refresh token" },
        { status: 400 },
      );
    }) as unknown as typeof fetch;
    const first = new OAuthSessionManager(
      firstSecrets as never,
      new MockUri(directory) as never,
      fetchImpl,
    );
    const second = new OAuthSessionManager(
      secondSecrets as never,
      new MockUri(directory) as never,
      fetchImpl,
    );

    try {
      expect(await first.getValidAccessToken()).toBe("still-valid-access");
      expect(await second.getValidAccessToken()).toBe("still-valid-access");
      expect(await first.getValidAccessToken()).toBe("still-valid-access");
      expect(refreshCalls).toBe(1);
      expect(await second.hasSession()).toBe(true);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  test("retries a transient token failure and commits the rotated session", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glow-oauth-"));
    temporaryDirectories.push(directory);
    const subject = "00000000-0000-4000-8000-000000000001";
    const session = storedSession(subject, "expired-access", "refresh-token", Date.now() - 1);
    const hub = new SecretHub({ "glow.oauth.session.v1": JSON.stringify(session) });
    const secrets = hub.connect(0);
    const refreshedAccessToken = jwt(subject);
    let refreshCalls = 0;
    const fetchImpl = mock(async () => {
      refreshCalls += 1;
      if (refreshCalls === 1) {
        return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
      }
      return Response.json({
        access_token: refreshedAccessToken,
        refresh_token: "rotated-refresh",
        token_type: "bearer",
        expires_in: 3600,
        scope: "email",
      });
    }) as unknown as typeof fetch;
    const manager = new OAuthSessionManager(
      secrets as never,
      new MockUri(directory) as never,
      fetchImpl,
    );

    try {
      expect(await manager.getValidAccessToken()).toBe(refreshedAccessToken);
      expect(refreshCalls).toBe(2);
    } finally {
      manager.dispose();
    }
  });

  test("serializes sign-out behind refresh so rotated credentials cannot reappear", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glow-oauth-"));
    temporaryDirectories.push(directory);
    const subject = "00000000-0000-4000-8000-000000000001";
    const session = storedSession(subject, "expired-access", "refresh-token", Date.now() - 1);
    const hub = new SecretHub({ "glow.oauth.session.v1": JSON.stringify(session) });
    const secrets = hub.connect(0);
    const refreshedAccessToken = jwt(subject);
    const fetchImpl = mock(async () => {
      await wait(80);
      return Response.json({
        access_token: refreshedAccessToken,
        refresh_token: "rotated-refresh",
        token_type: "bearer",
        expires_in: 3600,
        scope: "email",
      });
    }) as unknown as typeof fetch;
    const manager = new OAuthSessionManager(
      secrets as never,
      new MockUri(directory) as never,
      fetchImpl,
    );

    try {
      const refresh = manager.getValidAccessToken();
      await wait(10);
      const signOut = manager.clearSession();
      expect(await refresh).toBe(refreshedAccessToken);
      await signOut;
      expect(await manager.hasSession()).toBe(false);
    } finally {
      manager.dispose();
    }
  });
});

type SecretChange = { key: string };

class MockSecretStorage {
  private readonly values: Map<string, string>;
  private readonly emitter = new MockEventEmitter<SecretChange>();

  constructor(
    initial: Record<string, string>,
    private readonly hub: SecretHub,
    readonly lagMs: number,
  ) {
    this.values = new Map(Object.entries(initial));
  }

  readonly onDidChange = this.emitter.event;

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    this.emitter.fire({ key });
    this.hub.publish(this, key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.emitter.fire({ key });
    this.hub.publish(this, key, undefined);
  }

  apply(key: string, value: string | undefined): void {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
    this.emitter.fire({ key });
  }
}

class SecretHub {
  private readonly members = new Set<MockSecretStorage>();

  constructor(private readonly source: Record<string, string>) {}

  connect(lagMs: number): MockSecretStorage {
    const storage = new MockSecretStorage(this.source, this, lagMs);
    this.members.add(storage);
    return storage;
  }

  publish(origin: MockSecretStorage, key: string, value: string | undefined): void {
    if (value === undefined) delete this.source[key];
    else this.source[key] = value;
    for (const member of this.members) {
      if (member === origin) continue;
      setTimeout(() => member.apply(key, value), member.lagMs);
    }
  }
}

function storedSession(
  subject: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
) {
  return {
    version: 1,
    generation: "00000000-0000-4000-8000-000000000002",
    storedAt: Date.now() - 1_000,
    clientId: PRODUCTION_OAUTH_CLIENT_ID,
    accessToken,
    refreshToken,
    tokenType: "bearer",
    expiresAt,
    scope: "email",
    subject,
  };
}

function jwt(subject: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ sub: subject })).toString("base64url");
  return `${header}.${payload}.signature`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
