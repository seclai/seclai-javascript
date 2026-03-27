# Seclai JavaScript SDK

The official JavaScript/TypeScript SDK for the [Seclai](https://seclai.com) API. Provides full typed coverage of all API endpoints, file uploads, SSE streaming, polling helpers, and automatic pagination.

Works in Node.js 18+, Deno, Bun, Cloudflare Workers, and any runtime with a `fetch` implementation.

## Install

```bash
npm install @seclai/sdk
```

## Quick start

```ts
import { Seclai } from "@seclai/sdk";

const client = new Seclai({ apiKey: process.env.SECLAI_API_KEY });

// List all sources
const sources = await client.listSources();

// Run an agent and stream the result
const result = await client.runStreamingAgentAndWait(
  "agent_id",
  { input: "Summarize the latest uploads", metadata: {} },
  { timeoutMs: 120_000 },
);
console.log(result);
```

## Configuration

| Option | Environment variable | Default |
| --- | --- | --- |
| `apiKey` | `SECLAI_API_KEY` | — |
| `accessToken` | — | — |
| `profile` | `SECLAI_PROFILE` | `"default"` |
| `configDir` | `SECLAI_CONFIG_DIR` | `~/.seclai` |
| `autoRefresh` | — | `true` |
| `accountId` | — | — |
| `baseUrl` | `SECLAI_API_URL` | `https://api.seclai.com` |
| `apiKeyHeader` | — | `x-api-key` |
| `defaultHeaders` | — | `{}` |
| `fetch` | — | `globalThis.fetch` |

### Authentication

Credentials are resolved via a chain (first match wins):

1. Explicit `apiKey` option
2. Explicit `accessToken` option (string or `() => string | Promise<string>`)
3. `SECLAI_API_KEY` environment variable
4. SSO — cached tokens from `~/.seclai/sso/cache/` (requires a prior `seclai auth login`)

```ts
// API key
const client = new Seclai({ apiKey: "sk-..." });
```

```ts
// Static bearer token
const client = new Seclai({ accessToken: "eyJhbGciOi..." });
```

```ts
// Dynamic bearer token provider (called per request)
const client = new Seclai({
  accessToken: async () => fetchTokenFromVault(),
});
```

```ts
// SSO profile (uses cached tokens, auto-refreshes)
const client = new Seclai({ profile: "my-profile" });
```

```ts
// Environment variable (no options needed)
// export SECLAI_API_KEY="sk-..."
const client = new Seclai();
```

#### SSO authentication

SSO is the default fallback when no explicit credentials are provided. The SDK
includes built-in production SSO defaults, so `seclai configure sso` is not
required. You only need to log in once to populate the token cache:

```bash
npx @seclai/cli auth login    # authenticate via browser — no prior setup needed
```

To customize SSO settings (e.g. for a staging environment), use `seclai configure sso`
or set environment variables:

| Variable | Description | Default |
|---|---|---|
| `SECLAI_SSO_DOMAIN` | Cognito domain | `auth.seclai.com` |
| `SECLAI_SSO_CLIENT_ID` | Cognito app client ID | `4bgf8v9qmc5puivbaqon9n5lmr` |
| `SECLAI_SSO_REGION` | AWS region | `us-west-2` |

## API documentation

Online API documentation (latest):

https://seclai.github.io/seclai-javascript/latest/

## Resources

### Agents

```ts
// CRUD
const agents = await client.listAgents({ page: 1, limit: 20 });
const agent = await client.createAgent({ name: "My Agent", description: "..." });
const fetched = await client.getAgent("agent_id");
const updated = await client.updateAgent("agent_id", { name: "Renamed" });
await client.deleteAgent("agent_id");

// Definition (step workflow)
const def = await client.getAgentDefinition("agent_id");
await client.updateAgentDefinition("agent_id", { steps: [...], change_id: def.change_id });
```

### Agent runs

```ts
// Start a run
const run = await client.runAgent("agent_id", { input: "Hello" });

// List & search runs
const runs = await client.listAgentRuns("agent_id", { status: "completed" });
const search = await client.searchAgentRuns({ agent_id: "...", status: ["completed"] });

// Fetch run details (optionally with step outputs)
const detail = await client.getAgentRun("run_id", { includeStepOutputs: true });

// Cancel or delete
await client.cancelAgentRun("run_id");
await client.deleteAgentRun("run_id");
```

### Streaming

The SDK provides two streaming patterns over the SSE `/runs/stream` endpoint:

**Block until done** — returns the final `done` payload or throws on timeout:

```ts
const result = await client.runStreamingAgentAndWait(
  "agent_id",
  { input: "Hello", metadata: {} },
  { timeoutMs: 60_000 },
);
```

**Async iterator** — yields every SSE event as `{ event, data }`:

```ts
for await (const event of client.runStreamingAgent(
  "agent_id",
  { input: "Hello" },
  { timeoutMs: 120_000 },
)) {
  console.log(event.event, event.data);
  if (event.event === "done") break;
}
```

### Polling

For environments where SSE is not practical, poll for a completed run:

```ts
const result = await client.runAgentAndPoll(
  "agent_id",
  { input: "Hello" },
  { pollIntervalMs: 2_000, timeoutMs: 120_000 },
);
```

### Agent input uploads

```ts
const upload = await client.uploadAgentInput("agent_id", {
  file: new Uint8Array([...]),
  fileName: "input.pdf",
});
const status = await client.getAgentInputUploadStatus("agent_id", upload.upload_id);
```

### Agent AI assistant

```ts
const steps = await client.generateAgentSteps("agent_id", { user_input: "Build a RAG pipeline" });
const config = await client.generateStepConfig("agent_id", { step_type: "llm", user_input: "..." });

// Conversation history
const history = await client.getAgentAiConversationHistory("agent_id");
await client.markAgentAiSuggestion("agent_id", "conversation_id", { accepted: true });
```

### Agent evaluations

```ts
const criteria = await client.listEvaluationCriteria("agent_id");
const created = await client.createEvaluationCriteria("agent_id", { name: "Accuracy", ... });
const detail = await client.getEvaluationCriteria("criteria_id");
await client.updateEvaluationCriteria("criteria_id", { ... });
await client.deleteEvaluationCriteria("criteria_id");

// Test a draft
await client.testDraftEvaluation("agent_id", { criteria: { ... }, run_id: "..." });

// Results by criteria
const results = await client.listEvaluationResults("criteria_id");
const summary = await client.getEvaluationCriteriaSummary("criteria_id");
await client.createEvaluationResult("criteria_id", { ... });

// Results by run
const runResults = await client.listRunEvaluationResults("agent_id", "run_id");

// Non-manual evaluation summary
const nonManual = await client.getNonManualEvaluationSummary("agent_id");

// Compatible runs for a criteria
const compatible = await client.listCompatibleRuns("criteria_id");
```

### Knowledge bases

```ts
const kbs = await client.listKnowledgeBases();
const kb = await client.createKnowledgeBase({ name: "Docs KB" });
const fetched = await client.getKnowledgeBase("kb_id");
await client.updateKnowledgeBase("kb_id", { name: "Renamed KB" });
await client.deleteKnowledgeBase("kb_id");
```

### Memory banks

```ts
const banks = await client.listMemoryBanks();
const bank = await client.createMemoryBank({ name: "Chat Memory", type: "conversation" });
const fetched = await client.getMemoryBank("mb_id");
await client.updateMemoryBank("mb_id", { name: "Renamed" });
await client.deleteMemoryBank("mb_id");

// Stats & compaction
const stats = await client.getMemoryBankStats("mb_id");
await client.compactMemoryBank("mb_id");

// Test compaction
const test = await client.testMemoryBankCompaction("mb_id", { ... });
const standalone = await client.testCompactionPromptStandalone({ ... });

// Templates & agents
const templates = await client.listMemoryBankTemplates();
const agents = await client.getAgentsUsingMemoryBank("mb_id");

// AI assistant
const suggestion = await client.generateMemoryBankConfig({ user_input: "..." });
const history = await client.getMemoryBankAiLastConversation();
await client.acceptMemoryBankAiSuggestion("conv_id", { ... });

// Source management
await client.deleteMemoryBankSource("mb_id");
```

### Sources

```ts
const sources = await client.listSources({ page: 1, limit: 20, order: "asc" });
const source = await client.createSource({ name: "My Source", ... });
const fetched = await client.getSource("source_id");
await client.updateSource("source_id", { name: "Renamed" });
await client.deleteSource("source_id");
```

### File uploads

Upload a file to a source (max 200 MiB). The SDK infers MIME type from the file extension when `mimeType` is not provided.

```ts
import { readFile } from "node:fs/promises";

await client.uploadFileToSource("source_id", {
  file: await readFile("document.pdf"),
  fileName: "document.pdf",
  title: "Q4 Report",
  metadata: { department: "finance" },
});
```

Upload inline text:

```ts
await client.uploadInlineTextToSource("source_id", {
  text: "Hello, world!",
  title: "Greeting",
});
```

Replace a content version with a new file:

```ts
await client.uploadFileToContent("content_version_id", {
  file: await readFile("updated.pdf"),
  fileName: "updated.pdf",
  mimeType: "application/pdf",
});
```

### Source exports

```ts
const exports = await client.listSourceExports("source_id");
const exp = await client.createSourceExport("source_id", { format: "json" });
const status = await client.getSourceExport("source_id", exp.id);
const estimate = await client.estimateSourceExport("source_id", {});
const response = await client.downloadSourceExport("source_id", exp.id);
await client.deleteSourceExport("source_id", exp.id);
await client.cancelSourceExport("source_id", exp.id);
```

### Source embedding migrations

```ts
const migration = await client.getSourceEmbeddingMigration("source_id");
await client.startSourceEmbeddingMigration("source_id", { target_model: "..." });
await client.cancelSourceEmbeddingMigration("source_id");
```

### Content

```ts
const detail = await client.getContentDetail("content_id", { start: 0, end: 1000 });
const embeddings = await client.listContentEmbeddings("content_id");
await client.deleteContent("content_id");

// Replace content with inline text
await client.replaceContentWithInlineText("content_id", { text: "Updated text", title: "Updated" });

// Upload a replacement file
await client.uploadFileToContent("content_id", {
  file: await readFile("updated.pdf"),
  fileName: "updated.pdf",
});
```

### Solutions

```ts
const solutions = await client.listSolutions();
const sol = await client.createSolution({ name: "My Solution" });
const fetched = await client.getSolution("solution_id");
await client.updateSolution("solution_id", { name: "Renamed" });
await client.deleteSolution("solution_id");

// Link / unlink resources
await client.linkAgentsToSolution("solution_id", { ids: ["agent_id"] });
await client.unlinkAgentsFromSolution("solution_id", { ids: ["agent_id"] });
await client.linkKnowledgeBasesToSolution("solution_id", { ids: ["kb_id"] });
await client.unlinkKnowledgeBasesFromSolution("solution_id", { ids: ["kb_id"] });
await client.linkSourceConnectionsToSolution("solution_id", { ids: ["source_id"] });
await client.unlinkSourceConnectionsFromSolution("solution_id", { ids: ["source_id"] });

// AI assistant
const plan = await client.generateSolutionAiPlan("solution_id", { user_input: "Set up a RAG pipeline" });
await client.acceptSolutionAiPlan("solution_id", "conversation_id", {});
await client.declineSolutionAiPlan("solution_id", "conversation_id");

// AI-generated knowledge base / source within the solution
await client.generateSolutionAiKnowledgeBase("solution_id", { user_input: "..." });
await client.generateSolutionAiSource("solution_id", { user_input: "..." });

// Conversations
const convs = await client.listSolutionConversations("solution_id");
await client.addSolutionConversationTurn("solution_id", { user_input: "..." });
await client.markSolutionConversationTurn("solution_id", "conversation_id", { ... });
```

### Governance AI

```ts
const plan = await client.generateGovernanceAiPlan({ user_input: "Add a toxicity policy" });
const convs = await client.listGovernanceAiConversations();
await client.acceptGovernanceAiPlan("conversation_id");
await client.declineGovernanceAiPlan("conversation_id");
```

### Alerts

```ts
const alerts = await client.listAlerts({ status: "active" });
const alert = await client.getAlert("alert_id");
await client.changeAlertStatus("alert_id", { status: "resolved" });
await client.addAlertComment("alert_id", { text: "Investigating" });

// Subscriptions
await client.subscribeToAlert("alert_id");
await client.unsubscribeFromAlert("alert_id");

// Alert configs
const configs = await client.listAlertConfigs();
await client.createAlertConfig({ ... });
await client.getAlertConfig("config_id");
await client.updateAlertConfig("config_id", { ... });
await client.deleteAlertConfig("config_id");

// Organization preferences
const prefs = await client.listOrganizationAlertPreferences();
await client.updateOrganizationAlertPreference("org_id", "alert_type", { ... });
```

### Models

```ts
const alerts = await client.listModelAlerts();
await client.markModelAlertRead("alert_id");
await client.markAllModelAlertsRead();
const unread = await client.getUnreadModelAlertCount();
const recs = await client.getModelRecommendations("model_id");
```

### Search

```ts
const results = await client.search({ query: "quarterly report" });
const filtered = await client.search({ query: "my agent", entityType: "agent", limit: 5 });
```

### Top-level AI assistant

```ts
// Generate plans for different resource types
const kb = await client.aiAssistantKnowledgeBase({ user_input: "Create a docs KB" });
const src = await client.aiAssistantSource({ user_input: "Add a web source" });
const sol = await client.aiAssistantSolution({ user_input: "Set up monitoring" });
const mb = await client.aiAssistantMemoryBank({ user_input: "Create a chat memory" });

// Accept or decline the generated plan
await client.acceptAiAssistantPlan("conversation_id", { confirm_deletions: true });
await client.declineAiAssistantPlan("conversation_id");

// Memory bank conversation history
const history = await client.getAiAssistantMemoryBankHistory();
await client.acceptAiMemoryBankSuggestion("conversation_id", { ... });

// Feedback
await client.submitAiFeedback({ ... });
```

## Pagination helper

Automatically iterate through all pages:

```ts
for await (const source of client.paginate(
  (opts) => client.listSources(opts),
  { limit: 50 },
)) {
  console.log(source.name);
}
```

## Error handling

All errors extend `SeclaiError`:

```ts
import {
  SeclaiError,
  SeclaiConfigurationError,
  SeclaiAPIStatusError,
  SeclaiAPIValidationError,
  SeclaiStreamingError,
} from "@seclai/sdk";

try {
  await client.getAgent("bad_id");
} catch (err) {
  if (err instanceof SeclaiAPIValidationError) {
    console.error("Validation:", err.validationError);
  } else if (err instanceof SeclaiAPIStatusError) {
    console.error(`HTTP ${err.statusCode}:`, err.responseText);
  } else if (err instanceof SeclaiStreamingError) {
    console.error("Stream failed for run:", err.runId);
  }
}
```

## Cancellation (AbortSignal)

All low-level methods support an `AbortSignal` for request cancellation:

```ts
const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5_000);

const data = await client.request("GET", "/agents", {
  signal: controller.signal,
});
```

## Low-level access

For endpoints not yet covered by a convenience method, use `request` or `requestRaw`:

```ts
// JSON request/response
const data = await client.request("POST", "/custom/endpoint", {
  json: { key: "value" },
  query: { filter: "active" },
});

// Raw Response (e.g. binary downloads)
const response = await client.requestRaw("GET", "/files/download/123");
const blob = await response.blob();
```

## Development

### Install dependencies

```bash
npm install
```

### Type checking

```bash
npm run typecheck
```

### Build

```bash
npm run build
```

This also regenerates `src/openapi.ts` from `openapi/seclai.openapi.json`.

### Run tests

```bash
npm test
```

### Generate docs

Generate HTML docs into `build/docs/`:

```bash
npm run docs
```
