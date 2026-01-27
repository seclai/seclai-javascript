# Seclai JavaScript SDK

This is the official Seclai JavaScript SDK with TypeScript typings.

## Install

```bash
npm install @seclai/sdk
```

## API documentation

Online API documentation (latest):

https://seclai.github.io/seclai-javascript/latest/

## Usage

```ts
import { Seclai } from "@seclai/sdk";

const client = new Seclai({ apiKey: process.env.SECLAI_API_KEY });

const sources = await client.listSources();
console.log(sources.pagination, sources.data);
```

### Run an agent with SSE streaming (wait for final result)

Use the SSE streaming endpoint and block until the final `done` event is received.

If the stream ends before `done` or the timeout is reached, this method throws.

```ts
import { Seclai } from "@seclai/sdk";

const client = new Seclai({ apiKey: process.env.SECLAI_API_KEY });

const run = await client.runStreamingAgentAndWait(
  "agent_id",
  {
    input: "Hello from streaming",
    metadata: { app: "My App" },
  },
  { timeoutMs: 60_000 }
);

console.log(run);
```

### Get agent run details

Fetch details for a specific agent run, optionally including per-step outputs:

```ts
import { Seclai } from "@seclai/sdk";

const client = new Seclai({ apiKey: process.env.SECLAI_API_KEY });

// Basic details
const run = await client.getAgentRun("run_id");
console.log(run);

// Include per-step outputs with timing, durations, and credits
const runWithSteps = await client.getAgentRun("run_id", {
  includeStepOutputs: true,
});
console.log(runWithSteps);
```

### Upload a file

**Max file size:** 200 MiB.

**Supported MIME types:**
- `application/epub+zip`
- `application/json`
- `application/msword`
- `application/pdf`
- `application/vnd.ms-excel`
- `application/vnd.ms-outlook`
- `application/vnd.ms-powerpoint`
- `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/xml`
- `application/zip`
- `audio/flac`, `audio/mp4`, `audio/mpeg`, `audio/ogg`, `audio/wav`
- `image/bmp`, `image/gif`, `image/jpeg`, `image/png`, `image/tiff`, `image/webp`
- `text/csv`, `text/html`, `text/markdown`, `text/x-markdown`, `text/plain`, `text/xml`
- `video/mp4`, `video/quicktime`, `video/x-msvideo`

If the upload is sent as `application/octet-stream`, the server attempts to infer the type from the file extension, so pass `fileName` with a meaningful extension.

```ts
import { Seclai } from "@seclai/sdk";

const client = new Seclai({ apiKey: process.env.SECLAI_API_KEY });

const bytes = new TextEncoder().encode("hello");
const upload = await client.uploadFileToSource("source_connection_id", {
  file: bytes,
  fileName: "hello.txt",
  mimeType: "text/plain",
  title: "Hello",
});
console.log(upload);
```

## Development

### Base URL

Set `SECLAI_API_URL` to point at a different API host (e.g., staging):

```bash
export SECLAI_API_URL="https://example.invalid"
```

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

### Generate docs

Generate HTML docs into `build/docs/`:

```bash
npm run docs
```
