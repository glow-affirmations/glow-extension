import * as vscode from "vscode";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import {
  AUTH_ORIGIN,
  buildRedeemBody,
  EXTENSION_REDIRECT_URI,
  normalizePairingCode,
  OAUTH_SCOPE,
  PAIRING_PROTOCOL_VERSION,
  PRODUCTION_OAUTH_CLIENT_ID,
  SUPABASE_OAUTH_TOKEN_ENDPOINT,
  SUPABASE_OAUTH_USERINFO_ENDPOINT,
  validateAuthorizationCodeReady,
  validateStartResponse,
} from "./oauthProtocol.js";

export {
  AUTH_ORIGIN,
  buildRedeemBody,
  EXTENSION_REDIRECT_URI,
  normalizePairingCode,
  OAUTH_SCOPE,
  PAIRING_PROTOCOL_VERSION,
  PRODUCTION_OAUTH_CLIENT_ID,
  SUPABASE_OAUTH_TOKEN_ENDPOINT,
  SUPABASE_OAUTH_USERINFO_ENDPOINT,
  validateAuthorizationCodeReady,
  validateStartResponse,
} from "./oauthProtocol.js";

const SESSION_SECRET_KEY = "glow.oauth.session.v1";
const REFRESH_LOCK_FILE = "oauth-refresh.lock";
const SESSION_MARKER_FILE = "oauth-session-state.v1.json";
const TOKEN_EXPIRY_SKEW_MS = 90_000;
const AUTO_REFRESH_TICK_MS = 30_000;
const REFRESH_FAILURE_COOLDOWN_MS = 60_000;
const REFRESH_RETRY_WINDOW_MS = 30_000;
const SESSION_COHERENCE_WAIT_MS = 3_000;
const REFRESH_LOCK_WAIT_MS = 35_000;
const REFRESH_LOCK_STALE_MS = 45_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OAuthIdentity = {
  id: string;
};

export type StoredOAuthSessionV1 = {
  version: 1;
  generation: string;
  storedAt: number;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: "bearer";
  expiresAt: number;
  scope: string | null;
  subject: string;
};

export type PairingViewState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "complete" }
  | {
      status: "waiting_for_code";
      expiresAt: string;
      canReopenBrowser: true;
      message: string | null;
    }
  | {
      status: "redeeming" | "exchanging_tokens";
      expiresAt: string;
      canReopenBrowser: false;
    }
  | {
      status: "expired" | "locked" | "denied" | "failed";
      message: string;
      canStartAgain: true;
    };

type PairingAttempt = {
  localAttemptId: string;
  requestId: string;
  requestSecret: string;
  verificationUri: string;
  verifier: string;
  state: string;
  expiresAt: number;
  abortController: AbortController;
};

type TokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string | null;
};

type LockLease = {
  ownerId: string;
  handle: FileHandle;
  uri: vscode.Uri;
};

type SessionMarkerV1 =
  | {
      version: 1;
      status: "active";
      generation: string;
      storedAt: number;
      expiresAt: number;
      refreshRetryAt?: number;
    }
  | {
      version: 1;
      status: "signed_out";
      storedAt: number;
    };

type RefreshFailure = {
  generation: string;
  error: unknown;
  expiresAt: number;
};

export class OAuthSessionManager implements vscode.Disposable {
  private readonly sessionEmitter = new vscode.EventEmitter<void>();
  private readonly secretChangeSubscription: vscode.Disposable;
  private refreshPromise: Promise<string | null> | null = null;
  private lastRefreshFailure: RefreshFailure | null = null;
  private sharedRefreshCooldown: { generation: string; expiresAt: number } | null =
    null;
  private readonly autoRefreshTimer: ReturnType<typeof setInterval>;
  private readonly initialRefreshTimer: ReturnType<typeof setTimeout>;
  private disposed = false;

