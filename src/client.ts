import {
  SeclaiAPIStatusError,
  SeclaiAPIValidationError,
  SeclaiConfigurationError,
} from "./errors";
import type {
  AgentRunListResponse,
  AgentRunRequest,
  AgentRunResponse,
  ContentDetailResponse,
  ContentEmbeddingsListResponse,
  FileUploadResponse,
  HTTPValidationError,
  SourceListResponse,
} from "./types";

/** Default API base URL (can be overridden with `baseUrl` or `SECLAI_API_URL`). */
export const SECLAI_API_URL = "https://seclai.com";

/** A `fetch`-compatible function (e.g. `globalThis.fetch` or `undici.fetch`). */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Configuration for the {@link Seclai} client. */
export interface SeclaiOptions {
  /** API key used for authentication. Defaults to `process.env.SECLAI_API_KEY` when available. */
  apiKey?: string;
  /** API base URL. Defaults to `process.env.SECLAI_API_URL` when available, else {@link SECLAI_API_URL}. */
  baseUrl?: string;
  /** Header name to use for the API key. Defaults to `x-api-key`. */
  apiKeyHeader?: string;
  /** Extra headers to include on every request. */
  defaultHeaders?: Record<string, string>;
  /** Optional `fetch` implementation for environments without a global `fetch`. */
  fetch?: FetchLike;
}

function getEnv(name: string): string | undefined {
  const p = (globalThis as any)?.process;
  return p?.env?.[name];
}

