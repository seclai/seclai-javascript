/**
 * @module
 *
 * Developer-friendly type aliases for Seclai API request and response shapes.
 *
 * Every type is an alias over the auto-generated OpenAPI schema in `openapi.ts`,
 * giving a stable, readable name that won't change if the generated identifiers
 * are regenerated.
 */
import type { components } from "./openapi";

// ─── General ─────────────────────────────────────────────────────────────────

/** JSON-serializable values accepted/returned by the SDK's low-level `request()` method. */
export type JSONValue =
  | { [key: string]: JSONValue }
  | JSONValue[]
  | string
  | number
  | boolean
  | null;

/** Standard OpenAPI validation error shape (typically HTTP 422). */
export type HTTPValidationError = components["schemas"]["HTTPValidationError"];

/** Individual validation error entry within an {@link HTTPValidationError}. */
export type ValidationError = components["schemas"]["ValidationError"];

/** Pagination metadata included in list responses. */
export type PaginationResponse = components["schemas"]["PaginationResponse"];

// ─── Agents ──────────────────────────────────────────────────────────────────

/** Paginated list of agents. */
export type AgentListResponse = components["schemas"]["routers__api__agents__AgentListResponse"];

/** Full agent configuration including definition and metadata. */
export type AgentDefinitionResponse = components["schemas"]["AgentDefinitionResponse"];

/** Summary of an agent (returned on create/update). */
export type AgentSummaryResponse = components["schemas"]["AgentSummaryResponse"];

/** Request body for creating an agent. */
export type CreateAgentRequest = components["schemas"]["routers__api__agents__CreateAgentRequest"];

/** Request body for updating an agent. */
export type UpdateAgentRequest = components["schemas"]["routers__api__agents__UpdateAgentRequest"];

/** Request body for updating an agent definition (steps, model, etc.). */
export type UpdateAgentDefinitionRequest = components["schemas"]["UpdateAgentDefinitionRequest"];

// ─── Agent Runs ──────────────────────────────────────────────────────────────

/** Request body for starting an agent run. */
export type AgentRunRequest = components["schemas"]["AgentRunRequest"];

/** Request body for starting an agent run in streaming mode (SSE). */
export type AgentRunStreamRequest = components["schemas"]["AgentRunStreamRequest"];

/** Response body describing an agent run. */
export type AgentRunResponse = components["schemas"]["AgentRunResponse"];

/** Paginated list of agent runs. */
export type AgentRunListResponse = components["schemas"]["routers__api__agents__AgentRunListResponse"];

/** Details of a single step within an agent run. */
export type AgentRunStepResponse = components["schemas"]["AgentRunStepResponse"];

/** Details of a single attempt within an agent run step. */
export type AgentRunAttemptResponse = components["schemas"]["AgentRunAttemptResponse"];

/** Search request for agent runs (traces). */
export type AgentTraceSearchRequest = components["schemas"]["routers__api__agents__AgentTraceSearchRequest"];

/** Search response containing matching agent runs. */
export type AgentTraceSearchResponse = components["schemas"]["AgentTraceSearchResponse"];

/** Individual match within an agent trace search. */
export type AgentTraceMatchResponse = components["schemas"]["AgentTraceMatchResponse"];

// ─── Agent Input Uploads ─────────────────────────────────────────────────────

/** Response from uploading a file input for an agent run. */
export type UploadAgentInputApiResponse = components["schemas"]["UploadAgentInputApiResponse"];

// ─── Agent Steps AI Assistant ────────────────────────────────────────────────

/** Request body for generating agent workflow steps via AI. */
export type GenerateAgentStepsRequest = components["schemas"]["GenerateAgentStepsRequest"];

/** Response containing AI-generated agent workflow steps. */
export type GenerateAgentStepsResponse = components["schemas"]["GenerateAgentStepsResponse"];

/** Request body for generating a single step config via AI. */
export type GenerateStepConfigRequest = components["schemas"]["GenerateStepConfigRequest"];

