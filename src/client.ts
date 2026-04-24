/**
 * @module
 *
 * Main SDK client for the Seclai API.
 *
 * Exports the {@link Seclai} class which provides typed convenience methods for
 * every API endpoint, plus low-level {@link Seclai.request | request()} and
 * {@link Seclai.requestRaw | requestRaw()} escape hatches, streaming helpers,
 * and automatic pagination.
 */
import {
  SeclaiAPIStatusError,
  SeclaiAPIValidationError,
  SeclaiConfigurationError,
  SeclaiError,
  SeclaiStreamingError,
} from "./errors";
import type { AuthState } from "./auth";
import { resolveCredentialChain, resolveAuthHeaders } from "./auth";
import type {
  AgentRunEvent,
  AgentDefinitionResponse,
  AgentExportResponse,
  AgentListResponse,
  AgentRunListResponse,
  AgentRunRequest,
  AgentRunResponse,
  AgentRunStreamRequest,
  AgentSummaryResponse,
  AgentTraceSearchRequest,
  AgentTraceSearchResponse,
  AiAssistantAcceptRequest,
  AiAssistantAcceptResponse,
  AiAssistantFeedbackRequest,
  AiAssistantFeedbackResponse,
  AiAssistantGenerateRequest,
  AiAssistantGenerateResponse,
  AiConversationHistoryResponse,
  AddCommentRequest,
  AddConversationTurnRequest,
  ChangeStatusRequest,
  CompatibleRunListResponse,
  CompactionTestResponse,
  ContentDetailResponse,
  ContentEmbeddingsListResponse,
  ContentFileUploadResponse,
  CreateAgentRequest,
  CreateAlertConfigRequest,
  CreateEvaluationCriteriaRequest,
  CreateEvaluationResultRequest,
  CreateExportRequest,
  CreateKnowledgeBaseBody,
  CreateMemoryBankBody,
  CreateSolutionRequest,
  CreateSourceBody,
  EstimateExportRequest,
  EstimateExportResponse,
  EvaluationCriteriaResponse,
  EvaluationResultListResponse,
  EvaluationResultResponse,
  EvaluationResultSummaryResponse,
  EvaluationResultWithCriteriaListResponse,
  EvaluationRunSummaryListResponse,
  ExportListResponse,
  ExportResponse,
  FileUploadResponse,
  GenerateAgentStepsRequest,
  GenerateAgentStepsResponse,
  GenerateStepConfigRequest,
  GenerateStepConfigResponse,
  GovernanceAiAcceptResponse,
  GovernanceAiAssistantRequest,
  GovernanceAiAssistantResponse,
  GovernanceConversationResponse,
  HTTPValidationError,
  InlineTextReplaceRequest,
  InlineTextUploadRequest,
  KnowledgeBaseListResponse,
  KnowledgeBaseResponse,
  LinkResourcesRequest,
  ListOptions,
  MarkAiSuggestionRequest,
  MarkConversationTurnRequest,
  MemoryBankAcceptRequest,
  MemoryBankAiAssistantRequest,
  MemoryBankAiAssistantResponse,
  MemoryBankLastConversationResponse,
  MemoryBankListResponse,
  MemoryBankResponse,
  NonManualEvaluationSummaryResponse,
  OrganizationAlertPreferenceListResponse,
  PlaygroundCreateRequest,
  CreateExperimentInput,
  PromptModelResponse,
  ProviderGroupResponse,
  SolutionConversationResponse,
  SolutionListResponse,
  SolutionResponse,
  SortableListOptions,
  SourceEmbeddingMigrationResponse,
  SourceListResponse,
  SourceResponse,
  StandaloneTestCompactionRequest,
  StartSourceEmbeddingMigrationRequest,
  TestCompactionRequest,
  TestDraftEvaluationRequest,
  TestDraftEvaluationResponse,
  UnlinkResourcesRequest,
  UpdateAgentDefinitionRequest,
  UpdateAgentRequest,
  UpdateAlertConfigRequest,
  UpdateEvaluationCriteriaRequest,
  UpdateKnowledgeBaseBody,
  UpdateMemoryBankBody,
  UpdateOrganizationAlertPreferenceRequest,
  UpdateSolutionRequest,
  UpdateSourceBody,
  UploadAgentInputApiResponse,
} from "./types";

/** Default API base URL (can be overridden with `baseUrl` or `SECLAI_API_URL`). */
export const SECLAI_API_URL = "https://api.seclai.com";

/** A `fetch`-compatible function (e.g. `globalThis.fetch` or `undici.fetch`). */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Token provider: a synchronous or asynchronous function that returns an
 * access token string.  Called on every request to allow automatic refresh.
 */
export type AccessTokenProvider = () => string | Promise<string>;

/** Configuration for the {@link Seclai} client. */
export interface SeclaiOptions {
  /** API key used for authentication. Defaults to `process.env.SECLAI_API_KEY` when available. */
  apiKey?: string;
  /**
   * Static bearer access token **or** a provider function that returns one.
   * Mutually exclusive with `apiKey`.
   */
  accessToken?: string | AccessTokenProvider;
  /** API base URL. Defaults to `process.env.SECLAI_API_URL` when available, else {@link SECLAI_API_URL}. */
  baseUrl?: string;
  /** Header name to use for the API key. Defaults to `x-api-key`. */
  apiKeyHeader?: string;
  /** Extra headers to include on every request. */
  defaultHeaders?: Record<string, string>;
  /** Optional `fetch` implementation for environments without a global `fetch`. */
  fetch?: FetchLike;
  /**
   * SSO profile name to load from `~/.seclai/config`.
   * Defaults to `process.env.SECLAI_PROFILE`, then `"default"`.
   */
  profile?: string;
  /**
   * Override the config directory path (default: `SECLAI_CONFIG_DIR` env var or `~/.seclai/`).
   */
  configDir?: string;
  /**
   * Whether to auto-refresh expired SSO tokens. Defaults to `true`.
   * Set to `false` in environments that should not write to disk.
   */
  autoRefresh?: boolean;
  /**
   * Target organization account ID. Sent as `X-Account-Id` header.
   * Overrides the profile's `sso_account_id` when using SSO auth.
   */
  accountId?: string;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function getEnv(name: string): string | undefined {
  const p = (globalThis as any)?.process;
  return p?.env?.[name];
}

function buildURL(baseUrl: string, path: string, query?: Record<string, unknown>): URL {
  // Ensure baseUrl ends with "/" so new URL() preserves its path component.
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  // Strip leading "/" from path so it's treated as relative to base.
  const relative = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(relative, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function safeText(response: Response): Promise<string | undefined> {
  try {
    return await response.clone().text();
  } catch {
    return undefined;
  }
}

async function safeJson(response: Response): Promise<unknown | undefined> {
  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}

type SseMessage = { event?: string; data?: string };

function createSseParser(onMessage: (msg: SseMessage) => void) {
  let buffer = "";
  let eventName: string | undefined;
  let dataLines: string[] = [];

  function dispatch() {
    if (!eventName && dataLines.length === 0) return;
    const msg: SseMessage = { data: dataLines.join("\n") };
    if (eventName !== undefined) msg.event = eventName;
    onMessage(msg);
    eventName = undefined;
    dataLines = [];
  }

  function feed(textChunk: string) {
    buffer += textChunk;
    while (true) {
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx === -1) return;

      let line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);

      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        dispatch();
        continue;
      }

      if (line.startsWith(":")) continue;

      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      if (field === "event") {
        eventName = value;
      } else if (field === "data") {
        dataLines.push(value);
      }
    }
  }

  return { feed, end: dispatch };
}

function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const present = signals.filter(Boolean) as AbortSignal[];
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const s of present) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

function toBlob(
  file: Blob | Uint8Array | ArrayBuffer | BufferSource,
  mimeType?: string,
): Blob {
  if (file instanceof Blob) return file;
  const opts = mimeType ? { type: mimeType } : undefined;
  if (file instanceof ArrayBuffer) return new Blob([new Uint8Array(file)], opts);
  return new Blob([file as unknown as BlobPart], opts);
}

const MIME_TYPES: Record<string, string> = {
  txt: "text/plain", html: "text/html", htm: "text/html", md: "text/markdown",
  csv: "text/csv", xml: "text/xml", json: "application/json",
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  msg: "application/vnd.ms-outlook", zip: "application/zip",
  epub: "application/epub+zip",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  bmp: "image/bmp", tiff: "image/tiff", webp: "image/webp",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac",
  ogg: "audio/ogg", mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
};

function inferMimeType(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext ? MIME_TYPES[ext] : undefined;
}

// ─── Client ──────────────────────────────────────────────────────────────────

/**
 * Seclai JavaScript/TypeScript client.
 *
 * Provides typed methods for every Seclai API endpoint, plus higher-level
 * abstractions for streaming, polling, and pagination.
 *
 * @example
 * ```ts
 * import { Seclai } from "@seclai/sdk";
 *
 * const client = new Seclai({ apiKey: "sk-..." });
 *
 * // List agents
 * const { items } = await client.listAgents();
 *
 * // Run an agent
 * const run = await client.runAgent("agent-id", { input: "Hello!" });
 *
 * // Stream an agent run
 * for await (const event of client.runStreamingAgent("agent-id", { input: "Hello!" })) {
 *   console.log(event.event, event.data);
 * }
 * ```
 */
export class Seclai {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetcher: FetchLike;
  private _authState: AuthState | null = null;
  private _authInitPromise: Promise<void> | null = null;
  private _authInitError: SeclaiConfigurationError | null = null;

