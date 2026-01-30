import type { components } from "./openapi";

/** JSON-serializable values accepted/returned by the SDK's low-level `request()` method. */
export type JSONValue =
  | { [key: string]: JSONValue }
  | JSONValue[]
  | string
  | number
  | boolean
  | null;

/** Request body for starting an agent run. */
export type AgentRunRequest = components["schemas"]["AgentRunRequest"];
/** Request body for starting an agent run in streaming mode (SSE). */
export type AgentRunStreamRequest = components["schemas"]["AgentRunStreamRequest"];
/** Response body describing an agent run. */
export type AgentRunResponse = components["schemas"]["AgentRunResponse"];
/** Paginated list response for agent runs. */
export type AgentRunListResponse = components["schemas"]["routers__api__agents__AgentRunListResponse"];

/** Content detail response for a specific content version. */
export type ContentDetailResponse = components["schemas"]["routers__api__contents__ContentDetailResponse"];
/** Paginated list response for embeddings. */
export type ContentEmbeddingsListResponse =
  components["schemas"]["routers__api__contents__ContentEmbeddingsListResponse"];

/** Paginated list response for sources. */
export type SourceListResponse = components["schemas"]["routers__api__sources__SourceListResponse"];
/** Upload response for uploads (source upload and content replacement upload). */
export type FileUploadResponse = components["schemas"] extends { FileUploadResponse: infer T }
  ? T
  : components["schemas"] extends { routers__api__sources__FileUploadResponse: infer T }
    ? T
    : components["schemas"] extends { routers__api__contents__FileUploadResponse: infer T }
      ? T
      : never;

/** Upload response specifically for source uploads (/sources/{id}/upload). */
export type SourceFileUploadResponse = components["schemas"] extends { routers__api__sources__FileUploadResponse: infer T }
  ? T
  : FileUploadResponse;

/** Upload response specifically for content replacement uploads (/contents/{id}/upload). */
export type ContentFileUploadResponse = components["schemas"] extends { routers__api__contents__FileUploadResponse: infer T }
  ? T
  : FileUploadResponse;

/** Standard OpenAPI validation error shape (typically HTTP 422). */
export type HTTPValidationError = components["schemas"]["HTTPValidationError"];