  readonly onDidChangeSession = this.sessionEmitter.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly storageUri: vscode.Uri,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.secretChangeSubscription = this.secrets.onDidChange((event) => {
      if (event.key !== SESSION_SECRET_KEY) return;
      this.lastRefreshFailure = null;
      this.sessionEmitter.fire();
    });
    this.autoRefreshTimer = setInterval(
      () => void this.autoRefreshTick(),
      AUTO_REFRESH_TICK_MS,
    );
    unrefTimer(this.autoRefreshTimer);
    this.initialRefreshTimer = setTimeout(() => void this.autoRefreshTick(), 0);
    unrefTimer(this.initialRefreshTimer);
  }

  async hasSession(): Promise<boolean> {
    const [session, marker] = await Promise.all([
      this.readSecretSession(),
      this.readSessionMarker(),
    ]);
    if (!marker) return session !== null;
    if (marker.status === "active") return true;
    return session !== null && session.storedAt > marker.storedAt;
  }

  async getIdentity(): Promise<OAuthIdentity | null> {
    if (!(await this.readSession())) return null;
    const accessToken = await this.getValidAccessToken();
    if (!accessToken) return null;
    const current = await this.readSession();
    return current ? { id: current.subject } : null;
  }

  async getValidAccessToken(): Promise<string | null> {
    const session = await this.readSession();
    if (!session) return null;
    if (session.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS) {
      return session.accessToken;
    }
    const cachedFailure = this.failureFor(session);
    if (cachedFailure) {
      if (session.expiresAt > Date.now()) return session.accessToken;
      throw cachedFailure.error;
    }
    return this.refreshSingleFlight(REFRESH_LOCK_WAIT_MS);
  }

  async refreshAccessTokenAfterRejection(): Promise<string | null> {
    const rejectedSession = await this.readSession();
    if (!rejectedSession) return null;

    if (this.refreshPromise) {
      await this.refreshPromise;
      const refreshedSession = await this.readSession();
      if (!refreshedSession) return null;
      if (refreshedSession.generation !== rejectedSession.generation) {
        return refreshedSession.accessToken;
      }
    }

    return this.refreshSingleFlight(
      REFRESH_LOCK_WAIT_MS,
      rejectedSession.generation,
    );
  }

  async exchangeAuthorizationCode(
    authorizationCode: string,
    verifier: string,
  ): Promise<void> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      client_id: PRODUCTION_OAUTH_CLIENT_ID,
      redirect_uri: EXTENSION_REDIRECT_URI,
      code_verifier: verifier,
    });
    const token = await this.requestToken(body, null);
    if (!token.refreshToken) {
      throw new AuthError("Supabase did not return a refresh token.");
    }
    const subject = await this.fetchUserInfoSubject(token.accessToken);
    await this.withRefreshLock(REFRESH_LOCK_WAIT_MS, async () => {
      await this.storeSession({
        version: 1,
        generation: randomUUID(),
        storedAt: Date.now(),
        clientId: PRODUCTION_OAUTH_CLIENT_ID,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken!,
        tokenType: "bearer",
        expiresAt: Date.now() + token.expiresIn * 1_000,
        scope: token.scope,
        subject,
      });
    });
  }

  async clearSession(): Promise<void> {
    await this.withRefreshLock(REFRESH_LOCK_WAIT_MS, () => this.clearSessionUnderLock());
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.autoRefreshTimer);
    clearTimeout(this.initialRefreshTimer);
    this.secretChangeSubscription.dispose();
    this.sessionEmitter.dispose();
  }

  private async refreshSingleFlight(
    lockWaitMs: number,
    rejectedGeneration: string | null = null,
  ): Promise<string | null> {
    if (this.refreshPromise) return this.refreshPromise;
    const refreshPromise = this.refreshUnderLock(
      lockWaitMs,
      rejectedGeneration,
    );
    this.refreshPromise = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
    }
  }

  private async autoRefreshTick(): Promise<void> {
    if (this.disposed || this.refreshPromise) return;
    try {
      const session = await this.readSession();
      if (
        !session ||
        session.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS ||
        this.failureFor(session)
      ) {
        return;
      }
      await this.refreshSingleFlight(0);
    } catch (error) {
      if (error instanceof RefreshLockUnavailableError) return;
      console.warn(
        "[Glow auth] Background session refresh failed.",
        safeAuthErrorMessage(error),
      );
    }
  }

  private async refreshUnderLock(
    lockWaitMs: number,
    rejectedGeneration: string | null = null,
  ): Promise<string | null> {
    return this.withRefreshLock(lockWaitMs, async () => {
      const current = await this.readSession();
      if (!current) return null;
      const forcedRefresh = rejectedGeneration !== null;
      if (forcedRefresh && current.generation !== rejectedGeneration) {
        return current.accessToken;
      }
      if (
        !forcedRefresh &&
        current.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS
      ) {
        return current.accessToken;
      }
      const cachedFailure = forcedRefresh ? null : this.failureFor(current);
      if (cachedFailure) {
        if (current.expiresAt > Date.now()) return current.accessToken;
        throw cachedFailure.error;
      }

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: current.clientId,
      });
      try {
        const token = await this.requestRefreshToken(body, current.refreshToken);
        const subject = accessTokenSubject(token.accessToken);
        if (subject !== current.subject) {
          throw new AuthError("The refreshed session belongs to a different user.");
        }
        const refreshed = await this.storeSession({
          ...current,
          generation: randomUUID(),
          storedAt: Date.now(),
          accessToken: token.accessToken,
          refreshToken: token.refreshToken ?? current.refreshToken,
          expiresAt: Date.now() + token.expiresIn * 1_000,
          scope: token.scope ?? current.scope,
        });
        return refreshed.accessToken;
      } catch (error) {
        if (error instanceof OAuthTokenError && error.oauthError === "invalid_grant") {
          const latest = await this.waitForNewerSession(current.generation);
          if (latest) {
            this.lastRefreshFailure = null;
            return latest.expiresAt > Date.now() ? latest.accessToken : null;
          }
        }

        await this.rememberRefreshFailure(current, error);
        if (current.expiresAt > Date.now()) return current.accessToken;

        if (error instanceof OAuthTokenError && !error.retryable) {
          await this.clearSessionUnderLock();
          return null;
        }
        throw error;
      }
    });
  }

  private async withRefreshLock<T>(
    waitMs: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquireRefreshLock(waitMs);
    const heartbeat = setInterval(() => {
      const now = new Date();
      void lease.handle.utimes(now, now).catch(() => undefined);
    }, 5_000);
    unrefTimer(heartbeat);
    try {
      return await operation();
    } finally {
      clearInterval(heartbeat);
      await this.releaseRefreshLock(lease);
    }
  }

  private async requestRefreshToken(
    body: URLSearchParams,
    fallbackRefreshToken: string,
  ): Promise<TokenResponse> {
    const startedAt = Date.now();
    let attempt = 0;
    while (true) {
      try {
        return await this.requestToken(body, fallbackRefreshToken);
      } catch (error) {
        if (!isRetryableOAuthSessionError(error)) throw error;
        const exponentialDelay = 200 * 2 ** attempt;
        const retryDelay =
          error instanceof OAuthTokenError && error.retryAfterMs !== null
            ? Math.max(exponentialDelay, error.retryAfterMs)
            : exponentialDelay;
        if (Date.now() + retryDelay - startedAt >= REFRESH_RETRY_WINDOW_MS) throw error;
        await delay(retryDelay);
        attempt += 1;
      }
    }
  }

  private async requestToken(
    body: URLSearchParams,
    fallbackRefreshToken: string | null,
  ): Promise<TokenResponse> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      SUPABASE_OAUTH_TOKEN_ENDPOINT,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
      REQUEST_TIMEOUT_MS,
    );
    let payload: unknown;
    try {
      payload = await readJson(response);
    } catch (error) {
      if (response.ok) throw error;
      payload = null;
    }
    if (!response.ok) {
      const oauthError =
        isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
      throw new OAuthTokenError(
        oauthError,
        response.status,
        retryAfterMilliseconds(response),
        "Glow could not refresh the secure session.",
      );
    }
    if (!isRecord(payload)) throw new AuthError("Supabase returned an invalid token response.");
    const accessToken = readNonEmptyString(payload.access_token);
    const responseRefreshToken = readNonEmptyString(payload.refresh_token);
    const tokenType = readNonEmptyString(payload.token_type)?.toLowerCase();
    const expiresIn = readPositiveNumber(payload.expires_in);
    const scope = typeof payload.scope === "string" ? payload.scope : null;
    if (
      !accessToken ||
      !(responseRefreshToken ?? fallbackRefreshToken) ||
      tokenType !== "bearer" ||
      !expiresIn ||
      expiresIn > MAX_TOKEN_LIFETIME_SECONDS ||
      (scope !== null && !scope.split(/\s+/).includes(OAUTH_SCOPE))
    ) {
      throw new AuthError("Supabase returned an invalid token response.");
    }
    return {
      accessToken,
      refreshToken: responseRefreshToken,
      expiresIn,
      scope,
    };
  }

  private async fetchUserInfoSubject(accessToken: string): Promise<string> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      SUPABASE_OAUTH_USERINFO_ENDPOINT,
      {
        method: "GET",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
      REQUEST_TIMEOUT_MS,
    );
    const payload = await readJson(response);
    if (!response.ok || !isRecord(payload)) {
      throw new AuthError("Glow could not validate the secure session.");
    }
    const subject = readNonEmptyString(payload.sub);
    if (!subject || !UUID_PATTERN.test(subject)) {
      throw new AuthError("Supabase returned an invalid user identity.");
    }
    return subject;
  }

  private async readSession(): Promise<StoredOAuthSessionV1 | null> {
    const deadline = Date.now() + SESSION_COHERENCE_WAIT_MS;
    let waitMs = 40;
    while (true) {
      const [session, marker] = await Promise.all([
        this.readSecretSession(),
        this.readSessionMarker(),
      ]);
      this.noteSharedRefreshCooldown(marker);
      const decision = coherentSession(session, marker);
      if (decision !== "wait") return decision;
      if (Date.now() >= deadline) {
        throw new SessionStorageUnavailableError(
          "Glow is still loading the secure session saved by another window.",
        );
      }
      await delay(waitMs);
      waitMs = Math.min(waitMs * 2, 320);
    }
  }

  private async readSecretSession(): Promise<StoredOAuthSessionV1 | null> {
    const raw = await this.secrets.get(SESSION_SECRET_KEY);
    if (!raw) return null;
    try {
      return parseStoredSession(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async storeSession(
    session: StoredOAuthSessionV1,
  ): Promise<StoredOAuthSessionV1> {
    const marker = await this.readSessionMarker();
    const storedAt = Math.max(
      Date.now(),
      session.storedAt,
      marker ? marker.storedAt + 1 : 0,
    );
    const stored = { ...session, storedAt };
    await this.secrets.store(SESSION_SECRET_KEY, JSON.stringify(stored));
    try {
      await this.writeSessionMarker({
        version: 1,
        status: "active",
        generation: stored.generation,
        storedAt,
        expiresAt: stored.expiresAt,
      });
    } catch (error) {
      console.warn(
        "[Glow auth] The shared session marker could not be updated.",
        safeAuthErrorMessage(error),
      );
    }
    this.lastRefreshFailure = null;
    this.sharedRefreshCooldown = null;
    return stored;
  }

  private async clearSessionUnderLock(): Promise<void> {
    const [session, marker] = await Promise.all([
      this.readSecretSession(),
      this.readSessionMarker(),
    ]);
    const storedAt = Math.max(
      Date.now(),
      session ? session.storedAt + 1 : 0,
      marker ? marker.storedAt + 1 : 0,
    );
    await this.writeSessionMarker({ version: 1, status: "signed_out", storedAt });
    await this.secrets.delete(SESSION_SECRET_KEY);
    this.lastRefreshFailure = null;
    this.sharedRefreshCooldown = null;
  }

  private async waitForNewerSession(
    generation: string,
  ): Promise<StoredOAuthSessionV1 | null> {
    const deadline = Date.now() + SESSION_COHERENCE_WAIT_MS;
    let waitMs = 40;
    while (true) {
      const latest = await this.readSecretSession();
      if (latest && latest.generation !== generation) return latest;
      if (Date.now() >= deadline) return null;
      await delay(waitMs);
      waitMs = Math.min(waitMs * 2, 320);
    }
  }

  private failureFor(session: StoredOAuthSessionV1): RefreshFailure | null {
    const failure = this.lastRefreshFailure;
    if (
      failure &&
      failure.generation === session.generation &&
      failure.expiresAt > Date.now()
    ) {
      return failure;
    }
    if (failure) {
      this.lastRefreshFailure = null;
    }
    const shared = this.sharedRefreshCooldown;
    if (
      shared &&
      shared.generation === session.generation &&
      shared.expiresAt > Date.now()
    ) {
      return {
        generation: shared.generation,
        expiresAt: shared.expiresAt,
        error: new SharedRefreshCooldownError(
          "Glow is waiting before retrying the secure session.",
        ),
      };
    }
    if (shared) this.sharedRefreshCooldown = null;
    return null;
  }

  private async rememberRefreshFailure(
    session: StoredOAuthSessionV1,
    error: unknown,
  ): Promise<void> {
    const expiresAt = Date.now() + REFRESH_FAILURE_COOLDOWN_MS;
    this.lastRefreshFailure = {
      generation: session.generation,
      error,
      expiresAt,
    };
    this.sharedRefreshCooldown = { generation: session.generation, expiresAt };
    const marker = await this.readSessionMarker();
    if (
      !marker ||
      (marker.status === "active" && marker.generation === session.generation)
    ) {
      try {
        await this.writeSessionMarker({
          version: 1,
          status: "active",
          generation: session.generation,
          storedAt: session.storedAt,
          expiresAt: session.expiresAt,
          refreshRetryAt: expiresAt,
        });
      } catch {
        // The in-process cooldown still prevents a local refresh storm.
      }
    }
  }

  private noteSharedRefreshCooldown(marker: SessionMarkerV1 | null): void {
    if (
      marker?.status === "active" &&
      typeof marker.refreshRetryAt === "number" &&
      marker.refreshRetryAt > Date.now()
    ) {
      this.sharedRefreshCooldown = {
        generation: marker.generation,
        expiresAt: marker.refreshRetryAt,
      };
      return;
    }
    this.sharedRefreshCooldown = null;
  }

  private async readSessionMarker(): Promise<SessionMarkerV1 | null> {
    const uri = vscode.Uri.joinPath(this.storageUri, SESSION_MARKER_FILE);
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return parseSessionMarker(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (error) {
      if (isFileNotFound(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private async writeSessionMarker(marker: SessionMarkerV1): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    const target = vscode.Uri.joinPath(this.storageUri, SESSION_MARKER_FILE);
    const temporary = vscode.Uri.joinPath(
      this.storageUri,
      `${SESSION_MARKER_FILE}.${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await vscode.workspace.fs.writeFile(
        temporary,
        new TextEncoder().encode(JSON.stringify(marker)),
      );
      await vscode.workspace.fs.rename(temporary, target, { overwrite: true });
    } finally {
      await deleteIfPresent(temporary);
    }
  }

  private async acquireRefreshLock(waitMs: number): Promise<LockLease> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    const uri = vscode.Uri.joinPath(this.storageUri, REFRESH_LOCK_FILE);
    const ownerId = randomUUID();
    const deadline = Date.now() + waitMs;
    while (!this.disposed) {
      try {
        const handle = await open(uri.fsPath, "wx");
        await handle.writeFile(
          JSON.stringify({ ownerId, pid: process.pid, createdAt: Date.now() }),
          "utf8",
        );
        return { ownerId, handle, uri };
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        await removeStaleOrAbandonedLock(uri, REFRESH_LOCK_STALE_MS);
        if (Date.now() >= deadline) {
          throw new RefreshLockUnavailableError(
            "Another Glow window is still refreshing the session.",
          );
        }
        await delay(50 + Math.floor(Math.random() * 50));
      }
    }
    throw new AuthError("Glow is shutting down.");
  }

  private async releaseRefreshLock(lease: LockLease): Promise<void> {
    await lease.handle.close();
    try {
      const bytes = await vscode.workspace.fs.readFile(lease.uri);
      const value = JSON.parse(new TextDecoder().decode(bytes)) as { ownerId?: unknown };
      if (value.ownerId === lease.ownerId) await deleteIfPresent(lease.uri);
    } catch (error) {
      if (!isFileNotFound(error) && !(error instanceof SyntaxError)) throw error;
    }
  }
}

export class ExtensionPairingController implements vscode.Disposable {
  private readonly stateEmitter = new vscode.EventEmitter<PairingViewState>();
  private attempt: PairingAttempt | null = null;
  private startAbortController: AbortController | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private currentState: PairingViewState = { status: "idle" };
  private disposed = false;

  readonly onDidChangeState = this.stateEmitter.event;

  constructor(
    private readonly extensionVersion: string,
    private readonly sessions: OAuthSessionManager,
    private readonly fetchImpl: typeof fetch,
  ) {}

  getState(): PairingViewState {
    return this.currentState;
  }

  async begin(): Promise<void> {
    if (this.attempt) {
      await this.reopen();
      return;
    }
    if (this.startAbortController) return;
    this.setState({ status: "starting" });
    const verifier = base64Url(randomBytes(32));
    const state = base64Url(randomBytes(32));
    const codeChallenge = base64Url(createHash("sha256").update(verifier).digest());
    const localAttemptId = randomUUID();
    const abortController = new AbortController();
    this.startAbortController = abortController;

    try {
      const response = await fetchWithTimeout(
        this.fetchImpl,
        `${AUTH_ORIGIN}/api/extension-auth/start`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            protocolVersion: PAIRING_PROTOCOL_VERSION,
            clientId: PRODUCTION_OAUTH_CLIENT_ID,
            redirectUri: EXTENSION_REDIRECT_URI,
            codeChallenge,
            codeChallengeMethod: "S256",
            state,
            extensionVersion: this.extensionVersion,
          }),
          signal: abortController.signal,
        },
        REQUEST_TIMEOUT_MS,
      );
      const payload = await readJson(response);
      if (
        response.status === 400 &&
        isRecord(payload) &&
        payload.error === "unsupported_protocol_version"
      ) {
        throw new CompatibilityError();
      }
      if (response.status !== 201) throw brokerHttpError(response.status);
      const start = validateStartResponse(payload);
      if (this.startAbortController !== abortController || this.disposed) return;
      const attempt: PairingAttempt = {
        localAttemptId,
        requestId: start.requestId,
        requestSecret: start.requestSecret,
        verificationUri: start.verificationUri,
        verifier,
        state,
        expiresAt: Date.now() + start.requestExpiresIn * 1_000,
        abortController,
      };
      this.startAbortController = undefined;
      this.attempt = attempt;
      this.expiryTimer = setTimeout(
        () => this.requireLiveAttempt(),
        Math.max(0, attempt.expiresAt - Date.now()),
      );
      this.setState({
        status: "waiting_for_code",
        expiresAt: new Date(attempt.expiresAt).toISOString(),
        canReopenBrowser: true,
        message: null,
      });
      await this.openVerificationPage(attempt);
    } catch (error) {
      if (this.startAbortController === abortController) {
        this.startAbortController = undefined;
      }
      if (this.disposed || abortController.signal.aborted) return;
      this.clearAttempt();
      this.setTerminalFailure(error);
    }
  }

  async submitCode(rawCode: string): Promise<void> {
    if (this.currentState.status !== "waiting_for_code") return;
    const attempt = this.requireLiveAttempt();
    if (!attempt) return;
    const code = normalizePairingCode(rawCode);
    if (!code) {
      this.setState({
        status: "waiting_for_code",
        expiresAt: new Date(attempt.expiresAt).toISOString(),
        canReopenBrowser: true,
        message: "Enter the six-digit code shown in your browser.",
      });
      return;
    }
    this.setState({
      status: "redeeming",
      expiresAt: new Date(attempt.expiresAt).toISOString(),
      canReopenBrowser: false,
    });

    let response: Response;
    let payload: unknown;
    try {
      response = await fetchWithTimeout(
        this.fetchImpl,
        `${AUTH_ORIGIN}/api/extension-auth/redeem`,
        {
          method: "POST",
          redirect: "error",
          headers: pairingHeaders(attempt.requestSecret, true),
          body: JSON.stringify(buildRedeemBody(attempt.requestId, code)),
          signal: attempt.abortController.signal,
        },
        REQUEST_TIMEOUT_MS,
      );
      payload = await readJson(response);
    } catch (error) {
      if (this.disposed || attempt.abortController.signal.aborted) return;
      if (isAmbiguousNetworkError(error)) {
        await this.recoverAmbiguousRedemption(attempt);
        return;
      }
      this.handleAttemptError(error);
      return;
    }

    try {
      if (
        response.status === 422 &&
        isRecord(payload) &&
        payload.status === "code_required" &&
        payload.error === "invalid_or_expired_pairing_code"
      ) {
        this.setState({
          status: "waiting_for_code",
          expiresAt: new Date(attempt.expiresAt).toISOString(),
          canReopenBrowser: true,
          message: "That code is invalid or expired. Get a new code and try again.",
        });
        return;
      }
      if (response.status !== 200) throw brokerHttpError(response.status);
      await this.completeAuthorization(attempt, payload);
    } catch (error) {
      if (this.disposed || attempt.abortController.signal.aborted) return;
      this.handleAttemptError(error);
    }
  }

  async reopen(): Promise<void> {
    const attempt = this.requireLiveAttempt();
    if (!attempt) return;
    await this.openVerificationPage(attempt);
  }

  acknowledgeComplete(): void {
    if (this.currentState.status === "complete") {
      this.setState({ status: "idle" });
    }
  }

  async restart(): Promise<void> {
    await this.cancel(false);
    await this.begin();
  }

  async cancel(notifyBroker = true): Promise<void> {
    const attempt = this.attempt;
    this.clearAttempt();
    this.setState({ status: "idle" });
    if (!attempt || !notifyBroker) return;
    try {
      await fetchWithTimeout(
        this.fetchImpl,
        `${AUTH_ORIGIN}/api/extension-auth/cancel`,
        {
          method: "POST",
          redirect: "error",
          headers: pairingHeaders(attempt.requestSecret, true),
          body: JSON.stringify({ requestId: attempt.requestId }),
        },
        REQUEST_TIMEOUT_MS,
      );
    } catch {
      // Cancellation is intentionally best effort.
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearAttempt();
    this.stateEmitter.dispose();
  }

  private async recoverAmbiguousRedemption(attempt: PairingAttempt): Promise<void> {
    if (!this.isCurrent(attempt) || !this.requireLiveAttempt()) return;
    try {
      const statusUrl = new URL(`${AUTH_ORIGIN}/api/extension-auth/status`);
      statusUrl.searchParams.set("request", attempt.requestId);
      const response = await fetchWithTimeout(
        this.fetchImpl,
        statusUrl.toString(),
        {
          method: "GET",
          redirect: "error",
          headers: pairingHeaders(attempt.requestSecret, false),
          signal: attempt.abortController.signal,
        },
        REQUEST_TIMEOUT_MS,
      );
      const payload = await readJson(response);
      if (response.status !== 200 || !isRecord(payload) || typeof payload.status !== "string") {
        throw brokerHttpError(response.status);
      }
      switch (payload.status) {
        case "code_required":
        case "code_ready":
          this.setState({
            status: "waiting_for_code",
            expiresAt: new Date(attempt.expiresAt).toISOString(),
            canReopenBrowser: true,
            message: "The connection was interrupted. Enter the code again to continue.",
          });
          return;
        case "authorization_code_ready":
          await this.completeAuthorization(attempt, payload);
          return;
        case "expired":
        case "locked":
        case "denied":
        case "failed":
        case "cancelled":
        case "consumed":
          this.finishTerminalStatus(payload.status);
          return;
        default:
          throw new AuthError("Glow could not reconcile this sign-in attempt.");
      }
    } catch (error) {
      if (this.disposed || attempt.abortController.signal.aborted) return;
      this.handleAttemptError(error);
    }
  }

  private async completeAuthorization(
    attempt: PairingAttempt,
    payload: unknown,
  ): Promise<void> {
    if (!this.isCurrent(attempt)) return;
    const ready = validateAuthorizationCodeReady(payload);
    if (!safeEqual(ready.state, attempt.state)) {
      throw new AuthError("Glow could not verify this sign-in attempt.");
    }
    this.setState({
      status: "exchanging_tokens",
      expiresAt: new Date(attempt.expiresAt).toISOString(),
      canReopenBrowser: false,
    });
    await this.sessions.exchangeAuthorizationCode(
      ready.authorizationCode,
      attempt.verifier,
    );
    this.clearAttempt();
    this.setState({ status: "complete" });
  }

  private async openVerificationPage(attempt: PairingAttempt): Promise<void> {
    const opened = await vscode.env.openExternal(vscode.Uri.parse(attempt.verificationUri));
    if (!opened && this.isCurrent(attempt)) {
      this.setState({
        status: "waiting_for_code",
        expiresAt: new Date(attempt.expiresAt).toISOString(),
        canReopenBrowser: true,
        message: "Glow could not open the code page. Try reopening it.",
      });
    }
  }

  private requireLiveAttempt(): PairingAttempt | null {
    const attempt = this.attempt;
    if (!attempt) return null;
    if (Date.now() < attempt.expiresAt) return attempt;
    this.clearAttempt();
    this.setState({
      status: "expired",
      message: "This pairing request expired. Start again to receive a new code.",
      canStartAgain: true,
    });
    return null;
  }

  private finishTerminalStatus(status: string): void {
    this.clearAttempt();
    if (status === "cancelled") {
      this.setState({ status: "idle" });
      return;
    }
    const terminalStatus =
      status === "expired" || status === "locked" || status === "denied"
        ? status
        : "failed";
    const message =
      terminalStatus === "expired"
        ? "This pairing request expired. Start again to receive a new code."
        : terminalStatus === "locked"
          ? "This pairing request was locked after too many attempts. Start again."
          : terminalStatus === "denied"
            ? "Sign in was not approved. You can start again whenever you are ready."
            : "Glow could not finish signing in. Please start again.";
    this.setState({ status: terminalStatus, message, canStartAgain: true });
  }

  private handleAttemptError(error: unknown): void {
    this.clearAttempt();
    this.setTerminalFailure(error);
  }

  private setTerminalFailure(error: unknown): void {
    this.setState({
      status: "failed",
      message:
        error instanceof CompatibilityError
          ? "This version of Glow cannot connect to the sign-in service. Update Glow and try again."
          : error instanceof BrokerAuthError
            ? error.message
            : "Glow could not connect to the sign-in service. Please start again.",
      canStartAgain: true,
    });
  }

  private clearAttempt(): void {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.startAbortController?.abort();
    this.startAbortController = undefined;
    this.attempt?.abortController.abort();
    this.attempt = null;
  }

  private isCurrent(attempt: PairingAttempt): boolean {
    return this.attempt?.localAttemptId === attempt.localAttemptId;
  }

  private setState(state: PairingViewState): void {
    this.currentState = state;
    this.stateEmitter.fire(state);
  }
}

function parseStoredSession(value: unknown): StoredOAuthSessionV1 | null {
  if (!isRecord(value)) return null;
  const accessToken = readNonEmptyString(value.accessToken);
  const refreshToken = readNonEmptyString(value.refreshToken);
  const subject = readNonEmptyString(value.subject);
  const generation = readNonEmptyString(value.generation);
  const storedAt =
    typeof value.storedAt === "number" &&
    Number.isFinite(value.storedAt) &&
    value.storedAt >= 0
      ? value.storedAt
      : 0;
  if (
    value.version !== 1 ||
    value.clientId !== PRODUCTION_OAUTH_CLIENT_ID ||
    !accessToken ||
    !refreshToken ||
    value.tokenType !== "bearer" ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt) ||
    !subject ||
    !UUID_PATTERN.test(subject) ||
    !generation
  ) {
    return null;
  }
  return {
    version: 1,
    generation,
    storedAt,
    clientId: PRODUCTION_OAUTH_CLIENT_ID,
    accessToken,
    refreshToken,
    tokenType: "bearer",
    expiresAt: value.expiresAt,
    scope: typeof value.scope === "string" ? value.scope : null,
    subject,
  };
}

function parseSessionMarker(value: unknown): SessionMarkerV1 | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.storedAt !== "number" ||
    !Number.isFinite(value.storedAt) ||
    value.storedAt < 0
  ) {
    return null;
  }
  if (value.status === "signed_out") {
    return { version: 1, status: "signed_out", storedAt: value.storedAt };
  }
  const generation = readNonEmptyString(value.generation);
  if (
    value.status !== "active" ||
    !generation ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt)
  ) {
    return null;
  }
  return {
    version: 1,
    status: "active",
    generation,
    storedAt: value.storedAt,
    expiresAt: value.expiresAt,
    ...(typeof value.refreshRetryAt === "number" &&
    Number.isFinite(value.refreshRetryAt) &&
    value.refreshRetryAt > 0
      ? { refreshRetryAt: value.refreshRetryAt }
      : {}),
  };
}

export function coherentSession(
  session: StoredOAuthSessionV1 | null,
  marker: SessionMarkerV1 | null,
): StoredOAuthSessionV1 | null | "wait" {
  if (!marker) return session;
  if (marker.status === "signed_out") {
    return session && session.storedAt > marker.storedAt ? session : null;
  }
  if (
    session &&
    (session.generation === marker.generation || session.storedAt > marker.storedAt)
  ) {
    return session;
  }
  return "wait";
}

function accessTokenSubject(accessToken: string): string {
  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    throw new AuthError("Supabase returned an invalid access token.");
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as unknown;
    const subject = isRecord(payload) ? readNonEmptyString(payload.sub) : null;
    if (!subject || !UUID_PATTERN.test(subject)) throw new Error("invalid subject");
    return subject;
  } catch {
    throw new AuthError("Supabase returned an invalid access token.");
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const timeoutController = new AbortController();
  const sourceSignal = init.signal;
  const abort = () => timeoutController.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) abort();
  sourceSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: timeoutController.signal });
  } finally {
    clearTimeout(timer);
    sourceSignal?.removeEventListener("abort", abort);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AuthError("Glow received an unexpectedly large authentication response.");
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new AuthError("Glow received an unexpectedly large authentication response.");
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AuthError("Glow received an invalid authentication response.");
  }
}

function pairingHeaders(requestSecret: string, hasBody: boolean): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Glow-Pairing ${requestSecret}`,
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}

function brokerHttpError(status: number): Error {
  if (status === 401) {
    return new BrokerAuthError("This pairing request is no longer valid. Start again.");
  }
  if (status === 404) {
    return new BrokerAuthError("This pairing request could not be found. Start again.");
  }
  return new AuthError("The Glow sign-in service rejected the request.");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function isAmbiguousNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function retryAfterMilliseconds(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 10_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(0, date - Date.now()), 10_000);
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
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "ENOENT" ||
      (error as { code?: unknown }).code === "FileNotFound")
  );
}

async function removeStaleOrAbandonedLock(
  uri: vscode.Uri,
  staleAfterMs: number,
): Promise<void> {
  try {
    const [stat, bytes] = await Promise.all([
      vscode.workspace.fs.stat(uri),
      vscode.workspace.fs.readFile(uri),
    ]);
    let pid: number | null = null;
    try {
      const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      if (
        isRecord(value) &&
        typeof value.pid === "number" &&
        Number.isInteger(value.pid) &&
        value.pid > 0
      ) {
        pid = value.pid;
      }
    } catch {
      // An unreadable lock is handled by the mtime fallback.
    }
    if (
      Date.now() - stat.mtime > staleAfterMs ||
      (pid !== null && !processIsAlive(pid))
    ) {
      await deleteIfPresent(uri);
    }
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ESRCH"
    );
  }
}

async function deleteIfPresent(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri);
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

function safeAuthErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown authentication error.";
}

class AuthError extends Error {}

class CompatibilityError extends AuthError {}

class BrokerAuthError extends AuthError {}

class SessionStorageUnavailableError extends AuthError {}

class RefreshLockUnavailableError extends AuthError {}

class SharedRefreshCooldownError extends AuthError {}

class OAuthTokenError extends AuthError {
  constructor(
    readonly oauthError: string | null,
    readonly status: number,
    readonly retryAfterMs: number | null,
    message: string,
  ) {
    super(message);
  }

  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export function isRetryableOAuthSessionError(error: unknown): boolean {
  return (
    error instanceof SessionStorageUnavailableError ||
    error instanceof RefreshLockUnavailableError ||
    error instanceof SharedRefreshCooldownError ||
    (error instanceof OAuthTokenError && error.retryable) ||
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error &&
      /fetch failed|failed to fetch|network|offline|econn|enotfound|timed?\s*out/i.test(
        error.message,
      ))
  );
}