function buildURL(baseUrl: string, path: string, query?: Record<string, unknown>): URL {
  const url = new URL(path, baseUrl);
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

/**
 * Seclai JavaScript/TypeScript client.
 *
 * @remarks
 * - Uses API key auth via `x-api-key` by default.
 * - Throws SDK exceptions for non-success responses.
 */
export class Seclai {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiKeyHeader: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetcher: FetchLike;

  /**
   * Create a new Seclai client.
   *
   * @param opts - Client configuration.
   * @throws {@link SeclaiConfigurationError} If no API key is provided (and `SECLAI_API_KEY` is not set).
   * @throws {@link SeclaiConfigurationError} If no `fetch` implementation is available.
   */
  constructor(opts: SeclaiOptions = {}) {
    const apiKey = opts.apiKey ?? getEnv("SECLAI_API_KEY");
    if (!apiKey) {
      throw new SeclaiConfigurationError(
        "Missing API key. Provide apiKey or set SECLAI_API_KEY."
      );
    }

    const fetcher = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetcher) {
      throw new SeclaiConfigurationError(
        "No fetch implementation available. Provide opts.fetch or run in an environment with global fetch."
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = opts.baseUrl ?? getEnv("SECLAI_API_URL") ?? SECLAI_API_URL;
    this.apiKeyHeader = opts.apiKeyHeader ?? "x-api-key";
    this.defaultHeaders = { ...(opts.defaultHeaders ?? {}) };
    this.fetcher = fetcher;
  }

  /**
   * Make a raw HTTP request to the Seclai API.
   *
   * This is a low-level escape hatch. For most operations, prefer the typed convenience methods.
   *
   * @param method - HTTP method (e.g. `"GET"`, `"POST"`).
   * @param path - Request path relative to `baseUrl` (e.g. `"/api/sources/"`).
   * @param opts - Query params, JSON body, and per-request headers.
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
    }
  ): Promise<unknown | string | null> {
    const url = buildURL(this.baseUrl, path, opts?.query);

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(opts?.headers ?? {}),
      [this.apiKeyHeader]: this.apiKey,
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
   * Run an agent.
   *
   * @param agentId - Agent identifier.
   * @param body - Agent run request payload.
   * @returns The created agent run.
   */
  async runAgent(agentId: string, body: AgentRunRequest): Promise<AgentRunResponse> {
    const data = await this.request("POST", `/api/agents/${agentId}/runs`, { json: body });
    return data as AgentRunResponse;
  }

  /**
   * List agent runs for an agent.
   *
   * @param agentId - Agent identifier.
   * @param opts - Pagination options.
   * @returns A paginated list of runs.
   */
  async listAgentRuns(
    agentId: string,
    opts: { page?: number; limit?: number } = {}
  ): Promise<AgentRunListResponse> {
    const data = await this.request("GET", `/api/agents/${agentId}/runs`, {
      query: { page: opts.page ?? 1, limit: opts.limit ?? 50 },
    });
    return data as AgentRunListResponse;
  }

  /**
   * Get details of a specific agent run.
   *
   * @param agentId - Agent identifier.
   * @param runId - Run identifier.
   * @returns Agent run details.
   */
  async getAgentRun(agentId: string, runId: string): Promise<AgentRunResponse> {
    const data = await this.request("GET", `/api/agents/${agentId}/runs/${runId}`);
    return data as AgentRunResponse;
  }

  /**
   * Cancel an agent run.
   *
   * @param agentId - Agent identifier.
   * @param runId - Run identifier.
   * @returns Updated agent run record.
   */
  async deleteAgentRun(agentId: string, runId: string): Promise<AgentRunResponse> {
    const data = await this.request("DELETE", `/api/agents/${agentId}/runs/${runId}`);
    return data as AgentRunResponse;
  }

  /**
   * Get content detail.
   *
   * Fetches a slice of a content version (use `start`/`end` to page through large content).
   *
   * @param sourceConnectionContentVersion - Content version identifier.
   * @param opts - Range options.
   * @returns Content details for the requested range.
   */
  async getContentDetail(
    sourceConnectionContentVersion: string,
    opts: { start?: number; end?: number } = {}
  ): Promise<ContentDetailResponse> {
    const data = await this.request(
      "GET",
      `/api/contents/${sourceConnectionContentVersion}`,
      { query: { start: opts.start ?? 0, end: opts.end ?? 5000 } }
    );
    return data as ContentDetailResponse;
  }

  /**
   * Delete a specific content version.
   *
   * @param sourceConnectionContentVersion - Content version identifier.
   */
  async deleteContent(sourceConnectionContentVersion: string): Promise<void> {
    await this.request("DELETE", `/api/contents/${sourceConnectionContentVersion}`);
  }

  /**
   * List embeddings for a content version.
   *
   * @param sourceConnectionContentVersion - Content version identifier.
   * @param opts - Pagination options.
   * @returns A paginated list of embeddings.
   */
  async listContentEmbeddings(
    sourceConnectionContentVersion: string,
    opts: { page?: number; limit?: number } = {}
  ): Promise<ContentEmbeddingsListResponse> {
    const data = await this.request(
      "GET",
      `/api/contents/${sourceConnectionContentVersion}/embeddings`,
      { query: { page: opts.page ?? 1, limit: opts.limit ?? 20 } }
    );
    return data as ContentEmbeddingsListResponse;
  }

  /**
   * List sources.
   *
   * @param opts - Pagination and filter options.
   * @returns A paginated list of sources.
   */
  async listSources(
    opts: {
      page?: number;
      limit?: number;
      sort?: string;
      order?: "asc" | "desc";
      accountId?: string | null;
    } = {}
  ): Promise<SourceListResponse> {
    const data = await this.request("GET", "/api/sources/", {
      query: {
        page: opts.page ?? 1,
        limit: opts.limit ?? 20,
        sort: opts.sort ?? "created_at",
        order: opts.order ?? "desc",
        account_id: opts.accountId ?? undefined,
      },
    });
    return data as SourceListResponse;
  }

  /**
   * Upload a file to a specific source connection.
   *
   * @param sourceConnectionId - Source connection identifier.
   * @param opts - File payload and optional metadata.
   * @param opts.file - File payload as a `Blob`, `Uint8Array`, or `ArrayBuffer`.
   * @param opts.title - Optional title for the uploaded file.
   * @param opts.fileName - Optional filename to send with the upload.
   * @param opts.mimeType - Optional MIME type to attach to the upload.
   * @returns Upload response details.
   */
  async uploadFileToSource(
    sourceConnectionId: string,
    opts: {
      file: Blob | Uint8Array | ArrayBuffer;
      title?: string;
      fileName?: string;
      mimeType?: string;
    }
  ): Promise<FileUploadResponse> {
    const url = buildURL(this.baseUrl, `/api/sources/${sourceConnectionId}/upload`);

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      [this.apiKeyHeader]: this.apiKey,
    };

    const form = new FormData();

    let blob: Blob;
    if (opts.file instanceof Blob) {
      blob = opts.file;
    } else if (opts.file instanceof ArrayBuffer) {
      const blobOpts = opts.mimeType ? { type: opts.mimeType } : undefined;
      blob = new Blob([new Uint8Array(opts.file)], blobOpts);
    } else {
      const blobOpts = opts.mimeType ? { type: opts.mimeType } : undefined;
      blob = new Blob([opts.file as unknown as BlobPart], blobOpts);
    }

    const fileName = opts.fileName ?? "upload";
    form.set("file", blob, fileName);

    if (opts.title !== undefined) {
      form.set("title", opts.title);
    }

    const response = await this.fetcher(url, {
      method: "POST",
      headers,
      body: form,
    });

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

    return (await response.json()) as FileUploadResponse;
  }
}