  /**
   * Create a new Seclai client.
   *
   * Credentials are resolved via a chain (first match wins):
   * 1. Explicit `apiKey` option
   * 2. Explicit `accessToken` option (static string or provider function)
   * 3. `SECLAI_API_KEY` environment variable
   * 4. SSO profile from `~/.seclai/config` + cached tokens in `~/.seclai/sso/cache/`
   *
   * @param opts - Client configuration.
   * @throws {@link SeclaiConfigurationError} If no `fetch` implementation is available.
   * @throws {@link SeclaiConfigurationError} If both `apiKey` and `accessToken` are provided.
   */
  constructor(opts: SeclaiOptions = {}) {
    // Validate mutual exclusion
    if (opts.apiKey && opts.accessToken) {
      throw new SeclaiConfigurationError(
        "Provide either apiKey or accessToken, not both."
      );
    }

    const fetcher = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetcher) {
      throw new SeclaiConfigurationError(
        "No fetch implementation available. Provide opts.fetch or run in an environment with global fetch."
      );
    }

    this.baseUrl = opts.baseUrl ?? getEnv("SECLAI_API_URL") ?? SECLAI_API_URL;
    this.defaultHeaders = { ...(opts.defaultHeaders ?? {}) };
    this.fetcher = fetcher;

    // Resolve credential chain (may be async for SSO profile loading)
    const accessTokenProvider =
      typeof opts.accessToken === "function" ? opts.accessToken : undefined;
    const accessTokenStatic =
      typeof opts.accessToken === "string" ? opts.accessToken : undefined;

