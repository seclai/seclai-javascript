# Changelog

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
