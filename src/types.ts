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
/** Upload response for source uploads. */
export type FileUploadResponse = components["schemas"]["FileUploadResponse"];

/** Standard OpenAPI validation error shape (typically HTTP 422). */
export type HTTPValidationError = components["schemas"]["HTTPValidationError"];
