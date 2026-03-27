/**
 * @module
 *
 * SSO credential resolution: config file parsing, token caching, and automatic
 * token refresh against AWS Cognito.
 *
 * @internal — not part of the public API surface. Consumed by {@link Seclai}.
 */
import type { FetchLike } from "./client";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Resolved SSO profile settings. */
export interface SsoProfile {
  ssoAccountId?: string | undefined;
  ssoRegion: string;
  ssoClientId: string;
  ssoDomain: string;
}

/** Contents of a single SSO cache file. */
export interface SsoCacheEntry {
  accessToken: string;
  refreshToken?: string;
  idToken?: string | undefined;
  expiresAt: string; // ISO-8601
  clientId: string;
  region: string;
  cognitoDomain: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_CONFIG_DIR = ".seclai";
const SSO_CACHE_DIR = "sso/cache";
const CONFIG_FILE = "config";
const EXPIRY_BUFFER_MS = 30_000; // 30 seconds
const DEFAULT_API_KEY_HEADER = "x-api-key";

/** Default SSO domain (production Cognito). Override with `SECLAI_SSO_DOMAIN` or config file. */
export const DEFAULT_SSO_DOMAIN = "auth.seclai.com";
/** Default SSO client ID (production public client). Override with `SECLAI_SSO_CLIENT_ID` or config file. */
export const DEFAULT_SSO_CLIENT_ID = "4bgf8v9qmc5puivbaqon9n5lmr";
/** Default SSO region. Override with `SECLAI_SSO_REGION` or config file. */
export const DEFAULT_SSO_REGION = "us-west-2";

// ─── Environment helpers ─────────────────────────────────────────────────────

function getEnv(name: string): string | undefined {
  const p = (globalThis as any)?.process;
  return p?.env?.[name];
}

function getHomeDir(): string | undefined {
  const p = (globalThis as any)?.process;
  return p?.env?.HOME ?? p?.env?.USERPROFILE;
}

// ─── SHA-1 hash ──────────────────────────────────────────────────────────────

async function sha1Hex(input: string): Promise<string> {
  // Prefer Node.js crypto when available
  try {
    // @ts-expect-error -- resolved at runtime; no @types/node in this package
    const { createHash } = await import("node:crypto");
    return createHash("sha1").update(input).digest("hex");
  } catch {
    // Fall back to Web Crypto API
    const encoded = new TextEncoder().encode(input);
    const buffer = await crypto.subtle.digest("SHA-1", encoded);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}

/**
 * Compute the cache filename for a given domain + clientId.
 *
 * @param domain - The Cognito domain (e.g. `"auth.example.com"`).
 * @param clientId - The Cognito app client ID.
 * @returns SHA-1 hex digest of `"domain|clientId"`.
 */
export async function cacheFileName(domain: string, clientId: string): Promise<string> {
  return sha1Hex(`${domain}|${clientId}`);
}

// ─── INI parser ──────────────────────────────────────────────────────────────

/**
 * Minimal INI parser matching AWS config format:
 * - `[default]` section
 * - `[profile <name>]` sections
 * - `key = value` pairs
 * - Lines starting with `#` or `;` are comments
 *
 * @param content - Raw INI file content.
 * @returns Map of section names to key-value pairs.
 */
export function parseIni(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let currentSection: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      const raw = sectionMatch[1]!.trim();
      // `[default]` stays as "default", `[profile foo]` becomes "foo"
      currentSection = raw.startsWith("profile ")
        ? raw.slice("profile ".length).trim()
        : raw;
      sections[currentSection] ??= {};
      continue;
    }

    if (currentSection !== null) {
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim();
        sections[currentSection]![key] = value;
      }
    }
  }

  return sections;
}

// ─── File system (Node.js only) ──────────────────────────────────────────────

interface FsModule {
  readFileSync(path: string, encoding: string): string;
  writeFileSync(path: string, data: string, options?: { mode?: number }): void;
  mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): void;
  existsSync(path: string): boolean;
  unlinkSync(path: string): void;
  renameSync(oldPath: string, newPath: string): void;
}

interface PathModule {
  join(...parts: string[]): string;
}

let _fs: FsModule | null = null;
let _path: PathModule | null = null;

async function getFs(): Promise<FsModule> {
  if (!_fs) {
    // @ts-expect-error -- resolved at runtime; no @types/node in this package
    _fs = (await import("node:fs")) as unknown as FsModule;
  }
  return _fs;
}