/** Response containing an AI-generated step config. */
export type GenerateStepConfigResponse = components["schemas"]["GenerateStepConfigResponse"];

/** Example prompt entry used in step config generation. */
export type ExamplePrompt = components["schemas"]["ExamplePrompt"];

/** Request body for marking an AI suggestion as accepted/rejected. */
export type MarkAiSuggestionRequest = components["schemas"]["MarkAiSuggestionRequest"];

/** AI conversation history for an agent. */
export type AiConversationHistoryResponse = components["schemas"]["AiConversationHistoryResponse"];

/** Individual turn in an AI conversation. */
export type AiConversationTurnResponse = components["schemas"]["AiConversationTurnResponse"];

// ─── Agent Evaluations ───────────────────────────────────────────────────────

/** Evaluation tier: fast, balanced, or thorough. */
export type AgentEvaluationTier = components["schemas"]["AgentEvaluationTier"];

/** Evaluation criteria configuration for an agent. */
export type EvaluationCriteriaResponse = components["schemas"]["EvaluationCriteriaResponse"];

/** Request body for creating evaluation criteria. */
export type CreateEvaluationCriteriaRequest = components["schemas"]["CreateEvaluationCriteriaRequest"];

/** Request body for updating evaluation criteria. */
export type UpdateEvaluationCriteriaRequest = components["schemas"]["UpdateEvaluationCriteriaRequest"];

/** Individual evaluation result. */
export type EvaluationResultResponse = components["schemas"]["EvaluationResultResponse"];

/** Paginated list of evaluation results. */
export type EvaluationResultListResponse = components["schemas"]["EvaluationResultListResponse"];

/** Request body for creating a manual evaluation result. */
export type CreateEvaluationResultRequest = components["schemas"]["CreateEvaluationResultRequest"];

/** Summary of evaluation results for a criteria. */
export type EvaluationResultSummaryResponse = components["schemas"]["EvaluationResultSummaryResponse"];

/** Evaluation result with its associated criteria. */
export type EvaluationResultWithCriteriaResponse = components["schemas"]["EvaluationResultWithCriteriaResponse"];

/** Paginated list of evaluation results with criteria. */
export type EvaluationResultWithCriteriaListResponse = components["schemas"]["EvaluationResultWithCriteriaListResponse"];

/** Summary of an evaluation run. */
export type EvaluationRunSummaryResponse = components["schemas"]["EvaluationRunSummaryResponse"];

/** Paginated list of evaluation run summaries. */
export type EvaluationRunSummaryListResponse = components["schemas"]["EvaluationRunSummaryListResponse"];

/** Status of an evaluation: pending, passed, failed, skipped, or error. */
export type EvaluationStatus = components["schemas"]["EvaluationStatus"];

/** Summary of non-manual (automated) evaluation results. */
export type NonManualEvaluationSummaryResponse = components["schemas"]["schemas__v1__agent_evaluations__NonManualEvaluationSummaryResponse"];

/** Per-mode stats within a non-manual evaluation summary. */
export type NonManualEvaluationModeStatResponse = components["schemas"]["schemas__v1__agent_evaluations__NonManualEvaluationModeStatResponse"];

/** Request for testing a draft evaluation. */
export type TestDraftEvaluationRequest = components["schemas"]["TestDraftEvaluationRequest"];

/** Response from testing a draft evaluation. */
export type TestDraftEvaluationResponse = components["schemas"]["TestDraftEvaluationResponse"];

/** Paginated list of runs compatible with a specific evaluation criteria. */
export type CompatibleRunListResponse = components["schemas"]["CompatibleRunListResponse"];

/** Individual compatible run. */
export type CompatibleRunResponse = components["schemas"]["CompatibleRunResponse"];

// ─── Knowledge Bases ─────────────────────────────────────────────────────────

/** Paginated list of knowledge bases. */
export type KnowledgeBaseListResponse = components["schemas"]["KnowledgeBaseListResponseModel"];

/** Full knowledge base configuration and metadata. */
export type KnowledgeBaseResponse = components["schemas"]["KnowledgeBaseResponseModel"];

