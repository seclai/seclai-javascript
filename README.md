# Seclai JavaScript SDK

This is the official Seclai JavaScript SDK with TypeScript typings.

## Install

```bash
npm install @seclai/sdk
```

## Usage

```ts
import { Seclai } from "@seclai/sdk";

const client = new Seclai({ apiKey: process.env.SECLAI_API_KEY });

const sources = await client.listSources();
console.log(sources.pagination, sources.data);
```

### Upload a file

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

This also regenerates `src/openapi.ts` from `../seclai-python/openapi/seclai.openapi.json`.
