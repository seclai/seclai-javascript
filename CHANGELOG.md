# Changelog

## [1.5.0] - 2026-07-27

### Changed

- Return typed results from the 20 methods that previously declared `unknown` — alerts, alert configs, model alerts and recommendations, playground experiments, search and the AI assistant acknowledgements. Narrowing `unknown` to a concrete type is source compatible, so no façade is needed here
- Stop sending `severity` from `listAlerts()`. `GET /alerts` declares no such filter, so it never filtered, and it becomes a 422 once `apiVersion` is `2026-07-27` or later. The option is still accepted and ignored
- Accept either wire shape from `listEvaluationCriteria()`. The endpoint is moving from a bare array to a paginated envelope, so the client now reads both and keeps returning `EvaluationCriteriaResponse[]`
- Sync the bundled OpenAPI spec with the API fixes found while updating the SDKs: `agent_id` is now declared on the non-manual evaluation summary, and `page`/`limit` on the evaluation and alert-config listings
- Deprecate `deleteAgentRun()`. It never deleted anything — the endpoint it calls is documented as "Cancel an agent run", and the API has no delete-a-run operation. Use `cancelAgentRun()`

### Added

- Add the `SeclaiApiVersion` constants and the `ApiVersion` type. An `apiVersion` this release was not built against throws at construction, since a newer version can reshape responses this client would mis-decode; set `allowUnknownApiVersion` to override
- Add 20 response type exports covering those endpoints, including `AlertResponse`, `AlertDetailResponse`, `AlertConfigResponse`, `ModelAlertResponse`, `ExperimentDetailResponse`, `SearchResponse` and `OkResponse`
- Add `listEvaluationCriteriaPage()` for the canonical `{data, pagination}` envelope, which the endpoint emits once `apiVersion` is `2026-07-27` or later
- Add an `apiVersion` client option, sent as the `Seclai-Version` header, opting into dated API changes released on or before that date. Omitted by default, so upgrading the SDK alone never changes response shapes
- Add `getApiVersion()` and `updateApiVersion()` to read the version a request resolves to and to pin or clear the account's version
- Add the `ApiVersionResponse` type export
- Add the `EvaluationCriteriaListResponse` type export

### Fixed

- Validate a `Seclai-Version` supplied through `defaultHeaders`, not just the `apiVersion` option. `defaultHeaders` is applied last so it wins, which left the unknown-version guard one header away from being bypassed; a differently-cased key also emitted two wire headers
- Throw from `getAgentAiConversationHistory()` when `opts.stepType` is missing. It was optional and dropped by `buildURL`, so a call without it still 422'd — the failure this method was changed to prevent
- Decode either wire shape in `listRunEvaluationResults()`. The endpoint answers with a bare array, which the declared envelope type could not read, so the method returned nothing; it now also reads the canonical `{data, pagination}` envelope. `listAgentEvaluationResults()` is genuinely flat and is unaffected
- Paginate `listModelAlerts()` with the `offset` the endpoint declares instead of `page`, which it does not accept — every page after the first returned page 1
- Send `step_type` from `getAgentAiConversationHistory()`, along with `stepId`, `limit` and `offset`. The API marks `step_type` required and the method had no way to supply it, so every call answered 422
- Request `GET /sources` rather than `GET /sources/`. The trailing-slash form is no longer declared by the API
- Point `cancelAgentRun()` at `DELETE /agents/runs/{run_id}`. It posted to `/agents/runs/{run_id}/cancel`, a path the API has never exposed, so cancelling a run always failed

## [1.4.0] - 2026-07-25

### Changed

- Sync the bundled OpenAPI spec, adding 22 paths and 22 schemas
- Extend `listModels()` with `supportsInputMedia` and `supportsOutputMedia` capability filters

### Added

- Add `getMe()` returning the authenticated user's account id and organization memberships
- Add `disableAgent()`, `enableAgent()`, and `getAgentCallers()` to pause and resume an agent across every trigger path
- Add `setEmailTriggerConfig()` to set the alias, sender allowlist, and inbound-handling flags on an `EMAIL_RECEIVED` trigger
- Add agent-email opt-out methods `listAgentEmailOptOuts()` and `removeAgentEmailOptOut()`
- Add inbound sender blocklist methods `listBlockedEmailSenders()`, `blockEmailSender()`, `unblockEmailSender()`, and `setAutoBlockMode()`
- Add inbound-email observability methods `listInboundEmailRejections()`, `getInboundEmailStatus()`, `cancelQueuedEmailRuns()`, and `resumeInboundEmail()`
- Add email domain management: `listEmailDomains()`, `addEmailDomain()`, `removeEmailDomain()`, `verifyEmailDomain()`, `setPrimaryEmailDomain()`, `useSharedEmailDomain()`, `sendEmailDomainTestEmail()`, and `getDmarcSummary()`
- Add `getGenerationTiers()` mapping each media-generation modality and tier to its model and cost
- Add `searchDocs()` for keyword or semantic search over the Seclai documentation