/** Request body for creating a knowledge base. */
export type CreateKnowledgeBaseBody = components["schemas"]["CreateKnowledgeBaseBody"];

/** Request body for updating a knowledge base. */
export type UpdateKnowledgeBaseBody = components["schemas"]["UpdateKnowledgeBaseBody"];

// ─── Memory Banks ────────────────────────────────────────────────────────────

/** Paginated list of memory banks. */
export type MemoryBankListResponse = components["schemas"]["MemoryBankListResponseModel"];

/** Full memory bank configuration and metadata. */
export type MemoryBankResponse = components["schemas"]["MemoryBankResponseModel"];

/** Request body for creating a memory bank. */
export type CreateMemoryBankBody = components["schemas"]["CreateMemoryBankBody"];

/** Request body for updating a memory bank. */
export type UpdateMemoryBankBody = components["schemas"]["UpdateMemoryBankBody"];

/** Memory bank AI assistant request. */
export type MemoryBankAiAssistantRequest = components["schemas"]["routers__api__memory_banks__MemoryBankAiAssistantRequest"];

/** Memory bank AI assistant response. */
export type MemoryBankAiAssistantResponse = components["schemas"]["MemoryBankAiAssistantResponse"];

/** Memory bank AI accept request. */
export type MemoryBankAcceptRequest = components["schemas"]["routers__api__memory_banks__MemoryBankAcceptRequest"];

/** Memory bank configuration generated by AI. */
export type MemoryBankConfigResponse = components["schemas"]["MemoryBankConfigResponse"];

/** Last conversation for a memory bank AI assistant. */
export type MemoryBankLastConversationResponse = components["schemas"]["routers__api__memory_banks__MemoryBankLastConversationResponse"];

/** Individual turn in a memory bank AI conversation. */
export type MemoryBankConversationTurnResponse = components["schemas"]["routers__api__memory_banks__MemoryBankConversationTurnResponse"];

/** Compaction test request for memory banks. */
export type TestCompactionRequest = components["schemas"]["TestCompactionRequest"];

/** Compaction test response. */
export type CompactionTestResponse = components["schemas"]["CompactionTestResponseModel"];

/** Standalone compaction test request. */
export type StandaloneTestCompactionRequest = components["schemas"]["StandaloneTestCompactionRequest"];

/** Compaction evaluation model result. */
export type CompactionEvaluationModel = components["schemas"]["CompactionEvaluationModel"];

// ─── Sources ─────────────────────────────────────────────────────────────────

/** Paginated list of sources. */
export type SourceListResponse = components["schemas"]["routers__api__sources__SourceListResponse"];

/** Full source response with metadata, sync status, and configuration. */
export type SourceResponse = components["schemas"]["SourceResponse"];

/** Detailed source connection model. */
export type SourceConnectionResponse = components["schemas"]["SourceConnectionResponseModel"];

/** Request body for creating a source. */
export type CreateSourceBody = components["schemas"]["CreateSourceBody"];

/** Request body for updating a source. */
export type UpdateSourceBody = components["schemas"]["UpdateSourceBody"];

/** Upload response for file uploads to a source. */
export type FileUploadResponse = components["schemas"]["routers__api__sources__FileUploadResponse"];

/** Request body for uploading inline text to a source. */
export type InlineTextUploadRequest = components["schemas"]["InlineTextUploadRequest"];

/** Request body for replacing content with inline text. */
export type InlineTextReplaceRequest = components["schemas"]["InlineTextReplaceRequest"];

// ─── Source Exports ──────────────────────────────────────────────────────────

/** Paginated list of source exports. */
export type ExportListResponse = components["schemas"]["ExportListResponse"];

/** Response for a single source export. */
export type ExportResponse = components["schemas"]["routers__api__source_exports__ExportResponse"];

/** Request body for creating a source export. */
export type CreateExportRequest = components["schemas"]["routers__api__source_exports__CreateExportRequest"];