    this._authInitPromise = resolveCredentialChain({
      apiKey: opts.apiKey,
      accessToken: accessTokenStatic,
      accessTokenProvider,
      profile: opts.profile,
      configDir: opts.configDir,
      autoRefresh: opts.autoRefresh,
      accountId: opts.accountId,
      apiKeyHeader: opts.apiKeyHeader,
      fetch: fetcher,
    }).then((state) => {
      this._authState = state;
    }).catch((err) => {
      this._authInitError = new SeclaiConfigurationError(
        err instanceof Error ? err.message : String(err)
      );
    });
  }

  /** Ensure the credential chain has been resolved. */
  private async ensureAuth(): Promise<AuthState> {
    if (this._authInitPromise) {
      await this._authInitPromise;
      this._authInitPromise = null;
    }
    if (this._authInitError) {
      throw this._authInitError;
    }
    if (!this._authState) {
      throw new SeclaiConfigurationError(
        "Missing credentials. Provide apiKey, accessToken, set SECLAI_API_KEY, or run `seclai auth login`."
      );
    }
    return this._authState;
  }

  /** Resolve auth headers for the current request. */
  private async authHeaders(): Promise<Record<string, string>> {
    const state = await this.ensureAuth();
    return resolveAuthHeaders(state);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Low-level request
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Make a raw HTTP request to the Seclai API.
   *
   * This is a low-level escape hatch. For most operations, prefer the typed convenience methods.
   *
   * @param method - HTTP method (e.g. `"GET"`, `"POST"`).
   * @param path - Request path relative to `baseUrl` (e.g. `"/sources/"`).
   * @param opts - Query params, JSON body, per-request headers, and optional AbortSignal.
   * @returns Parsed JSON for JSON responses, raw text for non-JSON responses, or `null` for empty bodies.
   * @throws {@link SeclaiAPIValidationError} For validation errors (typically HTTP 422).
   * @throws {@link SeclaiAPIStatusError} For other non-success HTTP status codes.
   */
  async request(
    method: string,
    path: string,
    opts?: {
      query?: Record<string, unknown>;
      json?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    }
  ): Promise<unknown | string | null> {
    const url = buildURL(this.baseUrl, path, opts?.query);

    const authHeaders = await this.authHeaders();
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(opts?.headers ?? {}),
      ...authHeaders,
    };

    let body: BodyInit | undefined;
    if (opts?.json !== undefined) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      body = JSON.stringify(opts.json);
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = body;
    }
    if (opts?.signal) {
      init.signal = opts.signal;
    }
    const response = await this.fetcher(url, init);

    if (response.status === 204) return null;

    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");

    if (!response.ok) {
      const responseText = await safeText(response);
      if (response.status === 422) {
        const validation = (await safeJson(response)) as HTTPValidationError | undefined;
        throw new SeclaiAPIValidationError({
          message: "Validation error",
          statusCode: response.status,
          method,
          url: url.toString(),
          responseText,
          validationError: validation,
        });
      }
      throw new SeclaiAPIStatusError({
        message: `Request failed with status ${response.status}`,
        statusCode: response.status,
        method,
        url: url.toString(),
        responseText,
      });
    }

    if (!response.body) return null;

    if (isJson) {
      return (await response.json()) as unknown;
    }
    return await response.text();
  }

  /**
   * Make a raw HTTP request and return the raw `Response` object (for binary downloads, etc.).
   *
   * @param method - HTTP method.
   * @param path - Request path relative to `baseUrl`.
   * @param opts - Query params, JSON body, per-request headers, and optional AbortSignal.
   * @returns The raw `Response` object.
   * @throws {SeclaiAPIValidationError} On HTTP 422 responses.
   * @throws {SeclaiAPIStatusError} On other non-2xx responses.
   */
  async requestRaw(
    method: string,
    path: string,
    opts?: {
      query?: Record<string, unknown>;
      json?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    }
  ): Promise<Response> {
    const url = buildURL(this.baseUrl, path, opts?.query);

    const authHeaders = await this.authHeaders();
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(opts?.headers ?? {}),
      ...authHeaders,
    };

    let body: BodyInit | undefined;
    if (opts?.json !== undefined) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      body = JSON.stringify(opts.json);
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;
    if (opts?.signal) init.signal = opts.signal;

    const response = await this.fetcher(url, init);

    if (!response.ok) {
      const responseText = await safeText(response);
      if (response.status === 422) {
        const validation = (await safeJson(response)) as HTTPValidationError | undefined;
        throw new SeclaiAPIValidationError({
          message: "Validation error",
          statusCode: response.status,
          method,
          url: url.toString(),
          responseText,
          validationError: validation,
        });
      }
      throw new SeclaiAPIStatusError({
        message: `Request failed with status ${response.status}`,
        statusCode: response.status,
        method,
        url: url.toString(),
        responseText,
      });
    }

    return response;
  }

  /** Shared multipart upload helper. */
  private async uploadFile(
    path: string,
    opts: {
      file: Blob | Uint8Array | ArrayBuffer | BufferSource;
      title?: string;
      metadata?: Record<string, unknown>;
      fileName?: string;
      mimeType?: string;
      signal?: AbortSignal;
    },
  ): Promise<unknown> {
    const url = buildURL(this.baseUrl, path);

    const authHeaders = await this.authHeaders();
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...authHeaders,
    };
    // Let fetch set the correct multipart Content-Type with boundary
    delete headers["content-type"];
    delete headers["Content-Type"];

    const form = new FormData();
    const mimeType = opts.mimeType ?? inferMimeType(opts.fileName);
    const blob = toBlob(opts.file, mimeType);
    form.set("file", blob, opts.fileName ?? "upload");

    if (opts.title !== undefined) form.set("title", opts.title);
    if (opts.metadata !== undefined) form.set("metadata", JSON.stringify(opts.metadata));

    const init: RequestInit = { method: "POST", headers, body: form };
    if (opts.signal) init.signal = opts.signal;

    const response = await this.fetcher(url, init);

    if (!response.ok) {
      const responseText = await safeText(response);
      if (response.status === 422) {
        const validation = (await safeJson(response)) as HTTPValidationError | undefined;
        throw new SeclaiAPIValidationError({
          message: "Validation error",
          statusCode: response.status,
          method: "POST",
          url: url.toString(),
          responseText,
          validationError: validation,
        });
      }
      throw new SeclaiAPIStatusError({
        message: `Request failed with status ${response.status}`,
        statusCode: response.status,
        method: "POST",
        url: url.toString(),
        responseText,
      });
    }

    return await response.json();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agents — CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List agents.
   *
   * @param opts - Pagination options.
   * @returns Paginated list of agents.
   */
  async listAgents(opts: ListOptions = {}): Promise<AgentListResponse> {
    return (await this.request("GET", "/agents", {
      query: { page: opts.page, limit: opts.limit },
    })) as AgentListResponse;
  }

  /**
   * Create a new agent.
   *
   * @param body - Agent creation payload (name, trigger type, template, etc.).
   * @returns Summary of the created agent.
   */
  async createAgent(body: CreateAgentRequest): Promise<AgentSummaryResponse> {
    return (await this.request("POST", "/agents", { json: body })) as AgentSummaryResponse;
  }

  /**
   * Get agent details including its definition.
   *
   * @param agentId - Agent identifier.
   * @returns Full agent metadata.
   */
  async getAgent(agentId: string): Promise<AgentSummaryResponse> {
    return (await this.request("GET", `/agents/${agentId}`)) as AgentSummaryResponse;
  }

  /**
   * Update an agent.
   *
   * @param agentId - Agent identifier.
   * @param body - Fields to update.
   * @returns Updated agent summary.
   */
  async updateAgent(agentId: string, body: UpdateAgentRequest): Promise<AgentSummaryResponse> {
    return (await this.request("PUT", `/agents/${agentId}`, { json: body })) as AgentSummaryResponse;
  }

  /**
   * Delete an agent.
   *
   * @param agentId - Agent identifier.
   */
  async deleteAgent(agentId: string): Promise<void> {
    await this.request("DELETE", `/agents/${agentId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Export
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Export an agent definition as a portable JSON snapshot.
   *
   * @param agentId - Agent identifier.
   * @param download - When true (default), the server sets Content-Disposition: attachment.
   * @returns The exported agent snapshot.
   */
  async exportAgent(agentId: string, download = true): Promise<AgentExportResponse> {
    return (await this.request("GET", `/agents/${agentId}/export`, {
      query: { download },
    })) as AgentExportResponse;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Definitions
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get an agent's full definition (steps, model config, etc.).
   *
   * @param agentId - Agent identifier.
   * @returns The agent definition.
   */
  async getAgentDefinition(agentId: string): Promise<AgentDefinitionResponse> {
    return (await this.request("GET", `/agents/${agentId}/definition`)) as AgentDefinitionResponse;
  }

  /**
   * Update an agent's definition.
   *
   * @param agentId - Agent identifier.
   * @param body - Updated definition payload.
   * @returns Updated agent definition.
   */
  async updateAgentDefinition(agentId: string, body: UpdateAgentDefinitionRequest): Promise<AgentDefinitionResponse> {
    return (await this.request("PUT", `/agents/${agentId}/definition`, { json: body })) as AgentDefinitionResponse;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Runs
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start an agent run.
   *
   * @param agentId - Agent identifier.
   * @param body - Run request payload (`input`, `metadata`, `priority`, etc.).
   * @returns The created agent run.
   */
  async runAgent(agentId: string, body: AgentRunRequest): Promise<AgentRunResponse> {
    return (await this.request("POST", `/agents/${agentId}/runs`, { json: body })) as AgentRunResponse;
  }

  /**
   * List runs for a specific agent.
   *
   * @param agentId - Agent identifier.
   * @param opts - Pagination and filter options.
   * @returns Paginated list of runs.
   */
  async listAgentRuns(
    agentId: string,
    opts: ListOptions & { status?: string } = {},
  ): Promise<AgentRunListResponse> {
    return (await this.request("GET", `/agents/${agentId}/runs`, {
      query: { page: opts.page, limit: opts.limit, status: opts.status },
    })) as AgentRunListResponse;
  }

  /**
   * Search agent runs (traces) across all agents.
   *
   * @param body - Search query and filters.
   * @returns Search results with matching runs.
   */
  async searchAgentRuns(body: AgentTraceSearchRequest): Promise<AgentTraceSearchResponse> {
    return (await this.request("POST", "/agents/runs/search", { json: body })) as AgentTraceSearchResponse;
  }

  /**
   * Get details of a specific agent run.
   *
   * @param runId - Run identifier.
   * @param opts - Optional flags.
   * @returns Agent run details.
   */
  async getAgentRun(
    runId: string,
    opts?: { includeStepOutputs?: boolean },
  ): Promise<AgentRunResponse> {
    return (await this.request("GET", `/agents/runs/${runId}`, opts?.includeStepOutputs ? {
      query: { include_step_outputs: true },
    } : undefined)) as AgentRunResponse;
  }

  /**
   * Delete an agent run.
   *
   * @param runId - Run identifier.
   */
  async deleteAgentRun(runId: string): Promise<void> {
    await this.request("DELETE", `/agents/runs/${runId}`);
  }

  /**
   * Cancel a running agent run.
   *
   * @param runId - Run identifier.
   * @returns Updated run (with cancelled status).
   */
  async cancelAgentRun(runId: string): Promise<AgentRunResponse> {
    return (await this.request("POST", `/agents/runs/${runId}/cancel`)) as AgentRunResponse;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Runs — Streaming
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run an agent in streaming mode (SSE) and wait for the final result.
   *
   * Consumes the entire SSE stream and returns only the terminal `done` payload.
   * For real-time event access, use {@link runStreamingAgent} instead.
   *
   * @param agentId - Agent identifier.
   * @param body - Streaming run request payload.
   * @param opts - Timeout and abort signal options.
   * @returns Final agent run payload from the `done` event.
   * @throws {@link SeclaiStreamingError} If the stream ends before a `done` event.
   */
  async runStreamingAgentAndWait(
    agentId: string,
    body: AgentRunStreamRequest,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<AgentRunResponse> {
    const url = buildURL(this.baseUrl, `/agents/${agentId}/runs/stream`);

    const authHdrs = await this.authHeaders();
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...authHdrs,
      accept: "text/event-stream",
      "content-type": "application/json",
    };

    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);

    const signal = anySignal([opts?.signal, timeoutController.signal]);

    let lastSeen: AgentRunResponse | undefined;

    try {
      const init: RequestInit = { method: "POST", headers, body: JSON.stringify(body) };
      if (signal) init.signal = signal;

      const response = await this.fetcher(url, init);

      // Handle error responses
      const contentType = response.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");

      if (!response.ok) {
        const responseText = await safeText(response);
        if (response.status === 422) {
          const validation = (await safeJson(response)) as HTTPValidationError | undefined;
          throw new SeclaiAPIValidationError({
            message: "Validation error",
            statusCode: response.status,
            method: "POST",
            url: url.toString(),
            responseText,
            validationError: validation,
          });
        }
        throw new SeclaiAPIStatusError({
          message: `Request failed with status ${response.status}`,
          statusCode: response.status,
          method: "POST",
          url: url.toString(),
          responseText,
        });
      }

      // If server returned JSON instead of SSE
      if (isJson) {
        return (await response.json()) as AgentRunResponse;
      }

      if (!response.body) {
        throw new SeclaiConfigurationError(
          "Streaming response body is not available in this environment. Provide a fetch implementation that supports ReadableStream bodies."
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let final: AgentRunResponse | undefined;

      const parser = createSseParser((msg) => {
        if (!msg.data) return;
        if (msg.event === "init" || msg.event === "done") {
          try {
            const parsed = JSON.parse(msg.data) as AgentRunResponse;
            lastSeen = parsed;
            if (msg.event === "done") final = parsed;
          } catch { /* ignore malformed JSON */ }
        }
      });

      while (!final) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parser.feed(decoder.decode(value, { stream: true }));
      }

      parser.end();

      if (final) return final;
      if (lastSeen && (lastSeen as any).status && (lastSeen as any).status !== "pending") {
        return lastSeen;
      }

      throw new SeclaiStreamingError("Stream ended before receiving a 'done' event.", lastSeen?.run_id);
    } catch (err) {
      if (timedOut) {
        throw new SeclaiStreamingError(
          `Timed out after ${timeoutMs}ms waiting for streaming agent run to complete.`,
          lastSeen?.run_id,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Run an agent in streaming mode and yield each SSE event as it arrives.
   *
   * This is an `AsyncGenerator` suitable for real-time UIs that want to render
   * step progress as it happens.
   *
   * @param agentId - Agent identifier.
   * @param body - Streaming run request payload.
   * @param opts - Timeout and abort signal options.
   * @yields {@link AgentRunEvent} for each SSE message.
   *
   * @example
   * ```ts
   * for await (const event of client.runStreamingAgent("agent-id", { input: "Hello!" })) {
   *   if (event.event === "done") {
   *     console.log("Final:", event.data);
   *   }
   * }
   * ```
   */
  async *runStreamingAgent(
    agentId: string,
    body: AgentRunStreamRequest,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): AsyncGenerator<AgentRunEvent, void, undefined> {
    const url = buildURL(this.baseUrl, `/agents/${agentId}/runs/stream`);

    const authHdrs = await this.authHeaders();
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...authHdrs,
      accept: "text/event-stream",
      "content-type": "application/json",
    };

    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);

    const signal = anySignal([opts?.signal, timeoutController.signal]);

    try {
      const init: RequestInit = { method: "POST", headers, body: JSON.stringify(body) };
      if (signal) init.signal = signal;

      const response = await this.fetcher(url, init);

      const contentType = response.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");

      if (!response.ok) {
        const responseText = await safeText(response);
        if (response.status === 422) {
          const validation = (await safeJson(response)) as HTTPValidationError | undefined;
          throw new SeclaiAPIValidationError({
            message: "Validation error",
            statusCode: response.status,
            method: "POST",
            url: url.toString(),
            responseText,
            validationError: validation,
          });
        }
        throw new SeclaiAPIStatusError({
          message: `Request failed with status ${response.status}`,
          statusCode: response.status,
          method: "POST",
          url: url.toString(),
          responseText,
        });
      }

      // If server returned JSON instead of SSE, yield it as a single "done" event
      if (isJson) {
        const data = (await response.json()) as AgentRunResponse;
        yield { event: "done", data };
        return;
      }

      if (!response.body) {
        throw new SeclaiConfigurationError(
          "Streaming response body is not available in this environment."
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const events: AgentRunEvent[] = [];

      const parser = createSseParser((msg) => {
        if (!msg.data) return;
        let data: unknown;
        try {
          data = JSON.parse(msg.data);
        } catch {
          data = msg.data;
        }
        events.push({ event: msg.event ?? "message", data });
      });

      while (true) {
        const { value, done } = await reader.read();
        if (value) parser.feed(decoder.decode(value, { stream: true }));

        // Yield all events that were parsed from this chunk
        while (events.length > 0) {
          yield events.shift()!;
        }

        if (done) break;
      }
      parser.end();

      // Yield any remaining events from end()
      while (events.length > 0) {
        yield events.shift()!;
      }
    } catch (err) {
      if (timedOut) {
        throw new SeclaiStreamingError(
          `Timed out after ${timeoutMs}ms waiting for streaming agent run to complete.`
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Runs — Polling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run an agent and poll until it reaches a terminal status.
   *
   * This is useful in environments where SSE streaming is unavailable.
   *
   * @param agentId - Agent identifier.
   * @param body - Run request payload.
   * @param opts - Polling configuration and abort signal.
   * @returns The terminal agent run.
   * @throws {@link SeclaiStreamingError} On timeout.
   */
  async runAgentAndPoll(
    agentId: string,
    body: AgentRunRequest,
    opts?: {
      /** Polling interval in ms (default: 2000). */
      pollIntervalMs?: number;
      /** Maximum time to wait in ms (default: 300000 = 5 min). */
      timeoutMs?: number;
      /** Include per-step outputs in the final result. */
      includeStepOutputs?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<AgentRunResponse> {
    const pollInterval = opts?.pollIntervalMs ?? 2_000;
    const timeout = opts?.timeoutMs ?? 300_000;
    const startTime = Date.now();

    const run = await this.runAgent(agentId, body);
    const runId = (run as any).id ?? (run as any).run_id;
    if (!runId) throw new SeclaiError("Agent run response did not contain an id.");

    while (true) {
      if (opts?.signal?.aborted) throw new SeclaiError("Polling aborted.");
      if (Date.now() - startTime > timeout) {
        throw new SeclaiStreamingError(`Polling timed out after ${timeout}ms.`, runId);
      }

      await new Promise((r) => setTimeout(r, pollInterval));

      const current = await this.getAgentRun(runId,
        opts?.includeStepOutputs ? { includeStepOutputs: true } : undefined,
      );
      const status = (current as any).status;
      if (status === "completed" || status === "failed" || status === "cancelled") {
        return current;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Run Evaluation Results
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List evaluation results for a specific agent run.
   *
   * @param agentId - Agent identifier.
   * @param runId - Run identifier.
   * @param opts - Pagination options.
   * @returns Paginated list of evaluation results.
   */
  async listRunEvaluationResults(
    agentId: string,
    runId: string,
    opts: ListOptions = {},
  ): Promise<EvaluationResultWithCriteriaListResponse> {
    return (await this.request("GET", `/agents/${agentId}/runs/${runId}/evaluation-results`, {
      query: { page: opts.page, limit: opts.limit },
    })) as EvaluationResultWithCriteriaListResponse;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Input Uploads
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Upload a file to use as input for a `dynamic_input` agent run.
   *
   * After uploading, poll {@link getAgentInputUploadStatus} until `status` is `ready`,
   * then pass `input_upload_id` to {@link runAgent}.
   *
   * @param agentId - Agent identifier.
   * @param opts - File payload and optional metadata.
   * @returns Upload response with the upload ID and status.
   */
  async uploadAgentInput(
    agentId: string,
    opts: {
      file: Blob | Uint8Array | ArrayBuffer | BufferSource;
      fileName?: string;
      mimeType?: string;
    },
  ): Promise<UploadAgentInputApiResponse> {
    return (await this.uploadFile(`/agents/${agentId}/upload-input`, opts)) as UploadAgentInputApiResponse;
  }

  /**
   * Get the status of an agent input upload.
   *
   * @param agentId - Agent identifier.
   * @param uploadId - Upload identifier.
   * @returns Upload status and metadata.
   */
  async getAgentInputUploadStatus(agentId: string, uploadId: string): Promise<UploadAgentInputApiResponse> {
    return (await this.request("GET", `/agents/${agentId}/input-uploads/${uploadId}`)) as UploadAgentInputApiResponse;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent AI Assistant (Steps Generation)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate agent workflow steps from natural language using AI.
   *
   * @param agentId - Agent identifier.
   * @param body - Generation request with user instructions.
   * @returns AI-generated step configuration.
   */
  async generateAgentSteps(agentId: string, body: GenerateAgentStepsRequest): Promise<GenerateAgentStepsResponse> {
    return (await this.request("POST", `/agents/${agentId}/ai-assistant/generate-steps`, { json: body })) as GenerateAgentStepsResponse;
  }

  /**
   * Generate a single step configuration using AI.
   *
   * @param agentId - Agent identifier.
   * @param body - Step config generation request.
   * @returns AI-generated step config.
   */
  async generateStepConfig(agentId: string, body: GenerateStepConfigRequest): Promise<GenerateStepConfigResponse> {
    return (await this.request("POST", `/agents/${agentId}/ai-assistant/step-config`, { json: body })) as GenerateStepConfigResponse;
  }

  /**
   * Get AI conversation history for an agent.
   *
   * @param agentId - Agent identifier.
   * @returns Conversation history.
   */
  async getAgentAiConversationHistory(agentId: string): Promise<AiConversationHistoryResponse> {
    return (await this.request("GET", `/agents/${agentId}/ai-assistant/conversations`)) as AiConversationHistoryResponse;
  }

  /**
   * Mark an AI suggestion as accepted or rejected.
   *
   * @param agentId - Agent identifier.
   * @param conversationId - Conversation turn identifier.
   * @param body - Mark request payload.
   */
  async markAgentAiSuggestion(agentId: string, conversationId: string, body: MarkAiSuggestionRequest): Promise<void> {
    await this.request("PATCH", `/agents/${agentId}/ai-assistant/${conversationId}`, { json: body });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Evaluation Criteria
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List evaluation criteria for an agent.
   *
   * @param agentId - Agent identifier.
   * @param opts - Pagination options.
   */
  async listEvaluationCriteria(agentId: string, opts: ListOptions = {}): Promise<EvaluationCriteriaResponse[]> {
    return (await this.request("GET", `/agents/${agentId}/evaluation-criteria`, {
      query: { page: opts.page, limit: opts.limit },
    })) as EvaluationCriteriaResponse[];
  }

  /**
   * Create evaluation criteria for an agent.
   *
   * @param agentId - Agent identifier.
   * @param body - Criteria definition.
   * @returns Created evaluation criteria.
   */
  async createEvaluationCriteria(agentId: string, body: CreateEvaluationCriteriaRequest): Promise<EvaluationCriteriaResponse> {
    return (await this.request("POST", `/agents/${agentId}/evaluation-criteria`, { json: body })) as EvaluationCriteriaResponse;
  }

  /**
   * Get a single evaluation criteria by ID.
   *
   * @param criteriaId - Criteria identifier.
   * @returns Evaluation criteria details.
   */
  async getEvaluationCriteria(criteriaId: string): Promise<EvaluationCriteriaResponse> {
    return (await this.request("GET", `/agents/evaluation-criteria/${criteriaId}`)) as EvaluationCriteriaResponse;
  }

  /**
   * Update an evaluation criteria.
   *
   * @param criteriaId - Criteria identifier.
   * @param body - Fields to update.
   * @returns Updated evaluation criteria.
   */
  async updateEvaluationCriteria(criteriaId: string, body: UpdateEvaluationCriteriaRequest): Promise<EvaluationCriteriaResponse> {
    return (await this.request("PATCH", `/agents/evaluation-criteria/${criteriaId}`, { json: body })) as EvaluationCriteriaResponse;
  }

  /**
   * Delete an evaluation criteria and all associated results.
   *
   * @param criteriaId - Criteria identifier.
   */
  async deleteEvaluationCriteria(criteriaId: string): Promise<void> {
    await this.request("DELETE", `/agents/evaluation-criteria/${criteriaId}`);
  }

  /**
   * Get the evaluation summary for a specific criteria.
   *
   * @param criteriaId - Criteria identifier.
   * @returns Evaluation result summary.
   */
  async getEvaluationCriteriaSummary(criteriaId: string): Promise<EvaluationResultSummaryResponse> {
    return (await this.request("GET", `/agents/evaluation-criteria/${criteriaId}/summary`)) as EvaluationResultSummaryResponse;
  }

  /**
   * List evaluation results for a specific criteria.
   *
   * @param criteriaId - Criteria identifier.
   * @param opts - Pagination options.
   */
  async listEvaluationResults(criteriaId: string, opts: ListOptions = {}): Promise<EvaluationResultListResponse> {
    return (await this.request("GET", `/agents/evaluation-criteria/${criteriaId}/results`, {
      query: { page: opts.page, limit: opts.limit },
    })) as EvaluationResultListResponse;
  }

  /**
   * Create a manual evaluation result for a criteria.
   *
   * @param criteriaId - Criteria identifier.
   * @param body - Evaluation result payload.
   * @returns Created evaluation result.
   */
  async createEvaluationResult(criteriaId: string, body: CreateEvaluationResultRequest): Promise<EvaluationResultResponse> {
    return (await this.request("POST", `/agents/evaluation-criteria/${criteriaId}/results`, { json: body })) as EvaluationResultResponse;
  }

  /**
   * List runs compatible with a specific evaluation criteria.
   *
   * @param criteriaId - Criteria identifier.
   * @param opts - Pagination options.
   */
  async listCompatibleRuns(criteriaId: string, opts: ListOptions = {}): Promise<CompatibleRunListResponse> {
    return (await this.request("GET", `/agents/evaluation-criteria/${criteriaId}/compatible-runs`, {
      query: { page: opts.page, limit: opts.limit },
    })) as CompatibleRunListResponse;
  }

  /**
   * Test a draft evaluation criteria without persisting it.
   *
   * @param agentId - Agent identifier.
   * @param body - Draft evaluation to test.
   * @returns Test evaluation response.
   */
  async testDraftEvaluation(agentId: string, body: TestDraftEvaluationRequest): Promise<TestDraftEvaluationResponse> {
    return (await this.request("POST", `/agents/${agentId}/evaluation-criteria/test-draft`, { json: body })) as TestDraftEvaluationResponse;
  }

  /**
   * List all evaluation results for an agent.
   *
   * @param agentId - Agent identifier.
   * @param opts - Pagination options.
   */
  async listAgentEvaluationResults(agentId: string, opts: ListOptions = {}): Promise<EvaluationResultWithCriteriaListResponse> {
    return (await this.request("GET", `/agents/${agentId}/evaluation-results`, {
      query: { page: opts.page, limit: opts.limit },
    })) as EvaluationResultWithCriteriaListResponse;
  }

  /**
   * List evaluation run summaries for an agent.
   *
   * @param agentId - Agent identifier.
   * @param opts - Pagination options.
   */
  async listEvaluationRuns(agentId: string, opts: ListOptions = {}): Promise<EvaluationRunSummaryListResponse> {
    return (await this.request("GET", `/agents/${agentId}/evaluation-runs`, {
      query: { page: opts.page, limit: opts.limit },
    })) as EvaluationRunSummaryListResponse;
  }

  /**
   * Get a summary of non-manual evaluations across an agent's runs.
   *
   * @param agentId - Agent identifier.
   */
  async getNonManualEvaluationSummary(agentId: string): Promise<NonManualEvaluationSummaryResponse> {
    return (await this.request("GET", "/agents/evaluation-results/non-manual-summary", {
      query: { agent_id: agentId },
    })) as NonManualEvaluationSummaryResponse;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Knowledge Bases
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List knowledge bases.
   *
   * @param opts - Pagination and sorting options.
   * @returns Paginated list of knowledge bases.
   */
  async listKnowledgeBases(opts: SortableListOptions = {}): Promise<KnowledgeBaseListResponse> {
    return (await this.request("GET", "/knowledge_bases", {
      query: { page: opts.page, limit: opts.limit, sort: opts.sort, order: opts.order },
    })) as KnowledgeBaseListResponse;
  }

  /**
   * Create a new knowledge base.
   *
   * @param body - Knowledge base configuration.
   * @returns The created knowledge base.
   */
  async createKnowledgeBase(body: CreateKnowledgeBaseBody): Promise<KnowledgeBaseResponse> {
    return (await this.request("POST", "/knowledge_bases", { json: body })) as KnowledgeBaseResponse;
  }

  /**
   * Get a knowledge base by ID.
   *
   * @param knowledgeBaseId - Knowledge base identifier.
   * @returns Knowledge base details.
   */
  async getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBaseResponse> {
    return (await this.request("GET", `/knowledge_bases/${knowledgeBaseId}`)) as KnowledgeBaseResponse;
  }

  /**
   * Update a knowledge base.
   *
   * @param knowledgeBaseId - Knowledge base identifier.
   * @param body - Fields to update.
   * @returns Updated knowledge base.
   */
  async updateKnowledgeBase(knowledgeBaseId: string, body: UpdateKnowledgeBaseBody): Promise<KnowledgeBaseResponse> {
    return (await this.request("PUT", `/knowledge_bases/${knowledgeBaseId}`, { json: body })) as KnowledgeBaseResponse;
  }

  /**
   * Delete a knowledge base.
   *
   * @param knowledgeBaseId - Knowledge base identifier.
   */
  async deleteKnowledgeBase(knowledgeBaseId: string): Promise<void> {
    await this.request("DELETE", `/knowledge_bases/${knowledgeBaseId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Memory Banks
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List memory banks.
   *
   * @param opts - Pagination and sorting options.
   * @returns Paginated list of memory banks.
   */
  async listMemoryBanks(opts: SortableListOptions = {}): Promise<MemoryBankListResponse> {
    return (await this.request("GET", "/memory_banks", {
      query: { page: opts.page, limit: opts.limit, sort: opts.sort, order: opts.order },
    })) as MemoryBankListResponse;
  }

  /**
   * Create a new memory bank.
   *
   * Memory banks give agents persistent memory across conversations.
   * Types: `conversation` (chat-style history) or `general` (flat factual entries).
   *
   * @param body - Memory bank configuration.
   * @returns The created memory bank.
   */
  async createMemoryBank(body: CreateMemoryBankBody): Promise<MemoryBankResponse> {
    return (await this.request("POST", "/memory_banks", { json: body })) as MemoryBankResponse;
  }

  /**
   * Get a memory bank by ID.
   *
   * @param memoryBankId - Memory bank identifier.
   * @returns Memory bank details.
   */
  async getMemoryBank(memoryBankId: string): Promise<MemoryBankResponse> {
    return (await this.request("GET", `/memory_banks/${memoryBankId}`)) as MemoryBankResponse;
  }

  /**
   * Update a memory bank.
   *
   * @param memoryBankId - Memory bank identifier.
   * @param body - Fields to update.
   * @returns Updated memory bank.
   */
  async updateMemoryBank(memoryBankId: string, body: UpdateMemoryBankBody): Promise<MemoryBankResponse> {
    return (await this.request("PUT", `/memory_banks/${memoryBankId}`, { json: body })) as MemoryBankResponse;
  }

  /**
   * Delete a memory bank.
   *
   * @param memoryBankId - Memory bank identifier.
   */
  async deleteMemoryBank(memoryBankId: string): Promise<void> {
    await this.request("DELETE", `/memory_banks/${memoryBankId}`);
  }

  /**
   * Get agents that are using a specific memory bank.
   *
   * @param memoryBankId - Memory bank identifier.
   */
  async getAgentsUsingMemoryBank(memoryBankId: string): Promise<unknown> {
    return await this.request("GET", `/memory_banks/${memoryBankId}/agents`);
  }

  /**
   * Get stats for a memory bank.
   *
   * @param memoryBankId - Memory bank identifier.
   */
  async getMemoryBankStats(memoryBankId: string): Promise<unknown> {
    return await this.request("GET", `/memory_banks/${memoryBankId}/stats`);
  }

  /**
   * Compact a memory bank (trigger compaction).
   *
   * @param memoryBankId - Memory bank identifier.
   */
  async compactMemoryBank(memoryBankId: string): Promise<void> {
    await this.request("POST", `/memory_banks/${memoryBankId}/compact`);
  }

  /**
   * Delete a memory bank source.
   *
   * @param memoryBankId - Memory bank identifier.
   */
  async deleteMemoryBankSource(memoryBankId: string): Promise<void> {
    await this.request("DELETE", `/memory_banks/${memoryBankId}/source`);
  }

  /**
   * Test compaction for a specific memory bank.
   *
   * @param memoryBankId - Memory bank identifier.
   * @param body - Test compaction request.
   */
  async testMemoryBankCompaction(memoryBankId: string, body: TestCompactionRequest): Promise<CompactionTestResponse> {
    return (await this.request("POST", `/memory_banks/${memoryBankId}/test-compaction`, { json: body })) as CompactionTestResponse;
  }

  /**
   * Test compaction prompt standalone (not tied to a specific memory bank).
   *
   * @param body - Standalone compaction test request.
   */
  async testCompactionPromptStandalone(body: StandaloneTestCompactionRequest): Promise<CompactionTestResponse> {
    return (await this.request("POST", "/memory_banks/test-compaction", { json: body })) as CompactionTestResponse;
  }

  /**
   * List available memory bank templates.
   */
  async listMemoryBankTemplates(): Promise<unknown> {
    return await this.request("GET", "/memory_banks/templates");
  }

  // ─── Memory Bank AI Assistant ──────────────────────────────────────────────

  /**
   * Generate memory bank configuration using AI.
   *
   * @param body - AI assistant request with user instructions.
   * @returns AI-generated memory bank config.
   */
  async generateMemoryBankConfig(body: MemoryBankAiAssistantRequest): Promise<MemoryBankAiAssistantResponse> {
    return (await this.request("POST", "/memory_banks/ai-assistant", { json: body })) as MemoryBankAiAssistantResponse;
  }

  /**
   * Get the last AI conversation for memory banks.
   */
  async getMemoryBankAiLastConversation(): Promise<MemoryBankLastConversationResponse> {
    return (await this.request("GET", "/memory_banks/ai-assistant/last-conversation")) as MemoryBankLastConversationResponse;
  }

  /**
   * Accept a memory bank AI suggestion.
   *
   * @param conversationId - Conversation identifier.
   * @param body - Accept request payload.
   */
  async acceptMemoryBankAiSuggestion(conversationId: string, body: MemoryBankAcceptRequest): Promise<unknown> {
    return await this.request("PATCH", `/memory_banks/ai-assistant/${conversationId}`, { json: body });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Sources
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List sources.
   *
   * @param opts - Pagination, sorting, and filter options.
   * @returns Paginated list of sources.
   */
  async listSources(
    opts: SortableListOptions & { accountId?: string } = {},
  ): Promise<SourceListResponse> {
    return (await this.request("GET", "/sources/", {
      query: {
        page: opts.page,
        limit: opts.limit,
        sort: opts.sort,
        order: opts.order,
        account_id: opts.accountId,
      },
    })) as SourceListResponse;
  }

  /**
   * Create a new content source.
   *
   * @param body - Source configuration (type, name, knowledge base link, etc.).
   * @returns The created source.
   */
  async createSource(body: CreateSourceBody): Promise<SourceResponse> {
    return (await this.request("POST", "/sources", { json: body })) as SourceResponse;
  }

  /**
   * Get a source by ID.
   *
   * @param sourceId - Source connection identifier.
   * @returns Source details.
   */
  async getSource(sourceId: string): Promise<SourceResponse> {
    return (await this.request("GET", `/sources/${sourceId}`)) as SourceResponse;
  }

  /**
   * Update a source.
   *
   * @param sourceId - Source connection identifier.
   * @param body - Fields to update.
   * @returns Updated source.
   */
  async updateSource(sourceId: string, body: UpdateSourceBody): Promise<SourceResponse> {
    return (await this.request("PUT", `/sources/${sourceId}`, { json: body })) as SourceResponse;
  }

  /**
   * Delete a source.
   *
   * @param sourceId - Source connection identifier.
   */
  async deleteSource(sourceId: string): Promise<void> {
    await this.request("DELETE", `/sources/${sourceId}`);
  }

  /**
   * Upload a file to a source.
   *
   * Maximum file size: 200 MiB. Supports text, PDF, DOCX, audio, video, images, and more.
   * If `mimeType` is omitted, it will be inferred from the `fileName` extension when possible.
   *
   * @param sourceId - Source connection identifier.
   * @param opts - File payload and optional metadata.
   * @returns Upload response details.
   */
  async uploadFileToSource(
    sourceId: string,
    opts: {
      file: Blob | Uint8Array | ArrayBuffer | BufferSource;
      title?: string;
      metadata?: Record<string, unknown>;
      fileName?: string;
      mimeType?: string;
    },
  ): Promise<FileUploadResponse> {
    return (await this.uploadFile(`/sources/${sourceId}/upload`, opts)) as FileUploadResponse;
  }

  /**
   * Upload inline text to a source.
   *
   * @param sourceId - Source connection identifier.
   * @param body - Inline text upload payload.
   * @returns Upload response.
   */
  async uploadInlineTextToSource(sourceId: string, body: InlineTextUploadRequest): Promise<FileUploadResponse> {
    return (await this.request("POST", `/sources/${sourceId}`, { json: body })) as FileUploadResponse;
  }

  // ─── Source Exports ────────────────────────────────────────────────────────

  /**
   * List exports for a source.
   *
   * @param sourceId - Source connection identifier.
   * @param opts - Pagination options.
   * @returns Paginated list of exports.
   */
  async listSourceExports(sourceId: string, opts: ListOptions = {}): Promise<ExportListResponse> {
    return (await this.request("GET", `/sources/${sourceId}/exports`, {
      query: { page: opts.page, limit: opts.limit },
    })) as ExportListResponse;
  }

  /**
   * Create a source data export.
   *
   * @param sourceId - Source connection identifier.
   * @param body - Export configuration (format, etc.).
   * @returns Export response with job status.
   */
  async createSourceExport(sourceId: string, body: CreateExportRequest): Promise<ExportResponse> {
    return (await this.request("POST", `/sources/${sourceId}/exports`, { json: body })) as ExportResponse;
  }

  /**
   * Get a specific source export.
   *
   * @param sourceId - Source connection identifier.
   * @param exportId - Export identifier.
   * @returns Export details.
   */
  async getSourceExport(sourceId: string, exportId: string): Promise<ExportResponse> {
    return (await this.request("GET", `/sources/${sourceId}/exports/${exportId}`)) as ExportResponse;
  }

  /**
   * Cancel a source export.
   *
   * @param sourceId - Source connection identifier.
   * @param exportId - Export identifier.
   */
  async cancelSourceExport(sourceId: string, exportId: string): Promise<ExportResponse> {
    return (await this.request("POST", `/sources/${sourceId}/exports/${exportId}/cancel`)) as ExportResponse;
  }

  /**
   * Download a source export file.
   *
   * Returns the raw `Response` so you can stream or save the binary data.
   *
   * @param sourceId - Source connection identifier.
   * @param exportId - Export identifier.
   * @returns Raw response with the export file.
   */
  async downloadSourceExport(sourceId: string, exportId: string): Promise<Response> {
    return await this.requestRaw("GET", `/sources/${sourceId}/exports/${exportId}/download`);
  }

  /**
   * Estimate a source export.
   *
   * @param sourceId - Source connection identifier.
   * @param body - Estimate request.
   * @returns Export estimate.
   */
  async estimateSourceExport(sourceId: string, body: EstimateExportRequest): Promise<EstimateExportResponse> {
    return (await this.request("POST", `/sources/${sourceId}/exports/estimate`, { json: body })) as EstimateExportResponse;
  }

  /**
   * Delete a source export.
   *
   * @param sourceId - Source connection identifier.
   * @param exportId - Export identifier.
   */
  async deleteSourceExport(sourceId: string, exportId: string): Promise<void> {
    await this.request("DELETE", `/sources/${sourceId}/exports/${exportId}`);
  }

  // ─── Source Embedding Migrations ───────────────────────────────────────────

  /**
   * Get the status of a source embedding migration.
   *
   * @param sourceId - Source connection identifier.
   * @returns Migration status.
   */
  async getSourceEmbeddingMigration(sourceId: string): Promise<SourceEmbeddingMigrationResponse> {
    return (await this.request("GET", `/sources/${sourceId}/embedding-migration`)) as SourceEmbeddingMigrationResponse;
  }

  /**
   * Start a source embedding migration.
   *
   * @param sourceId - Source connection identifier.
   * @param body - Migration configuration (target embedding model, etc.).
   * @returns Migration status.
   */
  async startSourceEmbeddingMigration(sourceId: string, body: StartSourceEmbeddingMigrationRequest): Promise<SourceEmbeddingMigrationResponse> {
    return (await this.request("POST", `/sources/${sourceId}/embedding-migration`, { json: body })) as SourceEmbeddingMigrationResponse;
  }

  /**
   * Cancel a source embedding migration.
   *
   * @param sourceId - Source connection identifier.
   * @returns Updated migration status.
   */
  async cancelSourceEmbeddingMigration(sourceId: string): Promise<SourceEmbeddingMigrationResponse> {
    return (await this.request("POST", `/sources/${sourceId}/embedding-migration/cancel`)) as SourceEmbeddingMigrationResponse;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Content
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get content detail for a specific content version.
   *
   * @param contentVersionId - Content version identifier.
   * @param opts - Range options for slicing large content.
   * @returns Content details for the requested range.
   */
  async getContentDetail(
    contentVersionId: string,
    opts: { start?: number; end?: number } = {},
  ): Promise<ContentDetailResponse> {
    return (await this.request("GET", `/contents/${contentVersionId}`, {
      query: { start: opts.start ?? 0, end: opts.end ?? 5000 },
    })) as ContentDetailResponse;
  }

  /**
   * Replace content with inline text.
   *
   * @param contentVersionId - Content version identifier.
   * @param body - Inline text replacement payload.
   */
  async replaceContentWithInlineText(contentVersionId: string, body: InlineTextReplaceRequest): Promise<ContentFileUploadResponse> {
    return (await this.request("PUT", `/contents/${contentVersionId}`, { json: body })) as ContentFileUploadResponse;
  }

  /**
   * Delete a specific content version.
   *
   * @param contentVersionId - Content version identifier.
   */
  async deleteContent(contentVersionId: string): Promise<void> {
    await this.request("DELETE", `/contents/${contentVersionId}`);
  }

  /**
   * List embeddings for a content version.
   *
   * @param contentVersionId - Content version identifier.
   * @param opts - Pagination options.
   * @returns Paginated list of embeddings.
   */
  async listContentEmbeddings(
    contentVersionId: string,
    opts: ListOptions = {},
  ): Promise<ContentEmbeddingsListResponse> {
    return (await this.request("GET", `/contents/${contentVersionId}/embeddings`, {
      query: { page: opts.page ?? 1, limit: opts.limit ?? 20 },
    })) as ContentEmbeddingsListResponse;
  }

  /**
   * Upload a file to replace content for an existing content version.
   *
   * @param contentVersionId - Content version identifier.
   * @param opts - File payload and optional metadata.
   * @returns Upload response.
   */
  async uploadFileToContent(
    contentVersionId: string,
    opts: {
      file: Blob | Uint8Array | ArrayBuffer | BufferSource;
      title?: string;
      metadata?: Record<string, unknown>;
      fileName?: string;
      mimeType?: string;
    },
  ): Promise<ContentFileUploadResponse> {
    return (await this.uploadFile(`/contents/${contentVersionId}/upload`, opts)) as ContentFileUploadResponse;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Solutions
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List solutions.
   *
   * @param opts - Pagination and sorting options.
   * @returns Paginated list of solutions.
   */
  async listSolutions(opts: SortableListOptions = {}): Promise<SolutionListResponse> {
    return (await this.request("GET", "/solutions", {
      query: { page: opts.page, limit: opts.limit, sort: opts.sort, order: opts.order },
    })) as SolutionListResponse;
  }

  /**
   * Create a new solution.
   *
   * @param body - Solution configuration.
   * @returns The created solution.
   */
  async createSolution(body: CreateSolutionRequest): Promise<SolutionResponse> {
    return (await this.request("POST", "/solutions", { json: body })) as SolutionResponse;
  }

  /**
   * Get a solution by ID.
   *
   * @param solutionId - Solution identifier.
   * @returns Solution details.
   */
  async getSolution(solutionId: string): Promise<SolutionResponse> {
    return (await this.request("GET", `/solutions/${solutionId}`)) as SolutionResponse;
  }

  /**
   * Update a solution.
   *
   * @param solutionId - Solution identifier.
   * @param body - Fields to update.
   * @returns Updated solution.
   */
  async updateSolution(solutionId: string, body: UpdateSolutionRequest): Promise<SolutionResponse> {
    return (await this.request("PATCH", `/solutions/${solutionId}`, { json: body })) as SolutionResponse;
  }

  /**
   * Delete a solution.
   *
   * @param solutionId - Solution identifier.
   */
  async deleteSolution(solutionId: string): Promise<void> {
    await this.request("DELETE", `/solutions/${solutionId}`);
  }

  // ─── Solution Resource Linking ─────────────────────────────────────────────

  /**
   * Link agents to a solution.
   *
   * @param solutionId - Solution identifier.
   * @param body - Resource IDs to link.
   * @returns Updated solution.
   */
  async linkAgentsToSolution(solutionId: string, body: LinkResourcesRequest): Promise<SolutionResponse> {
    return (await this.request("POST", `/solutions/${solutionId}/agents`, { json: body })) as SolutionResponse;
  }

  /**
   * Unlink agents from a solution.
   *
   * @param solutionId - Solution identifier.
   * @param body - Resource IDs to unlink.
   * @returns Updated solution.
   */
  async unlinkAgentsFromSolution(solutionId: string, body: UnlinkResourcesRequest): Promise<SolutionResponse> {
    return (await this.request("DELETE", `/solutions/${solutionId}/agents`, { json: body })) as SolutionResponse;
  }

  /**
   * Link knowledge bases to a solution.
   *
   * @param solutionId - Solution identifier.
   * @param body - Resource IDs to link.
   * @returns Updated solution.
   */
  async linkKnowledgeBasesToSolution(solutionId: string, body: LinkResourcesRequest): Promise<SolutionResponse> {
    return (await this.request("POST", `/solutions/${solutionId}/knowledge-bases`, { json: body })) as SolutionResponse;
  }

  /**
   * Unlink knowledge bases from a solution.
   *
   * @param solutionId - Solution identifier.
   * @param body - Resource IDs to unlink.
   * @returns Updated solution.
   */
  async unlinkKnowledgeBasesFromSolution(solutionId: string, body: UnlinkResourcesRequest): Promise<SolutionResponse> {
    return (await this.request("DELETE", `/solutions/${solutionId}/knowledge-bases`, { json: body })) as SolutionResponse;
  }

  /**
   * Link source connections to a solution.
   *
   * @param solutionId - Solution identifier.
   * @param body - Resource IDs to link.
   * @returns Updated solution.
   */
  async linkSourceConnectionsToSolution(solutionId: string, body: LinkResourcesRequest): Promise<SolutionResponse> {
    return (await this.request("POST", `/solutions/${solutionId}/source-connections`, { json: body })) as SolutionResponse;
  }

  /**
   * Unlink source connections from a solution.
   *
   * @param solutionId - Solution identifier.
   * @param body - Resource IDs to unlink.
   * @returns Updated solution.
   */
  async unlinkSourceConnectionsFromSolution(solutionId: string, body: UnlinkResourcesRequest): Promise<SolutionResponse> {
    return (await this.request("DELETE", `/solutions/${solutionId}/source-connections`, { json: body })) as SolutionResponse;
  }

  // ─── Solution Conversations ────────────────────────────────────────────────

  /**
   * List conversations for a solution.
   *
   * @param solutionId - Solution identifier.
   * @returns List of conversations.
   */
  async listSolutionConversations(solutionId: string): Promise<SolutionConversationResponse[]> {
    return (await this.request("GET", `/solutions/${solutionId}/conversations`)) as SolutionConversationResponse[];
  }

  /**
   * Add a conversation turn to a solution.
   *
   * @param solutionId - Solution identifier.
   * @param body - Conversation turn payload.
   * @returns Updated conversation.
   */
  async addSolutionConversationTurn(solutionId: string, body: AddConversationTurnRequest): Promise<SolutionConversationResponse> {
    return (await this.request("POST", `/solutions/${solutionId}/conversations`, { json: body })) as SolutionConversationResponse;
  }

  /**
   * Mark a conversation turn (e.g. accepted/rejected).
   *
   * @param solutionId - Solution identifier.
   * @param conversationId - Conversation identifier.
   * @param body - Mark payload.
   */
  async markSolutionConversationTurn(solutionId: string, conversationId: string, body: MarkConversationTurnRequest): Promise<void> {
    await this.request("PATCH", `/solutions/${solutionId}/conversations/${conversationId}`, { json: body });
  }

  // ─── Solution AI Assistant ─────────────────────────────────────────────────

  /**
   * Generate a solution AI plan.
   *
   * @param solutionId - Solution identifier.
   * @param body - Generation request.
   * @returns AI-generated plan.
   */
  async generateSolutionAiPlan(solutionId: string, body: AiAssistantGenerateRequest): Promise<AiAssistantGenerateResponse> {
    return (await this.request("POST", `/solutions/${solutionId}/ai-assistant/generate`, { json: body })) as AiAssistantGenerateResponse;
  }

  /**
   * Generate a knowledge base configuration via solution AI.
   *
   * @param solutionId - Solution identifier.
   * @param body - Generation request.
   * @returns AI-generated knowledge base config.
   */
  async generateSolutionAiKnowledgeBase(solutionId: string, body: AiAssistantGenerateRequest): Promise<AiAssistantGenerateResponse> {
    return (await this.request("POST", `/solutions/${solutionId}/ai-assistant/knowledge-base`, { json: body })) as AiAssistantGenerateResponse;
  }

  /**
   * Generate a source configuration via solution AI.
   *
   * @param solutionId - Solution identifier.
   * @param body - Generation request.
   * @returns AI-generated source config.
   */
  async generateSolutionAiSource(solutionId: string, body: AiAssistantGenerateRequest): Promise<AiAssistantGenerateResponse> {
    return (await this.request("POST", `/solutions/${solutionId}/ai-assistant/source`, { json: body })) as AiAssistantGenerateResponse;
  }

  /**
   * Accept a solution AI plan.
   *
   * @param solutionId - Solution identifier.
   * @param conversationId - Conversation identifier.
   * @param body - Accept request.
   * @returns Acceptance result with executed actions.
   */
  async acceptSolutionAiPlan(solutionId: string, conversationId: string, body: AiAssistantAcceptRequest): Promise<AiAssistantAcceptResponse> {
    return (await this.request("POST", `/solutions/${solutionId}/ai-assistant/${conversationId}/accept`, { json: body })) as AiAssistantAcceptResponse;
  }

  /**
   * Decline a solution AI plan.
   *
   * @param solutionId - Solution identifier.
   * @param conversationId - Conversation identifier.
   */
  async declineSolutionAiPlan(solutionId: string, conversationId: string): Promise<void> {
    await this.request("POST", `/solutions/${solutionId}/ai-assistant/${conversationId}/decline`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Governance — AI Assistant
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate governance policy suggestions using AI.
   *
   * @param body - AI governance request.
   * @returns AI-generated governance suggestions.
   */
  async generateGovernanceAiPlan(body: GovernanceAiAssistantRequest): Promise<GovernanceAiAssistantResponse> {
    return (await this.request("POST", "/governance/ai-assistant", { json: body })) as GovernanceAiAssistantResponse;
  }

  /**
   * List governance AI conversations.
   */
  async listGovernanceAiConversations(): Promise<GovernanceConversationResponse[]> {
    return (await this.request("GET", "/governance/ai-assistant/conversations")) as GovernanceConversationResponse[];
  }

  /**
   * Accept a governance AI plan.
   *
   * @param conversationId - Conversation identifier.
   * @returns Acceptance result.
   */
  async acceptGovernanceAiPlan(conversationId: string): Promise<GovernanceAiAcceptResponse> {
    return (await this.request("POST", `/governance/ai-assistant/${conversationId}/accept`)) as GovernanceAiAcceptResponse;
  }

  /**
   * Decline a governance AI plan.
   *
   * @param conversationId - Conversation identifier.
   */
  async declineGovernanceAiPlan(conversationId: string): Promise<void> {
    await this.request("POST", `/governance/ai-assistant/${conversationId}/decline`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Alerts
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List alerts.
   *
   * @param opts - Pagination and filter options.
   * @returns Paginated list of alerts.
   */
  async listAlerts(opts: ListOptions & { status?: string; severity?: string } = {}): Promise<unknown> {
    return await this.request("GET", "/alerts", {
      query: { page: opts.page, limit: opts.limit, status: opts.status, severity: opts.severity },
    });
  }

  /**
   * Get alert details by ID.
   *
   * @param alertId - Alert identifier.
   * @returns Alert details.
   */
  async getAlert(alertId: string): Promise<unknown> {
    return await this.request("GET", `/alerts/${alertId}`);
  }

  /**
   * Change the status of an alert.
   *
   * @param alertId - Alert identifier.
   * @param body - Status change request.
   */
  async changeAlertStatus(alertId: string, body: ChangeStatusRequest): Promise<unknown> {
    return await this.request("POST", `/alerts/${alertId}/status`, { json: body });
  }

  /**
   * Add a comment to an alert.
   *
   * @param alertId - Alert identifier.
   * @param body - Comment payload.
   */
  async addAlertComment(alertId: string, body: AddCommentRequest): Promise<unknown> {
    return await this.request("POST", `/alerts/${alertId}/comments`, { json: body });
  }

  /**
   * Subscribe to an alert.
   *
   * @param alertId - Alert identifier.
   */
  async subscribeToAlert(alertId: string): Promise<unknown> {
    return await this.request("POST", `/alerts/${alertId}/subscribe`);
  }

  /**
   * Unsubscribe from an alert.
   *
   * @param alertId - Alert identifier.
   */
  async unsubscribeFromAlert(alertId: string): Promise<unknown> {
    return await this.request("POST", `/alerts/${alertId}/unsubscribe`);
  }

  // ─── Alert Configs ─────────────────────────────────────────────────────────

  /**
   * List alert configurations.
   *
   * @param opts - Pagination options.
   * @returns Paginated list of alert configs.
   */
  async listAlertConfigs(opts: ListOptions = {}): Promise<unknown> {
    return await this.request("GET", "/alerts/configs", {
      query: { page: opts.page, limit: opts.limit },
    });
  }

  /**
   * Create an alert configuration.
   *
   * @param body - Alert config definition.
   * @returns Created alert config.
   */
  async createAlertConfig(body: CreateAlertConfigRequest): Promise<unknown> {
    return await this.request("POST", "/alerts/configs", { json: body });
  }

  /**
   * Get an alert configuration by ID.
   *
   * @param configId - Alert config identifier.
   * @returns Alert config details.
   */
  async getAlertConfig(configId: string): Promise<unknown> {
    return await this.request("GET", `/alerts/configs/${configId}`);
  }

  /**
   * Update an alert configuration.
   *
   * @param configId - Alert config identifier.
   * @param body - Fields to update.
   * @returns Updated alert config.
   */
  async updateAlertConfig(configId: string, body: UpdateAlertConfigRequest): Promise<unknown> {
    return await this.request("PATCH", `/alerts/configs/${configId}`, { json: body });
  }

  /**
   * Delete an alert configuration.
   *
   * @param configId - Alert config identifier.
   */
  async deleteAlertConfig(configId: string): Promise<void> {
    await this.request("DELETE", `/alerts/configs/${configId}`);
  }

  // ─── Organization Alert Preferences ────────────────────────────────────────

  /**
   * List organization alert preferences.
   */
  async listOrganizationAlertPreferences(): Promise<OrganizationAlertPreferenceListResponse> {
    return (await this.request("GET", "/alerts/organization-preferences/list")) as OrganizationAlertPreferenceListResponse;
  }

  /**
   * Update an organization alert preference.
   *
   * @param organizationId - Organization identifier.
   * @param alertType - Alert type.
   * @param body - Preference update.
   */
  async updateOrganizationAlertPreference(
    organizationId: string,
    alertType: string,
    body: UpdateOrganizationAlertPreferenceRequest,
  ): Promise<unknown> {
    return await this.request("PATCH", `/alerts/organization-preferences/${organizationId}/${alertType}`, { json: body });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Models & Model Alerts
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List model alerts.
   *
   * @param opts - Pagination options.
   */
  async listModelAlerts(opts: ListOptions = {}): Promise<unknown> {
    return await this.request("GET", "/models/alerts", {
      query: { page: opts.page, limit: opts.limit },
    });
  }

  /**
   * Mark all model alerts as read.
   */
  async markAllModelAlertsRead(): Promise<void> {
    await this.request("POST", "/models/alerts/mark-all-read");
  }

  /**
   * Get unread model alert count.
   */
  async getUnreadModelAlertCount(): Promise<unknown> {
    return await this.request("GET", "/models/alerts/unread-count");
  }

  /**
   * Mark a specific model alert as read.
   *
   * @param alertId - Model alert identifier.
   */
  async markModelAlertRead(alertId: string): Promise<void> {
    await this.request("PATCH", `/models/alerts/${alertId}/read`);
  }

  /**
   * Get model recommendations.
   *
   * @param modelId - Model identifier.
   */
  async getModelRecommendations(modelId: string): Promise<unknown> {
    return await this.request("GET", `/models/${modelId}/recommendations`);
  }

  /**
   * List all enabled LLM models grouped by provider.
   *
   * @param opts - Optional filters.
   */
  async listModels(opts: { provider?: string; supportsToolUse?: boolean; supportsThinking?: boolean } = {}): Promise<ProviderGroupResponse[]> {
    return (await this.request("GET", "/models", {
      query: { provider: opts.provider, supports_tool_use: opts.supportsToolUse, supports_thinking: opts.supportsThinking },
    })) as ProviderGroupResponse[];
  }

  /**
   * Get full details for a specific model.
   *
   * @param modelId - Model identifier.
   */
  async getModel(modelId: string): Promise<PromptModelResponse> {
    return (await this.request("GET", `/models/${modelId}/details`)) as PromptModelResponse;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Model Playground Experiments
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List model playground experiments.
   *
   * @param opts - Optional filters and pagination.
   */
  async listExperiments(opts: { days?: number; startDate?: string; endDate?: string; limit?: number; offset?: number } = {}): Promise<unknown> {
    return await this.request("GET", "/models/playground/experiments", {
      query: { days: opts.days, start_date: opts.startDate, end_date: opts.endDate, limit: opts.limit, offset: opts.offset },
    });
  }

  /**
   * Create a model playground experiment.
   *
   * @param body - Experiment configuration.
   */
  async createExperiment(body: CreateExperimentInput): Promise<unknown> {
    return await this.request("POST", "/models/playground/experiments", { json: body });
  }

  /**
   * Get a model playground experiment by ID.
   *
   * @param experimentId - Experiment identifier.
   */
  async getExperiment(experimentId: string): Promise<unknown> {
    return await this.request("GET", `/models/playground/experiments/${experimentId}`);
  }

  /**
   * Cancel a running model playground experiment.
   *
   * @param experimentId - Experiment identifier.
   */
  async cancelExperiment(experimentId: string): Promise<unknown> {
    return await this.request("POST", `/models/playground/experiments/${experimentId}/cancel`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Search
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search across all resource types in your account.
   *
   * Accepts a free-text keyword query or a UUID. Results are ranked:
   * name-prefix > name-substring > description-substring.
   *
   * @param opts - Search options.
   * @param opts.query - Search query string (required, 1-200 chars).
   * @param opts.limit - Maximum results (1-50, default 10).
   * @param opts.entityType - Optional entity type filter (e.g. "agent", "knowledge_base").
   * @returns Search results.
   */
  async search(opts: { query: string; limit?: number; entityType?: string }): Promise<unknown> {
    return await this.request("GET", "/search", {
      query: { q: opts.query, limit: opts.limit, entity_type: opts.entityType },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Top-Level AI Assistant
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Submit feedback on an AI assistant interaction.
   *
   * @param body - Feedback payload (thumbs up/down, optional comment).
   * @returns Feedback response.
   */
  async submitAiFeedback(body: AiAssistantFeedbackRequest): Promise<AiAssistantFeedbackResponse> {
    return (await this.request("POST", "/ai-assistant/feedback", { json: body })) as AiAssistantFeedbackResponse;
  }

  /**
   * Generate a knowledge base configuration via AI assistant.
   *
   * @param body - Generation request.
   */
  async aiAssistantKnowledgeBase(body: AiAssistantGenerateRequest): Promise<AiAssistantGenerateResponse> {
    return (await this.request("POST", "/ai-assistant/knowledge-base", { json: body })) as AiAssistantGenerateResponse;
  }

  /**
   * Generate a source configuration via AI assistant.
   *
   * @param body - Generation request.
   */
  async aiAssistantSource(body: AiAssistantGenerateRequest): Promise<AiAssistantGenerateResponse> {
    return (await this.request("POST", "/ai-assistant/source", { json: body })) as AiAssistantGenerateResponse;
  }

  /**
   * Generate a solution via AI assistant.
   *
   * @param body - Generation request.
   */
  async aiAssistantSolution(body: AiAssistantGenerateRequest): Promise<AiAssistantGenerateResponse> {
    return (await this.request("POST", "/ai-assistant/solution", { json: body })) as AiAssistantGenerateResponse;
  }

  /**
   * Generate a memory bank configuration via AI assistant.
   *
   * @param body - Generation request.
   */
  async aiAssistantMemoryBank(body: AiAssistantGenerateRequest): Promise<MemoryBankAiAssistantResponse> {
    return (await this.request("POST", "/ai-assistant/memory-bank", { json: body })) as MemoryBankAiAssistantResponse;
  }

  /**
   * Get AI assistant memory bank conversation history.
   */
  async getAiAssistantMemoryBankHistory(): Promise<MemoryBankLastConversationResponse> {
    return (await this.request("GET", "/ai-assistant/memory-bank/last-conversation")) as MemoryBankLastConversationResponse;
  }

  /**
   * Accept an AI assistant suggestion.
   *
   * @param conversationId - Conversation identifier.
   * @param body - Acceptance request payload.
   */
  async acceptAiAssistantPlan(conversationId: string, body: AiAssistantAcceptRequest): Promise<AiAssistantAcceptResponse> {
    return (await this.request("POST", `/ai-assistant/${conversationId}/accept`, { json: body })) as AiAssistantAcceptResponse;
  }

  /**
   * Decline an AI assistant suggestion.
   *
   * @param conversationId - Conversation identifier.
   */
  async declineAiAssistantPlan(conversationId: string): Promise<void> {
    await this.request("POST", `/ai-assistant/${conversationId}/decline`);
  }

  /**
   * Accept/mark an AI memory bank suggestion.
   *
   * @param conversationId - Conversation identifier.
   * @param body - Acceptance payload for the memory bank suggestion.
   */
  async acceptAiMemoryBankSuggestion(conversationId: string, body: MemoryBankAcceptRequest): Promise<unknown> {
    return await this.request("PATCH", `/ai-assistant/memory-bank/${conversationId}`, { json: body });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pagination Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Auto-paginate through a list endpoint.
   *
   * Yields individual items from each page, automatically fetching the next page
   * until all items have been returned.
   *
   * @param fetchPage - A function that fetches a single page given `{ page, limit }`.
   * @param opts - Page size (default: 50).
   *
   * @example
   * ```ts
   * for await (const agent of client.paginate(
   *   (opts) => client.listAgents(opts),
   * )) {
   *   console.log(agent);
   * }
   * ```
   */
  async *paginate<T>(
    fetchPage: (opts: { page: number; limit: number }) => Promise<{ items: T[]; pagination?: { page: number; total_pages: number } }>,
    opts?: { limit?: number },
  ): AsyncGenerator<T, void, undefined> {
    const limit = opts?.limit ?? 50;
    let page = 1;

    while (true) {
      const result = await fetchPage({ page, limit });
      for (const item of result.items) {
        yield item;
      }

      if (
        !result.pagination ||
        result.items.length < limit ||
        page >= result.pagination.total_pages
      ) {
        break;
      }
      page++;
    }
  }
}