async function getPath(): Promise<PathModule> {
  if (!_path) {
    // @ts-expect-error -- resolved at runtime; no @types/node in this package
    _path = (await import("node:path")) as unknown as PathModule;
  }
  return _path;
}

// ─── Config dir resolution ───────────────────────────────────────────────────

/**
 * Resolve the config directory path.
 *
 * @param override - Explicit directory path (highest priority).
 * @returns Resolved absolute path to the config directory.
 * @throws {Error} If the home directory cannot be determined and no override is provided.
 */
export async function resolveConfigDir(override?: string): Promise<string> {
  if (override) return override;

  const envDir = getEnv("SECLAI_CONFIG_DIR");
  if (envDir) return envDir;

  const home = getHomeDir();
  if (!home) {
    throw new Error("Cannot determine home directory. Set SECLAI_CONFIG_DIR.");
  }

  const pathMod = await getPath();
  return pathMod.join(home, DEFAULT_CONFIG_DIR);
}

// ─── Profile resolution ─────────────────────────────────────────────────────

/**
 * Load and resolve an SSO profile from the config file.
 * Non-default profiles inherit unset keys from `[default]`.
 * All profiles fall back to built-in defaults and environment variable overrides.
 *
 * **Node.js only** — this function uses `node:fs` and `node:path` internally
 * and will throw in browser/edge-worker runtimes.
 *
 * @param configDir - Resolved config directory path.
 * @param profileName - Profile name to look up (`"default"` or a named profile).
 * @returns The resolved profile. Always returns a valid profile using built-in defaults.
 */
export async function loadSsoProfile(
  configDir: string,
  profileName: string,
): Promise<SsoProfile> {
  const fs = await getFs();
  const pathMod = await getPath();

  let merged: Record<string, string> = {};

  const configPath = pathMod.join(configDir, CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8");
    const sections = parseIni(content);

    const defaultSection = sections["default"] ?? {};
    const profileSection = profileName === "default" ? defaultSection : sections[profileName];

    if (profileSection) {
      merged = profileName === "default" ? profileSection : { ...defaultSection, ...profileSection };
    }
  }

  // Environment variables override config file values
  const ssoDomain = getEnv("SECLAI_SSO_DOMAIN") ?? merged["sso_domain"] ?? DEFAULT_SSO_DOMAIN;
  const ssoClientId = getEnv("SECLAI_SSO_CLIENT_ID") ?? merged["sso_client_id"] ?? DEFAULT_SSO_CLIENT_ID;
  const ssoRegion = getEnv("SECLAI_SSO_REGION") ?? merged["sso_region"] ?? DEFAULT_SSO_REGION;
  const ssoAccountId = merged["sso_account_id"] || undefined;

  return { ssoAccountId, ssoRegion, ssoClientId, ssoDomain };
}

// ─── Cache I/O ───────────────────────────────────────────────────────────────

/**
 * Read a cached SSO token from disk.
 *
 * @param configDir - Resolved config directory path.
 * @param profile - SSO profile (used to derive the cache filename).
 * @returns The cached entry, or `null` if not found or unreadable.
 */
/** Resolve the full path to a profile's SSO cache file. */
async function resolveCachePath(
  configDir: string,
  profile: SsoProfile,
): Promise<string> {
  const pathMod = await getPath();
  const hash = await cacheFileName(profile.ssoDomain, profile.ssoClientId);
  return pathMod.join(configDir, SSO_CACHE_DIR, `${hash}.json`);
}

export async function readSsoCache(
  configDir: string,
  profile: SsoProfile,
): Promise<SsoCacheEntry | null> {
  const fs = await getFs();

  const cachePath = await resolveCachePath(configDir, profile);

  if (!fs.existsSync(cachePath)) return null;

  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    return JSON.parse(raw) as SsoCacheEntry;
  } catch {
    return null;
  }
}

/**
 * Write a cached SSO token to disk atomically.
 * Creates the cache directory if it doesn't exist.
 *
 * @param configDir - Resolved config directory path.
 * @param profile - SSO profile (used to derive the cache filename).
 * @param entry - Token data to persist.
 */
