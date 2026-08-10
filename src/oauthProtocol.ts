export const AUTH_ORIGIN = "https://auth.justglow.dev";
export const SUPABASE_OAUTH_TOKEN_ENDPOINT =
  "https://pkxugzwphkgpjjfjysyq.supabase.co/auth/v1/oauth/token";
export const SUPABASE_OAUTH_USERINFO_ENDPOINT =
  "https://pkxugzwphkgpjjfjysyq.supabase.co/auth/v1/oauth/userinfo";
export const EXTENSION_REDIRECT_URI = "https://auth.justglow.dev/extension/callback";
export const PRODUCTION_OAUTH_CLIENT_ID = "9cacc440-55f7-4efe-b8f8-4e5e4c805248";
export const PAIRING_PROTOCOL_VERSION = 2;
export const OAUTH_SCOPE = "email";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type StartResponse = {
  protocolVersion: 2;
  scope: "email";
  requestId: string;
  requestSecret: string;
  verificationUri: string;
  requestExpiresIn: 3600;
};

export type AuthorizationCodeReady = {
  status: "authorization_code_ready";
  authorizationCode: string;
  state: string;
};

export function normalizePairingCode(value: string): string | null {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/[ \t\r\n]/g, "").replace("-", "");
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

export function validateStartResponse(value: unknown): StartResponse {
  if (!isRecord(value)) throw new Error("Glow received an invalid pairing response.");
  const requestId = readNonEmptyString(value.requestId);
  const requestSecret = readNonEmptyString(value.requestSecret);
  const verificationUri = readNonEmptyString(value.verificationUri);
  if (
    value.protocolVersion !== PAIRING_PROTOCOL_VERSION ||
    value.scope !== OAUTH_SCOPE ||
    !requestId ||
    !UUID_PATTERN.test(requestId) ||
    !requestSecret ||
    !BASE64URL_PATTERN.test(requestSecret) ||
    !verificationUri ||
    value.requestExpiresIn !== 3600
  ) {
    throw new Error("Glow received an invalid pairing response.");
  }
  const uri = new URL(verificationUri);
  if (
    uri.protocol !== "https:" ||
    uri.host !== "auth.justglow.dev" ||
    uri.pathname !== "/code" ||
    uri.searchParams.get("request") !== requestId
  ) {
    throw new Error("Glow received an invalid verification address.");
  }
  return {
    protocolVersion: 2,
    scope: "email",
    requestId,
    requestSecret,
    verificationUri,
    requestExpiresIn: 3600,
  };
}

export function buildRedeemBody(
  requestId: string,
  code: string,
): { requestId: string; code: string } {
  return { requestId, code };
}

export function validateAuthorizationCodeReady(
  value: unknown,
): AuthorizationCodeReady {
  if (!isRecord(value) || value.status !== "authorization_code_ready") {
    throw new Error("Glow received an invalid authorization response.");
  }
  const authorizationCode = readNonEmptyString(value.authorizationCode);
  const state = readNonEmptyString(value.state);
  if (!authorizationCode || !state) {
    throw new Error("Glow received an invalid authorization response.");
  }
  return {
    status: "authorization_code_ready",
    authorizationCode,
    state,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
