/**
 * @module
 *
 * Seclai JavaScript/TypeScript SDK.
 *
 * ```ts
 * import { Seclai } from "@seclai/sdk";
 *
 * const client = new Seclai({ apiKey: process.env.SECLAI_API_KEY });
 * const agents = await client.listAgents();
 * ```
 *
 * @see {@link Seclai} for the main client class.
 * @packageDocumentation
 */
export {
  Seclai,
  SECLAI_API_URL,
  type SeclaiOptions,
  type FetchLike,
  type AccessTokenProvider,
} from "./client";

export {
  type SsoProfile,
  type SsoCacheEntry,
  type AuthState,
  type CredentialChainOptions,
  DEFAULT_SSO_DOMAIN,
  DEFAULT_SSO_CLIENT_ID,
  DEFAULT_SSO_REGION,
  loadSsoProfile,
  readSsoCache,
  writeSsoCache,
  deleteSsoCache,
  isTokenValid,
} from "./auth";

export {
  SeclaiError,
  SeclaiConfigurationError,
  SeclaiAPIStatusError,
  SeclaiAPIValidationError,
  SeclaiStreamingError,
} from "./errors";

export type {
  // General
  JSONValue,
  HTTPValidationError,
  ValidationError,
  PaginationResponse,
  ListOptions,
  SortableListOptions,

  // Agents
  AgentListResponse,
  AgentDefinitionResponse,
  AgentSummaryResponse,
  CreateAgentRequest,
  UpdateAgentRequest,
  UpdateAgentDefinitionRequest,

  // Agent Runs
  AgentRunRequest,
  AgentRunStreamRequest,
  AgentRunResponse,
  AgentRunListResponse,
  AgentRunStepResponse,
  AgentRunAttemptResponse,
  AgentTraceSearchRequest,
  AgentTraceSearchResponse,
  AgentTraceMatchResponse,
  AgentRunEvent,

  // Agent Input Uploads
  UploadAgentInputApiResponse,

  // Agent AI Assistant
  GenerateAgentStepsRequest,
  GenerateAgentStepsResponse,
  GenerateStepConfigRequest,
  GenerateStepConfigResponse,
  ExamplePrompt,
  MarkAiSuggestionRequest,
  AiConversationHistoryResponse,
  AiConversationTurnResponse,

  // Agent Evaluations
  AgentEvaluationTier,
  EvaluationCriteriaResponse,
  CreateEvaluationCriteriaRequest,
  UpdateEvaluationCriteriaRequest,
  EvaluationResultResponse,
  EvaluationResultListResponse,
  CreateEvaluationResultRequest,
  EvaluationResultSummaryResponse,
  EvaluationResultWithCriteriaResponse,
  EvaluationResultWithCriteriaListResponse,
  EvaluationRunSummaryResponse,
  EvaluationRunSummaryListResponse,
  EvaluationStatus,
  NonManualEvaluationSummaryResponse,
  NonManualEvaluationModeStatResponse,
  TestDraftEvaluationRequest,
  TestDraftEvaluationResponse,
  CompatibleRunListResponse,
  CompatibleRunResponse,

  // Knowledge Bases
  KnowledgeBaseListResponse,
  KnowledgeBaseResponse,
  CreateKnowledgeBaseBody,
  UpdateKnowledgeBaseBody,

  // Memory Banks
  MemoryBankListResponse,
  MemoryBankResponse,
  CreateMemoryBankBody,
  UpdateMemoryBankBody,
  MemoryBankAiAssistantRequest,
  MemoryBankAiAssistantResponse,
  MemoryBankAcceptRequest,
  MemoryBankConfigResponse,
  MemoryBankLastConversationResponse,
  MemoryBankConversationTurnResponse,
  TestCompactionRequest,
  CompactionTestResponse,
  CompactionEvaluationModel,
  StandaloneTestCompactionRequest,

  // Sources
  SourceListResponse,
  SourceResponse,
  SourceConnectionResponse,
  CreateSourceBody,
  UpdateSourceBody,
  FileUploadResponse,
  InlineTextUploadRequest,
  InlineTextReplaceRequest,

  // Source Exports
  ExportListResponse,
  ExportResponse,
  CreateExportRequest,
  EstimateExportRequest,
  EstimateExportResponse,
  ExportFormat,

  // Source Embedding Migrations
  SourceEmbeddingMigrationResponse,
  StartSourceEmbeddingMigrationRequest,

  // Content
  ContentDetailResponse,
  ContentEmbeddingsListResponse,
  ContentEmbeddingResponse,
  ContentFileUploadResponse,

  // Solutions
  SolutionListResponse,
  SolutionResponse,
  SolutionSummaryResponse,
  CreateSolutionRequest,
  UpdateSolutionRequest,
  SolutionAgentResponse,
  SolutionKnowledgeBaseResponse,
  SolutionSourceConnectionResponse,
  SolutionConversationResponse,
  AddConversationTurnRequest,
  MarkConversationTurnRequest,
  AiAssistantGenerateRequest,
  AiAssistantGenerateResponse,
  AiAssistantAcceptRequest,
  AiAssistantAcceptResponse,
  ProposedActionResponse,
  ExecutedActionResponse,

  // Resource Linking
  LinkResourcesRequest,
  UnlinkResourcesRequest,

  // Governance
  GovernanceAiAssistantRequest,
  GovernanceAiAssistantResponse,
  GovernanceAiAcceptResponse,
  GovernanceConversationResponse,
  GovernanceProposedPolicyActionResponse,
  GovernanceAppliedActionResponse,

  // Alerts
  CreateAlertConfigRequest,
  UpdateAlertConfigRequest,
  ChangeStatusRequest,
  AddCommentRequest,
  OrganizationAlertPreferenceResponse,
  OrganizationAlertPreferenceListResponse,
  UpdateOrganizationAlertPreferenceRequest,

  // AI Assistant (top-level)
  AiAssistantFeedbackRequest,
  AiAssistantFeedbackResponse,

  // Models
  PromptModelAutoUpgradeStrategy,

  // Enums
  PendingProcessingCompletedFailedStatus,
} from "./types";