export async function writeSsoCache(
  configDir: string,
  profile: SsoProfile,
  entry: SsoCacheEntry,
): Promise<void> {
  const fs = await getFs();
  const pathMod = await getPath();

  const cacheDir = pathMod.join(configDir, SSO_CACHE_DIR);
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });

  const cachePath = await resolveCachePath(configDir, profile);
  const tmpPath = `${cachePath}.tmp`;

  fs.writeFileSync(tmpPath, JSON.stringify(entry, null, 2), { mode: 0o600 });
  // On Windows, renameSync fails if destination exists — delete first (best-effort)
  if (fs.existsSync(cachePath)) {
    try { fs.unlinkSync(cachePath); } catch { /* let renameSync throw if needed */ }
  }
  fs.renameSync(tmpPath, cachePath);
}

/**
 * Delete a cached SSO token file.
 *
 * @param configDir - Resolved config directory path.
 * @param profile - SSO profile (used to derive the cache filename).
 */
export async function deleteSsoCache(
  configDir: string,
  profile: SsoProfile,
): Promise<void> {
  const fs = await getFs();

  const cachePath = await resolveCachePath(configDir, profile);

  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
  }
}

// ─── Token validation ────────────────────────────────────────────────────────

/**
 * Check if a cached token is still valid (with 30s buffer).
 *
 * @param entry - The cached token entry to check.
 * @returns `true` if the token expires more than 30 seconds in the future.
 */
export function isTokenValid(entry: SsoCacheEntry): boolean {
  const expiresAt = new Date(entry.expiresAt).getTime();
  return Date.now() + EXPIRY_BUFFER_MS < expiresAt;
}

// ─── Token refresh ───────────────────────────────────────────────────────────

/**
 * Refresh an access token using a Cognito refresh_token grant.
 *
 * @param profile - SSO profile with Cognito domain and client ID.
 * @param refreshTokenValue - The refresh token to exchange.
 * @param fetcher - A `fetch`-compatible function for making HTTP requests.
 * @returns A fresh {@link SsoCacheEntry} with the new tokens.
 * @throws {Error} If the Cognito token endpoint returns a non-OK status.
 */