/** Request body for estimating a source export. */
export type EstimateExportRequest = components["schemas"]["routers__api__source_exports__EstimateExportRequest"];

/** Response for a source export estimate. */
export type EstimateExportResponse = components["schemas"]["routers__api__source_exports__EstimateExportResponse"];

/** Supported export formats. */
export type ExportFormat = components["schemas"]["ExportFormat"];

// ─── Source Embedding Migrations ─────────────────────────────────────────────

/** Response for a source embedding migration. */
export type SourceEmbeddingMigrationResponse = components["schemas"]["SourceEmbeddingMigrationResponse"];

/** Request body for starting a source embedding migration. */
export type StartSourceEmbeddingMigrationRequest = components["schemas"]["StartSourceEmbeddingMigrationRequest"];

// ─── Content ─────────────────────────────────────────────────────────────────

/** Content detail response for a specific content version. */
export type ContentDetailResponse = components["schemas"]["routers__api__contents__ContentDetailResponse"];

/** Paginated list of content embeddings. */
export type ContentEmbeddingsListResponse = components["schemas"]["routers__api__contents__ContentEmbeddingsListResponse"];

/** Individual content embedding. */
export type ContentEmbeddingResponse = components["schemas"]["ContentEmbeddingResponse"];

/** Upload response for content replacement uploads. */
export type ContentFileUploadResponse = components["schemas"]["routers__api__contents__FileUploadResponse"];

// ─── Solutions ───────────────────────────────────────────────────────────────

/** Paginated list of solutions. */
export type SolutionListResponse = components["schemas"]["routers__api__solutions__SolutionListResponse"];

/** Full solution configuration and metadata. */
export type SolutionResponse = components["schemas"]["routers__api__solutions__SolutionResponse"];

/** Summary of a solution. */
export type SolutionSummaryResponse = components["schemas"]["SolutionSummaryResponse"];

/** Request body for creating a solution. */
export type CreateSolutionRequest = components["schemas"]["CreateSolutionRequest"];

/** Request body for updating a solution. */
export type UpdateSolutionRequest = components["schemas"]["UpdateSolutionRequest"];

/** Agent within a solution. */
export type SolutionAgentResponse = components["schemas"]["routers__api__solutions__SolutionAgentResponse"];

/** Knowledge base within a solution. */
export type SolutionKnowledgeBaseResponse = components["schemas"]["routers__api__solutions__SolutionKnowledgeBaseResponse"];

/** Source connection within a solution. */
export type SolutionSourceConnectionResponse = components["schemas"]["SolutionSourceConnectionResponse"];

/** Conversation in a solution AI assistant. */
export type SolutionConversationResponse = components["schemas"]["routers__api__solutions__SolutionConversationResponse"];

/** Request body for adding a conversation turn. */
export type AddConversationTurnRequest = components["schemas"]["AddConversationTurnRequest"];

/** Request body for marking a conversation turn. */
export type MarkConversationTurnRequest = components["schemas"]["MarkConversationTurnRequest"];

/** AI assistant generate request for solutions. */
export type AiAssistantGenerateRequest = components["schemas"]["AiAssistantGenerateRequest"];

/** AI assistant generate response for solutions. */
export type AiAssistantGenerateResponse = components["schemas"]["AiAssistantGenerateResponse"];

/** AI assistant accept request for solutions. */
export type AiAssistantAcceptRequest = components["schemas"]["routers__api__solutions__AiAssistantAcceptRequest"];

/** AI assistant accept response for solutions. */
export type AiAssistantAcceptResponse = components["schemas"]["AiAssistantAcceptResponse"];

/** Proposed action in a solution AI plan. */
export type ProposedActionResponse = components["schemas"]["ProposedActionResponse"];

/** Executed action in a solution AI plan. */
export type ExecutedActionResponse = components["schemas"]["ExecutedActionResponse"];

// ─── Resource Linking ────────────────────────────────────────────────────────

/** Request body for linking resources (agents, KBs, sources) to a parent. */
export type LinkResourcesRequest = components["schemas"]["LinkResourcesRequest"];