### Fixed

- Return `OrganizationAlertPreferenceResponse` from `updateOrganizationAlertPreference()` instead of `unknown`, so the response fields are reachable without a cast

## [1.3.0] - 2026-06-05

### Changed

- Accept `MemoryBankAiAssistantRequest` in `aiAssistantMemoryBank()` instead of the solutions request type ([#9](https://github.com/seclai/seclai-javascript/pull/9))

### Added

- Add `getAgentAttachmentReferences()` to read an agent's static attachment-reference contract before staging uploads ([#9](https://github.com/seclai/seclai-javascript/pull/9))
- Add `downloadAgentRunAttachment()` returning the raw `Response` for a file emitted by a run step ([#9](https://github.com/seclai/seclai-javascript/pull/9))
- Add `deleteExperiment()` to soft-delete a model playground experiment ([#9](https://github.com/seclai/seclai-javascript/pull/9))
- Add `InsufficientCreditsResponse` and `InsufficientCreditsDetail` types for HTTP 402 responses ([#9](https://github.com/seclai/seclai-javascript/pull/9))
- Add `AgentRunToolCallResponse` and `ModalityRateResponse` types ([#9](https://github.com/seclai/seclai-javascript/pull/9))

## [1.2.0] - 2026-05-22

### Added

- Add `previewImportAgent()` to dry-run an agent definition import and surface unresolved entity refs ([#8](https://github.com/seclai/seclai-javascript/pull/8))
- Add agent import types, including `AgentDefinitionImportErrorResponse` with line and column positions into the canonical source echo ([#8](https://github.com/seclai/seclai-javascript/pull/8))

## [1.1.5] - 2026-04-24

### Added

- Add `listModels()` and `getModel()` for the model catalog ([#7](https://github.com/seclai/seclai-javascript/pull/7))
- Add model playground methods `listExperiments()`, `createExperiment()`, `getExperiment()`, and `cancelExperiment()` ([#7](https://github.com/seclai/seclai-javascript/pull/7))
- Add `SourceIndexMode` and model pricing types ([#7](https://github.com/seclai/seclai-javascript/pull/7))

## [1.1.4] - 2026-04-02

### Added

- Add `exportAgent()` returning a portable JSON snapshot of an agent definition ([#6](https://github.com/seclai/seclai-javascript/pull/6))

## [1.1.3] - 2026-03-27

### Changed

- Default the SSO domain, client id, and region so a profile only needs `sso_account_id`, and allow overriding each via `SECLAI_SSO_DOMAIN`, `SECLAI_SSO_CLIENT_ID`, and `SECLAI_SSO_REGION` ([#5](https://github.com/seclai/seclai-javascript/pull/5))
- Make `sso_account_id` optional when loading an SSO profile ([#5](https://github.com/seclai/seclai-javascript/pull/5))

### Added

- Export the SSO helpers `loadSsoProfile()`, `readSsoCache()`, `writeSsoCache()`, `deleteSsoCache()`, and `isTokenValid()`, plus the `DEFAULT_SSO_*` constants ([#5](https://github.com/seclai/seclai-javascript/pull/5))
- Add `GET /me` to the bundled OpenAPI spec; the corresponding `getMe()` client method arrived in 1.4.0 ([#5](https://github.com/seclai/seclai-javascript/pull/5))

## [1.1.2] - 2026-03-26

### Changed

- Update the bundled OpenAPI spec's auth descriptions to match the supported auth options ([`6d534c4`](https://github.com/seclai/seclai-javascript/commit/6d534c4))

## [1.1.1] - 2026-03-26

### Added

- Add OAuth SSO authentication with `~/.seclai/config` profiles, an on-disk token cache, and automatic refresh ([#4](https://github.com/seclai/seclai-javascript/pull/4))
- Add an `accountId` option, sent as the `X-Account-Id` header, to switch organization account context ([#4](https://github.com/seclai/seclai-javascript/pull/4))
- Add an `accessToken` option accepting either a static bearer token or a provider function called per request ([#4](https://github.com/seclai/seclai-javascript/pull/4))

## [1.1.0] - 2026-03-23

### Added

- Expand endpoint coverage to knowledge bases, memory banks, sources, source exports, embedding migrations, content, solutions, alerts, governance, evaluations, and the AI assistants ([#3](https://github.com/seclai/seclai-javascript/pull/3))
- Add `runStreamingAgent()`, an async iterator yielding every SSE event of a run ([#3](https://github.com/seclai/seclai-javascript/pull/3))
- Add `runAgentAndPoll()` for environments where SSE is impractical ([#3](https://github.com/seclai/seclai-javascript/pull/3))
- Add `requestRaw()` as a low-level escape hatch returning the raw `Response` ([#3](https://github.com/seclai/seclai-javascript/pull/3))
- Add `search()` across all resource types in an account ([#3](https://github.com/seclai/seclai-javascript/pull/3))

## [1.0.7] - 2026-01-30

### Added

- Add `uploadFileToContent()` to replace existing content with a file upload ([`729298f`](https://github.com/seclai/seclai-javascript/commit/729298f))
- Add a `metadata` option to the upload methods, sent as a JSON string form field ([`729298f`](https://github.com/seclai/seclai-javascript/commit/729298f))

### Fixed

- Export the `SourceFileUploadResponse` and `ContentFileUploadResponse` types ([`36bff73`](https://github.com/seclai/seclai-javascript/commit/36bff73))

## [1.0.6] - 2026-01-27

### Changed

- Accept a run id alone in `getAgentRun()` and `deleteAgentRun()`; the leading agent id is now an optional overload ([`fcf6ff9`](https://github.com/seclai/seclai-javascript/commit/fcf6ff9))

## [1.0.5] - 2026-01-27

### Added

- Add an `includeStepOutputs` option to `getAgentRun()` ([`795fd21`](https://github.com/seclai/seclai-javascript/commit/795fd21))

## [1.0.4] - 2026-01-27

### Changed

- Document the 200 MiB upload limit and the supported MIME types on the upload methods ([`bece917`](https://github.com/seclai/seclai-javascript/commit/bece917))

### Fixed

- Point the default base URL at `https://api.seclai.com` instead of `https://seclai.com` ([`bece917`](https://github.com/seclai/seclai-javascript/commit/bece917))

## [1.0.3] - 2026-01-13

### Fixed

- Drop the `/api` prefix from request paths so they match the deployed API ([`3d72194`](https://github.com/seclai/seclai-javascript/commit/3d72194))

## [1.0.2] - 2026-01-13

### Added

- Add `runStreamingAgentAndWait()` to block until a streaming run completes ([`b55503d`](https://github.com/seclai/seclai-javascript/commit/b55503d))

## [1.0.1] - 2026-01-12

### Added

- Add a documentation homepage link to the package metadata ([`3786d9d`](https://github.com/seclai/seclai-javascript/commit/3786d9d))
- Add a release script that stamps the version into the README ([`3786d9d`](https://github.com/seclai/seclai-javascript/commit/3786d9d))

## [1.0.0] - 2026-01-12

_Stable release. No functional changes since 0.0.1._

## [0.0.1] - 2026-01-12

_Initial release._

[1.5.0]: https://github.com/seclai/seclai-javascript/releases/tag/1.5.0
[1.4.0]: https://github.com/seclai/seclai-javascript/releases/tag/1.4.0
[1.3.0]: https://github.com/seclai/seclai-javascript/releases/tag/1.3.0
[1.2.0]: https://github.com/seclai/seclai-javascript/releases/tag/1.2.0
[1.1.5]: https://github.com/seclai/seclai-javascript/releases/tag/1.1.5
[1.1.4]: https://github.com/seclai/seclai-javascript/releases/tag/1.1.4
[1.1.3]: https://github.com/seclai/seclai-javascript/releases/tag/1.1.3
[1.1.2]: https://github.com/seclai/seclai-javascript/releases/tag/1.1.2
[1.1.1]: https://github.com/seclai/seclai-javascript/releases/tag/1.1.1
[1.1.0]: https://github.com/seclai/seclai-javascript/releases/tag/1.1.0
[1.0.7]: https://github.com/seclai/seclai-javascript/releases/tag/1.0.7
[1.0.6]: https://github.com/seclai/seclai-javascript/releases/tag/1.0.6
[1.0.5]: https://github.com/seclai/seclai-javascript/releases/tag/1.0.5
[1.0.4]: https://github.com/seclai/seclai-javascript/releases/tag/1.0.4
[1.0.3]: https://github.com/seclai/seclai-javascript/releases/tag/1.0.3
[1.0.2]: https://github.com/seclai/seclai-javascript/releases/tag/1.0.2
[1.0.1]: https://github.com/seclai/seclai-javascript/releases/tag/1.0.1
[1.0.0]: https://github.com/seclai/seclai-javascript/releases/tag/1.0.0
[0.0.1]: https://github.com/seclai/seclai-javascript/releases/tag/0.0.1