export async function refreshToken(
  profile: SsoProfile,
  refreshTokenValue: string,
  fetcher: FetchLike,
): Promise<SsoCacheEntry> {
  const tokenUrl = `https://${profile.ssoDomain}/oauth2/token`;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: profile.ssoClientId,
    refresh_token: refreshTokenValue,
  });

  const response = await fetcher(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token refresh failed (HTTP ${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    id_token?: string;
    refresh_token?: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshTokenValue,
    idToken: data.id_token ?? undefined,
    expiresAt,
    clientId: profile.ssoClientId,
    region: profile.ssoRegion,
    cognitoDomain: profile.ssoDomain,
  };
}

// ─── Credential chain resolver ───────────────────────────────────────────────

/** Options for resolving the credential chain. */
export interface CredentialChainOptions {
  /** Explicit API key (highest priority). */
  apiKey?: string | undefined;
  /** Explicit static bearer token. */
  accessToken?: string | undefined;
  /** Dynamic bearer token provider. */
  accessTokenProvider?: (() => string | Promise<string>) | undefined;
  /** Name of the profile from ~/.seclai/config. */
  profile?: string | undefined;
  /** Override config directory path. */
  configDir?: string | undefined;
  /** Whether to auto-refresh expired SSO tokens. Defaults to true. */
  autoRefresh?: boolean | undefined;
  /** Account ID override (takes precedence over profile's sso_account_id). */
  accountId?: string | undefined;
  /** Header name for API key auth. */
  apiKeyHeader?: string | undefined;
  /** fetch implementation for token refresh. */
  fetch?: FetchLike | undefined;
}

/**
 * Resolved authentication state used throughout the client lifecycle.
 * Created once by {@link resolveCredentialChain} and passed to
 * {@link resolveAuthHeaders} on every request.
 */
export interface AuthState {
  mode: "apiKey" | "bearerStatic" | "bearerProvider" | "sso";
  apiKey?: string;
  apiKeyHeader: string;
  accessToken?: string;
  accessTokenProvider?: () => string | Promise<string>;
  accountId?: string | undefined;
  ssoProfile?: SsoProfile;
  configDir?: string;
  autoRefresh: boolean;
  fetcher?: FetchLike | undefined;
  /** @internal Coalesces concurrent SSO token refresh attempts. */
  _refreshPromise?: Promise<string> | undefined;
}

/**
 * Resolve the credential chain and return an AuthState.
 * This is called once at client construction time.
 *
 * Resolution order:
 * 1. Explicit `apiKey` option
 * 2. Explicit `accessToken` option
 * 3. Explicit `accessTokenProvider` option
 * 4. `SECLAI_API_KEY` environment variable
 * 5. SSO profile from `~/.seclai/config`
 *
 * @param opts - Credential chain options.
 * @returns Resolved authentication state.
 * @throws {Error} If no credentials are found.
 */
export async function resolveCredentialChain(
  opts: CredentialChainOptions,
): Promise<AuthState> {
  const apiKeyHeader = opts.apiKeyHeader ?? DEFAULT_API_KEY_HEADER;

  // 1. Explicit apiKey option
  if (opts.apiKey) {
    return {
      mode: "apiKey",
      apiKey: opts.apiKey,
      apiKeyHeader,
      accountId: opts.accountId,
      autoRefresh: false,
    };
  }

  // 2. Explicit accessToken (mutual exclusion already checked by caller)
  if (opts.accessToken) {
    return {
      mode: "bearerStatic",
      accessToken: opts.accessToken,
      apiKeyHeader,
      accountId: opts.accountId,
      autoRefresh: false,
    };
  }

  // 3. Explicit accessTokenProvider
  if (opts.accessTokenProvider) {
    return {
      mode: "bearerProvider",
      accessTokenProvider: opts.accessTokenProvider,
      apiKeyHeader,
      accountId: opts.accountId,
      autoRefresh: false,
    };
  }

  // 4. SECLAI_API_KEY env var
  const envApiKey = getEnv("SECLAI_API_KEY");
  if (envApiKey) {
    return {
      mode: "apiKey",
      apiKey: envApiKey,
      apiKeyHeader,
      accountId: opts.accountId,
      autoRefresh: false,
    };
  }

  // 5. Profile-based SSO resolution
  try {
    const configDir = await resolveConfigDir(opts.configDir);
    const profileName = opts.profile ?? getEnv("SECLAI_PROFILE") ?? "default";
    const ssoProfile = await loadSsoProfile(configDir, profileName);

    return {
      mode: "sso",
      apiKeyHeader,
      accountId: opts.accountId ?? ssoProfile.ssoAccountId,
      ssoProfile,
      configDir,
      autoRefresh: opts.autoRefresh !== false,
      fetcher: opts.fetch,
    };
  } catch {
    // Config dir not found — fall through
  }

  // 6. Nothing found
  throw new Error(
    "Missing credentials. Provide apiKey, accessToken, set SECLAI_API_KEY, or run `seclai auth login`.",
  );
}

/**
 * Resolve authentication headers from the current AuthState.
 * Called per-request to handle dynamic token providers and SSO cache refresh.
 *
 * @param state - The resolved authentication state.
 * @returns Headers object with the appropriate auth header(s) set.
 */
export async function resolveAuthHeaders(
  state: AuthState,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  switch (state.mode) {
    case "apiKey":
      headers[state.apiKeyHeader] = state.apiKey!;
      break;

    case "bearerStatic":
      headers["authorization"] = `Bearer ${state.accessToken!}`;
      break;

    case "bearerProvider": {
      const token = await Promise.resolve(state.accessTokenProvider!());
      headers["authorization"] = `Bearer ${token}`;
      break;
    }

    case "sso": {
      const token = await resolveSsoToken(state);
      headers["authorization"] = `Bearer ${token}`;
      break;
    }
  }

  if (state.accountId) {
    headers["x-account-id"] = state.accountId;
  }

  return headers;
}

/** Resolve a valid SSO token, refreshing from cache if needed. */
async function resolveSsoToken(state: AuthState): Promise<string> {
  const profile = state.ssoProfile!;
  const configDir = state.configDir!;

  const cached = await readSsoCache(configDir, profile);

  if (cached && isTokenValid(cached)) {
    return cached.accessToken;
  }

  if (cached?.refreshToken && state.autoRefresh) {
    // Coalesce concurrent refresh attempts
    if (state._refreshPromise) {
      return state._refreshPromise;
    }

    const fetcher = state.fetcher ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetcher) {
      throw new Error("No fetch implementation available for token refresh.");
    }

    state._refreshPromise = (async () => {
      try {
        const refreshed = await refreshToken(profile, cached.refreshToken!, fetcher);
        await writeSsoCache(configDir, profile, refreshed);
        return refreshed.accessToken;
      } finally {
        state._refreshPromise = undefined;
      }
    })();
    return state._refreshPromise;
  }

  throw new Error(
    `SSO token expired. Run \`seclai auth login\` to re-authenticate.`,
  );
}