/** Request body for unlinking resources from a parent. */
export type UnlinkResourcesRequest = components["schemas"]["UnlinkResourcesRequest"];

// ─── Governance ──────────────────────────────────────────────────────────────

/** Governance AI assistant request. */
export type GovernanceAiAssistantRequest = components["schemas"]["routers__api__governance__GovernanceAiAssistantRequest"];

/** Governance AI assistant response. */
export type GovernanceAiAssistantResponse = components["schemas"]["GovernanceAiAssistantResponse"];

/** Governance AI accept response. */
export type GovernanceAiAcceptResponse = components["schemas"]["GovernanceAiAcceptResponse"];

/** Governance conversation turn. */
export type GovernanceConversationResponse = components["schemas"]["routers__api__governance__GovernanceConversationResponse"];

/** Proposed policy action from governance AI. */
export type GovernanceProposedPolicyActionResponse = components["schemas"]["ProposedPolicyActionResponse"];

/** Applied policy action from governance AI. */
export type GovernanceAppliedActionResponse = components["schemas"]["AppliedActionResponse"];

// ─── Alerts ──────────────────────────────────────────────────────────────────

/** Request body for creating an alert config. */
export type CreateAlertConfigRequest = components["schemas"]["CreateAlertConfigRequest"];

/** Request body for updating an alert config. */
export type UpdateAlertConfigRequest = components["schemas"]["UpdateAlertConfigRequest"];

/** Request body to change alert status. */
export type ChangeStatusRequest = components["schemas"]["ChangeStatusRequest"];

/** Request to add a comment to an alert. */
export type AddCommentRequest = components["schemas"]["routers__api__alerts__AddCommentRequest"];

/** Organization alert preference. */
export type OrganizationAlertPreferenceResponse = components["schemas"]["routers__api__alerts__OrganizationAlertPreferenceResponse"];

/** Paginated list of organization alert preferences. */
export type OrganizationAlertPreferenceListResponse = components["schemas"]["OrganizationAlertPreferenceListResponse"];

/** Request to update an organization alert preference. */
export type UpdateOrganizationAlertPreferenceRequest = components["schemas"]["routers__api__alerts__UpdateOrganizationAlertPreferenceRequest"];

// ─── AI Assistant (top-level) ────────────────────────────────────────────────

/** Request body for AI assistant feedback. */
export type AiAssistantFeedbackRequest = components["schemas"]["routers__api__ai_assistant__AiAssistantFeedbackRequest"];

/** AI assistant feedback response. */
export type AiAssistantFeedbackResponse = components["schemas"]["AiAssistantFeedbackResponse"];

// ─── Models ──────────────────────────────────────────────────────────────────

/** Prompt model auto-upgrade strategy. */
export type PromptModelAutoUpgradeStrategy = components["schemas"]["PromptModelAutoUpgradeStrategy"];

// ─── Enums ───────────────────────────────────────────────────────────────────

/** Processing status: pending, processing, completed, or failed. */
export type PendingProcessingCompletedFailedStatus = components["schemas"]["PendingProcessingCompletedFailedStatus"];

// ─── SSE Event Types ─────────────────────────────────────────────────────────

/** An SSE event emitted during a streaming agent run. */
export interface AgentRunEvent {
  /** The SSE event type (e.g. "init", "step", "done", "error", "timeout"). */
  event: string;
  /** Parsed JSON payload (typically an {@link AgentRunResponse}). */
  data: unknown;
}

// ─── Pagination Options ──────────────────────────────────────────────────────

/** Common pagination + sorting options for list endpoints. */
export interface ListOptions {
  /** Page number (1-indexed). */
  page?: number;
  /** Items per page. */
  limit?: number;
}

/** Pagination + sorting options. */
export interface SortableListOptions extends ListOptions {
  /** Field to sort by (e.g. "created_at"). */
  sort?: string;
  /** Sort order. */
  order?: "asc" | "desc";
}
