import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import {
  Seclai,
  SeclaiAPIStatusError,
  SeclaiAPIValidationError,
  SeclaiConfigurationError,
  SeclaiError,
  SeclaiStreamingError,
  SeclaiApiVersion,
} from "../src/index";
import { parseIni, isTokenValid } from "../src/auth";

type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText?: string;
  body?: BodyInit;
  signal?: AbortSignal | null;
};

function makeFetch(handler: (req: RecordedRequest) => Response | Promise<Response>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";

    const headersObj = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    for (const [k, v] of headersObj.entries()) headers[k.toLowerCase()] = v;

    let bodyText: string | undefined;
    if (typeof init?.body === "string") {
      bodyText = init.body;
    }

    return await handler({
      url,
      method,
      headers,
      bodyText,
      body: init?.body ?? undefined,
      signal: init?.signal ?? null,
    });
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeSseResponse(
  chunks: string[],
  opts?: { signal?: AbortSignal | null; contentType?: string }
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let cancelled = false;
      const onAbort = () => {
        cancelled = true;
        try { controller.error(new Error("aborted")); } catch { /* ignore */ }
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      (async () => {
        for (const chunk of chunks) {
          if (cancelled) return;
          controller.enqueue(encoder.encode(chunk));
          await Promise.resolve();
        }
        controller.close();
      })().catch((e) => controller.error(e));
    },
  });
  return new Response(stream as any, {
    status: 200,
    headers: { "content-type": opts?.contentType ?? "text/event-stream" },
  });
}

function makeClient(
  handler: (req: RecordedRequest) => Response | Promise<Response>,
  extra: Partial<ConstructorParameters<typeof Seclai>[0]> = {},
) {
  return new Seclai({
    apiKey: "test-key",
    baseUrl: "https://test.invalid",
    fetch: makeFetch(handler),
    ...extra,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration & Auth
// ─────────────────────────────────────────────────────────────────────────────

describe("Configuration & Auth", () => {
  test("constructor throws when both apiKey and accessToken provided", () => {
    expect(() => new Seclai({
      apiKey: "k",
      accessToken: "t",
      fetch: makeFetch(() => new Response("ok")),
    })).toThrow(SeclaiConfigurationError);
  });

  test("first request rejects when no credentials can be resolved", async () => {
    const p = (globalThis as any).process;
    const prev = p?.env?.SECLAI_API_KEY;
    const prevDir = p?.env?.SECLAI_CONFIG_DIR;
    if (p?.env) {
      delete p.env.SECLAI_API_KEY;
      p.env.SECLAI_CONFIG_DIR = "/nonexistent-seclai-dir";
    }
    const client = new Seclai({ fetch: makeFetch(() => new Response("ok")) });
    await expect(client.request("GET", "/test")).rejects.toThrow(/SSO token expired/);
    if (p?.env) {
      if (prev === undefined) delete p.env.SECLAI_API_KEY;
      else p.env.SECLAI_API_KEY = prev;
      if (prevDir === undefined) delete p.env.SECLAI_CONFIG_DIR;
      else p.env.SECLAI_CONFIG_DIR = prevDir;
    }
  });

  test("injects x-api-key header", async () => {
    const client = makeClient((req) => {
      expect(req.headers["x-api-key"]).toBe("test-key");
      return jsonResponse({ ok: true });
    });
    await client.request("GET", "/test");
  });

  test("uses SECLAI_API_URL env var", async () => {
    const p = (globalThis as any).process;
    const prev = p?.env?.SECLAI_API_URL;
    if (p?.env) p.env.SECLAI_API_URL = "https://env.example.invalid";

    const client = new Seclai({
      apiKey: "k",
      fetch: makeFetch((req) => {
        expect(new URL(req.url).origin).toBe("https://env.example.invalid");
        return jsonResponse({});
      }),
    });
    await client.request("GET", "/test");

    if (p?.env) {
      if (prev === undefined) delete p.env.SECLAI_API_URL;
      else p.env.SECLAI_API_URL = prev;
    }
  });

  test("preserves path prefix in baseUrl", async () => {
    const client = new Seclai({
      apiKey: "k",
      baseUrl: "https://proxy.example.invalid/v1/api",
      fetch: makeFetch((req) => {
        const u = new URL(req.url);
        expect(u.pathname).toBe("/v1/api/agents");
        return jsonResponse([]);
      }),
    });
    await client.request("GET", "/agents");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling
// ─────────────────────────────────────────────────────────────────────────────

describe("Error Handling", () => {
  test("throws SeclaiAPIValidationError on 422", async () => {
    const client = makeClient(() =>
      new Response(JSON.stringify({ detail: [{ loc: ["body"], msg: "bad", type: "value_error" }] }), {
        status: 422, headers: { "content-type": "application/json" },
      }),
    );
    await expect(client.listSources()).rejects.toBeInstanceOf(SeclaiAPIValidationError);
  });

  test("throws SeclaiAPIStatusError on non-2xx", async () => {
    const client = makeClient(() => new Response("nope", { status: 401 }));
    await expect(client.listSources()).rejects.toBeInstanceOf(SeclaiAPIStatusError);
  });

  test("SeclaiStreamingError has runId", () => {
    const err = new SeclaiStreamingError("timeout", "run_xyz");
    expect(err.runId).toBe("run_xyz");
    expect(err.name).toBe("SeclaiStreamingError");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agents — CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe("Agents — CRUD", () => {
  test("listAgents sends GET /agents with pagination", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      const u = new URL(req.url);
      expect(u.pathname).toBe("/agents");
      expect(u.searchParams.get("page")).toBe("2");
      expect(u.searchParams.get("limit")).toBe("10");
      return jsonResponse({ items: [], pagination: {} });
    });
    await client.listAgents({ page: 2, limit: 10 });
  });

  test("createAgent sends POST /agents", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents");
      const body = JSON.parse(req.bodyText!);
      expect(body.name).toBe("test-agent");
      return jsonResponse({ id: "ag_1", name: "test-agent" }, 201);
    });
    await client.createAgent({ name: "test-agent" } as any);
  });

  test("getAgent sends GET /agents/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1");
      return jsonResponse({ id: "ag_1" });
    });
    await client.getAgent("ag_1");
  });

  test("updateAgent sends PUT /agents/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PUT");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1");
      return jsonResponse({ id: "ag_1" });
    });
    await client.updateAgent("ag_1", { name: "updated" } as any);
  });

  test("deleteAgent sends DELETE /agents/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1");
      return new Response(null, { status: 204 });
    });
    await client.deleteAgent("ag_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Export
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent Export", () => {
  test("exportAgent sends GET /agents/:id/export with download=true by default", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      const url = new URL(req.url);
      expect(url.pathname).toBe("/agents/ag_1/export");
      expect(url.searchParams.get("download")).toBe("true");
      return jsonResponse({ export_version: "2", agent: {} });
    });
    await client.exportAgent("ag_1");
  });

  test("exportAgent passes download=false when specified", async () => {
    const client = makeClient((req) => {
      const url = new URL(req.url);
      expect(url.searchParams.get("download")).toBe("false");
      return jsonResponse({ export_version: "2", agent: {} });
    });
    await client.exportAgent("ag_1", false);
  });

  test("previewImportAgent sends POST /agents/preview-import", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/preview-import");
      const body = JSON.parse(req.bodyText!);
      expect(body.agent_definition).toEqual({ agent: { name: "n" } });
      return jsonResponse({
        ok: true,
        agent_name: "n",
        description: null,
        step_count: 0,
        schedules: 0,
        alert_configs: 0,
        evaluation_criteria: 0,
        governance_policies: 0,
      });
    });
    await client.previewImportAgent({ agent_definition: { agent: { name: "n" } } } as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Definitions
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent Definitions", () => {
  test("getAgentDefinition sends GET /agents/:id/definition", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/definition");
      return jsonResponse({ steps: [] });
    });
    await client.getAgentDefinition("ag_1");
  });

  test("updateAgentDefinition sends PUT /agents/:id/definition", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PUT");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/definition");
      return jsonResponse({ steps: [] });
    });
    await client.updateAgentDefinition("ag_1", {} as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Runs
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent Runs", () => {
  test("runAgent sends POST /agents/:id/runs", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/runs");
      const body = JSON.parse(req.bodyText!);
      expect(body.input).toBe("hello");
      return jsonResponse({ id: "run_1", status: "pending" });
    });
    await client.runAgent("ag_1", { input: "hello" } as any);
  });

  test("listAgentRuns sends GET /agents/:id/runs with status filter", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/agents/ag_1/runs");
      expect(u.searchParams.get("status")).toBe("completed");
      return jsonResponse({ items: [] });
    });
    await client.listAgentRuns("ag_1", { status: "completed" });
  });

  test("searchAgentRuns sends POST /agents/runs/search", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/runs/search");
      return jsonResponse({ items: [] });
    });
    await client.searchAgentRuns({} as any);
  });

  test("getAgentRun includes step outputs via query param", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/agents/runs/run_1");
      expect(u.searchParams.get("include_step_outputs")).toBe("true");
      return jsonResponse({ id: "run_1", status: "completed" });
    });
    await client.getAgentRun("run_1", { includeStepOutputs: true });
  });

  test("deleteAgentRun is a deprecated alias that cancels", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/agents/runs/run_1");
      return jsonResponse({ id: "run_1", status: "cancelled" });
    });
    await client.deleteAgentRun("run_1");
  });

  test("cancelAgentRun sends DELETE /agents/runs/:id", async () => {
    // Cancellation is DELETE on the run resource. This test asserted
    // POST /agents/runs/:id/cancel, a path the API has never had, so it
    // confirmed a 404-ing method rather than catching it.
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/agents/runs/run_1");
      return jsonResponse({ id: "run_1", status: "cancelled" });
    });
    const run = await client.cancelAgentRun("run_1");
    expect((run as { status: string }).status).toBe("cancelled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Streaming
// ─────────────────────────────────────────────────────────────────────────────

describe("Streaming", () => {
  test("runStreamingAgentAndWait parses SSE and returns done payload", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/agents/ag_1/runs/stream");
      expect(req.headers["accept"]).toContain("text/event-stream");

      const sse = [
        ": keepalive\n\n",
        `event: init\ndata: ${JSON.stringify({ run_id: "run_1", status: "running" })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ run_id: "run_1", status: "completed", output: "ok" })}\n\n`,
      ];
      return makeSseResponse(sse, { signal: req.signal });
    });

    const result = await client.runStreamingAgentAndWait(
      "ag_1",
      { input: "hello", metadata: {} as any },
      { timeoutMs: 5_000 },
    );
    expect((result as any).status).toBe("completed");
    expect((result as any).output).toBe("ok");
  });

  test("runStreamingAgentAndWait times out", async () => {
    const client = makeClient((req) =>
      makeSseResponse([": keepalive\n\n", "event: init\ndata: {}\n\n"], { signal: req.signal }),
    );

    await expect(
      client.runStreamingAgentAndWait("ag_1", { input: "hello", metadata: {} as any }, { timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(SeclaiStreamingError);
  });

  test("runStreamingAgent yields events as async iterable", async () => {
    const client = makeClient((req) => {
      const sse = [
        `event: init\ndata: ${JSON.stringify({ run_id: "run_1", status: "running" })}\n\n`,
        `event: step\ndata: ${JSON.stringify({ step: 1 })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ run_id: "run_1", status: "completed" })}\n\n`,
      ];
      return makeSseResponse(sse, { signal: req.signal });
    });

    const events: { event: string; data: unknown }[] = [];
    for await (const event of client.runStreamingAgent("ag_1", { input: "hi" } as any, { timeoutMs: 5_000 })) {
      events.push(event);
    }

    expect(events.length).toBe(3);
    expect(events[0].event).toBe("init");
    expect(events[1].event).toBe("step");
    expect(events[2].event).toBe("done");
    expect((events[2].data as any).status).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Polling
// ─────────────────────────────────────────────────────────────────────────────

describe("Polling", () => {
  test("runAgentAndPoll polls until completed", async () => {
    let callCount = 0;
    const client = makeClient((req) => {
      callCount++;
      const u = new URL(req.url);
      if (req.method === "POST" && u.pathname.endsWith("/runs")) {
        return jsonResponse({ id: "run_1", status: "pending" });
      }
      // GET /agents/runs/run_1
      if (callCount <= 3) {
        return jsonResponse({ id: "run_1", status: "running" });
      }
      return jsonResponse({ id: "run_1", status: "completed", output: "done" });
    });

    const result = await client.runAgentAndPoll("ag_1", { input: "hi" } as any, {
      pollIntervalMs: 10,
      timeoutMs: 5_000,
    });
    expect((result as any).status).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Bases
// ─────────────────────────────────────────────────────────────────────────────

describe("Knowledge Bases", () => {
  test("listKnowledgeBases sends GET /knowledge_bases", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/knowledge_bases");
      return jsonResponse({ knowledge_bases: [], page: 1, limit: 20, total: 0 });
    });
    await client.listKnowledgeBases();
  });

  test("createKnowledgeBase sends POST /knowledge_bases", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/knowledge_bases");
      return jsonResponse({ id: "kb_1" }, 201);
    });
    await client.createKnowledgeBase({ name: "test" } as any);
  });

  test("getKnowledgeBase sends GET /knowledge_bases/:id", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/knowledge_bases/kb_1");
      return jsonResponse({ id: "kb_1" });
    });
    await client.getKnowledgeBase("kb_1");
  });

  test("updateKnowledgeBase sends PUT /knowledge_bases/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PUT");
      return jsonResponse({ id: "kb_1" });
    });
    await client.updateKnowledgeBase("kb_1", {} as any);
  });

  test("deleteKnowledgeBase sends DELETE /knowledge_bases/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    await client.deleteKnowledgeBase("kb_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory Banks
// ─────────────────────────────────────────────────────────────────────────────

describe("Memory Banks", () => {
  test("listMemoryBanks sends GET /memory_banks", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/memory_banks");
      return jsonResponse({ memory_banks: [], page: 1, limit: 20, total: 0 });
    });
    await client.listMemoryBanks();
  });

  test("createMemoryBank sends POST /memory_banks", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      return jsonResponse({ id: "mb_1" }, 201);
    });
    await client.createMemoryBank({ name: "test" } as any);
  });

  test("getMemoryBank sends GET /memory_banks/:id", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/memory_banks/mb_1");
      return jsonResponse({ id: "mb_1" });
    });
    await client.getMemoryBank("mb_1");
  });

  test("updateMemoryBank sends PUT /memory_banks/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PUT");
      return jsonResponse({ id: "mb_1" });
    });
    await client.updateMemoryBank("mb_1", {} as any);
  });

  test("deleteMemoryBank sends DELETE /memory_banks/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    await client.deleteMemoryBank("mb_1");
  });

  test("getMemoryBankStats sends GET /memory_banks/:id/stats", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/memory_banks/mb_1/stats");
      return jsonResponse({});
    });
    await client.getMemoryBankStats("mb_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────────

describe("Sources", () => {
  test("listSources sends GET /sources with query params", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/sources");
      expect(u.searchParams.get("page")).toBe("2");
      expect(u.searchParams.get("order")).toBe("asc");
      expect(u.searchParams.get("account_id")).toBe("acc_1");
      return jsonResponse({ items: [] });
    });
    await client.listSources({ page: 2, order: "asc", accountId: "acc_1" });
  });

  test("createSource sends POST /sources", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/sources");
      return jsonResponse({ id: "src_1" }, 201);
    });
    await client.createSource({ name: "test" } as any);
  });

  test("getSource sends GET /sources/:id", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/sources/src_1");
      return jsonResponse({ id: "src_1" });
    });
    await client.getSource("src_1");
  });

  test("updateSource sends PUT /sources/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PUT");
      return jsonResponse({ id: "src_1" });
    });
    await client.updateSource("src_1", {} as any);
  });

  test("deleteSource sends DELETE /sources/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    await client.deleteSource("src_1");
  });

  test("uploadFileToSource sends multipart form data", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/sources/src_1/upload");
      expect(req.method).toBe("POST");
      expect(req.headers["content-type"]).toBeUndefined();
      expect(req.body).toBeInstanceOf(FormData);

      const form = req.body as FormData;
      expect(form.get("title")).toBe("My title");
      expect(form.get("metadata")).toBe(JSON.stringify({ category: "docs" }));
      const file = form.get("file") as any;
      expect(file).toBeInstanceOf(Blob);
      expect(file.type).toBe("text/plain");
      if (typeof file?.name === "string") expect(file.name).toBe("hello.txt");

      return jsonResponse({ ok: true });
    });

    await client.uploadFileToSource("src_1", {
      file: new Uint8Array([104, 101, 108, 108, 111]),
      title: "My title",
      metadata: { category: "docs" },
      fileName: "hello.txt",
      mimeType: "text/plain",
    });
  });

  test("uploadFileToSource infers MIME type from fileName", async () => {
    const client = makeClient((req) => {
      const form = req.body as FormData;
      const file = form.get("file") as any;
      expect(file.type).toBe("application/pdf");
      return jsonResponse({ ok: true });
    });

    await client.uploadFileToSource("src_1", {
      file: new Uint8Array([1, 2, 3]),
      fileName: "document.pdf",
    });
  });

  test("uploadInlineTextToSource sends POST /sources/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/sources/src_1");
      return jsonResponse({ ok: true });
    });
    await client.uploadInlineTextToSource("src_1", { text: "hello" } as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source Exports
// ─────────────────────────────────────────────────────────────────────────────

describe("Source Exports", () => {
  test("listSourceExports sends GET /sources/:id/exports", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/sources/src_1/exports");
      return jsonResponse({ items: [] });
    });
    await client.listSourceExports("src_1");
  });

  test("createSourceExport sends POST /sources/:id/exports", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      return jsonResponse({ id: "exp_1" });
    });
    await client.createSourceExport("src_1", {} as any);
  });

  test("downloadSourceExport returns raw Response", async () => {
    const client = makeClient(() => new Response("binary-data", { status: 200 }));
    const resp = await client.downloadSourceExport("src_1", "exp_1");
    const text = await resp.text();
    expect(text).toBe("binary-data");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source Embedding Migrations
// ─────────────────────────────────────────────────────────────────────────────

describe("Source Embedding Migrations", () => {
  test("getSourceEmbeddingMigration sends GET", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/sources/src_1/embedding-migration");
      return jsonResponse({ status: "idle" });
    });
    await client.getSourceEmbeddingMigration("src_1");
  });

  test("startSourceEmbeddingMigration sends POST", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      return jsonResponse({ status: "running" });
    });
    await client.startSourceEmbeddingMigration("src_1", {} as any);
  });

  test("cancelSourceEmbeddingMigration sends POST /cancel", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/sources/src_1/embedding-migration/cancel");
      return jsonResponse({ status: "cancelled" });
    });
    await client.cancelSourceEmbeddingMigration("src_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Content
// ─────────────────────────────────────────────────────────────────────────────

describe("Content", () => {
  test("getContentDetail sends GET with range params", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/contents/cv_1");
      expect(u.searchParams.get("start")).toBe("100");
      expect(u.searchParams.get("end")).toBe("200");
      return jsonResponse({ text: "hello" });
    });
    await client.getContentDetail("cv_1", { start: 100, end: 200 });
  });

  test("deleteContent sends DELETE /contents/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    await client.deleteContent("cv_1");
  });

  test("listContentEmbeddings sends GET with pagination", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/contents/cv_1/embeddings");
      return jsonResponse({ items: [] });
    });
    await client.listContentEmbeddings("cv_1");
  });

  test("uploadFileToContent sends multipart", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/contents/cv_1/upload");
      expect(req.body).toBeInstanceOf(FormData);
      return jsonResponse({ ok: true });
    });
    await client.uploadFileToContent("cv_1", {
      file: new Uint8Array([1, 2, 3]),
      fileName: "update.pdf",
      mimeType: "application/pdf",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Solutions
// ─────────────────────────────────────────────────────────────────────────────

describe("Solutions", () => {
  test("listSolutions sends GET /solutions", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/solutions");
      return jsonResponse({ items: [] });
    });
    await client.listSolutions();
  });

  test("createSolution sends POST /solutions", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      return jsonResponse({ id: "sol_1" }, 201);
    });
    await client.createSolution({ name: "test" } as any);
  });

  test("getSolution sends GET /solutions/:id", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1");
      return jsonResponse({ id: "sol_1" });
    });
    await client.getSolution("sol_1");
  });

  test("updateSolution sends PATCH /solutions/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PATCH");
      return jsonResponse({ id: "sol_1" });
    });
    await client.updateSolution("sol_1", {} as any);
  });

  test("deleteSolution sends DELETE /solutions/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    await client.deleteSolution("sol_1");
  });

  test("linkAgentsToSolution sends POST /solutions/:id/agents", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/agents");
      return jsonResponse({ id: "sol_1" });
    });
    await client.linkAgentsToSolution("sol_1", { ids: ["ag_1"] } as any);
  });

  test("unlinkAgentsFromSolution sends DELETE /solutions/:id/agents", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/agents");
      return jsonResponse({ id: "sol_1" });
    });
    await client.unlinkAgentsFromSolution("sol_1", { ids: ["ag_1"] } as any);
  });

  test("linkKnowledgeBasesToSolution sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/knowledge-bases");
      return jsonResponse({ id: "sol_1" });
    });
    await client.linkKnowledgeBasesToSolution("sol_1", { ids: ["kb_1"] } as any);
  });

  test("linkSourceConnectionsToSolution sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/source-connections");
      return jsonResponse({ id: "sol_1" });
    });
    await client.linkSourceConnectionsToSolution("sol_1", { ids: ["src_1"] } as any);
  });

  test("listSolutionConversations sends GET", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/conversations");
      return jsonResponse([]);
    });
    await client.listSolutionConversations("sol_1");
  });

  test("generateSolutionAiPlan sends POST /solutions/:id/ai-assistant/generate", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/ai-assistant/generate");
      return jsonResponse({ actions: [] });
    });
    await client.generateSolutionAiPlan("sol_1", { user_input: "setup" } as any);
  });

  test("acceptSolutionAiPlan sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/ai-assistant/conv_1/accept");
      return jsonResponse({ actions: [] });
    });
    await client.acceptSolutionAiPlan("sol_1", "conv_1", {} as any);
  });

  test("declineSolutionAiPlan sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/ai-assistant/conv_1/decline");
      return new Response(null, { status: 204 });
    });
    await client.declineSolutionAiPlan("sol_1", "conv_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Governance
// ─────────────────────────────────────────────────────────────────────────────

describe("Governance", () => {
  test("generateGovernanceAiPlan sends POST /governance/ai-assistant", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/governance/ai-assistant");
      return jsonResponse({ actions: [] });
    });
    await client.generateGovernanceAiPlan({} as any);
  });

  test("listGovernanceAiConversations sends GET", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/governance/ai-assistant/conversations");
      return jsonResponse([]);
    });
    await client.listGovernanceAiConversations();
  });

  test("acceptGovernanceAiPlan sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/governance/ai-assistant/conv_1/accept");
      return jsonResponse({ actions: [] });
    });
    await client.acceptGovernanceAiPlan("conv_1");
  });

  test("declineGovernanceAiPlan sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/governance/ai-assistant/conv_1/decline");
      return new Response(null, { status: 204 });
    });
    await client.declineGovernanceAiPlan("conv_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Alerts
// ─────────────────────────────────────────────────────────────────────────────

describe("Alerts", () => {
  test("listAlerts sends GET /alerts with filters", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/alerts");
      expect(u.searchParams.get("status")).toBe("active");
      return jsonResponse({ items: [] });
    });
    await client.listAlerts({ status: "active" });
  });

  test("getAlert sends GET /alerts/:id", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/alerts/alert_1");
      return jsonResponse({ id: "alert_1" });
    });
    await client.getAlert("alert_1");
  });

  test("changeAlertStatus sends POST /alerts/:id/status", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/alerts/alert_1/status");
      return jsonResponse({ id: "alert_1" });
    });
    await client.changeAlertStatus("alert_1", {} as any);
  });

  test("listAlertConfigs sends GET /alerts/configs", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/alerts/configs");
      return jsonResponse({ configs: [], total: 0 });
    });
    await client.listAlertConfigs();
  });

  test("createAlertConfig sends POST /alerts/configs", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      return jsonResponse({ id: "cfg_1" });
    });
    await client.createAlertConfig({} as any);
  });

  test("updateAlertConfig sends PATCH /alerts/configs/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PATCH");
      expect(new URL(req.url).pathname).toBe("/alerts/configs/cfg_1");
      return jsonResponse({ id: "cfg_1" });
    });
    await client.updateAlertConfig("cfg_1", {} as any);
  });

  test("deleteAlertConfig sends DELETE /alerts/configs/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    await client.deleteAlertConfig("cfg_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Input Uploads
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent Input Uploads", () => {
  test("uploadAgentInput sends multipart to /agents/:id/upload-input", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/upload-input");
      expect(req.body).toBeInstanceOf(FormData);
      return jsonResponse({ upload_id: "upl_1", status: "processing" });
    });
    await client.uploadAgentInput("ag_1", {
      file: new Uint8Array([1, 2, 3]),
      fileName: "input.txt",
    });
  });

  test("getAgentInputUploadStatus sends GET", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/input-uploads/upl_1");
      return jsonResponse({ upload_id: "upl_1", status: "ready" });
    });
    await client.getAgentInputUploadStatus("ag_1", "upl_1");
  });

  test("getAgentAttachmentReferences sends GET /agents/:id/attachment-references", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/attachment-references");
      return jsonResponse({ requires_uploads: false });
    });
    const refs = await client.getAgentAttachmentReferences("ag_1");
    expect(refs.requires_uploads).toBe(false);
  });

  test("downloadAgentRunAttachment returns raw Response with download_name", async () => {
    const client = makeClient((req) => {
      const url = new URL(req.url);
      expect(req.method).toBe("GET");
      expect(url.pathname).toBe("/v2/agent-runs/run_1/attachments/att_1");
      expect(url.searchParams.get("download_name")).toBe("report.pdf");
      return new Response("file-bytes", { status: 200 });
    });
    const resp = await client.downloadAgentRunAttachment("run_1", "att_1", {
      downloadName: "report.pdf",
    });
    expect(await resp.text()).toBe("file-bytes");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent AI Assistant
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent AI Assistant", () => {
  test("generateAgentSteps sends POST /agents/:id/ai-assistant/generate-steps", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/ai-assistant/generate-steps");
      return jsonResponse({ steps: [] });
    });
    await client.generateAgentSteps("ag_1", {} as any);
  });

  test("generateStepConfig sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/ai-assistant/step-config");
      return jsonResponse({});
    });
    await client.generateStepConfig("ag_1", {} as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Evaluations
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent Evaluations", () => {
  test("listEvaluationCriteria sends GET /agents/:id/evaluation-criteria", async () => {
    // Asserting only the path let the 2026-07 change through: the endpoint
    // began returning a paginated envelope instead of a bare list, and this
    // test discarded the body, so it stayed green while callers broke.
    const client = makeClient((req) => {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/agents/ag_1/evaluation-criteria");
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("limit")).toBe("25");
      return jsonResponse({
        data: [{ id: "ec1" }],
        pagination: { page: 2, limit: 25, total: 7, pages: 1, has_next: false, has_prev: true },
      });
    });
    const result = await client.listEvaluationCriteria("ag_1", { page: 2, limit: 25 });
    expect(result).toEqual([{ id: "ec1" }]);
  });

  test("listEvaluationCriteria unwraps the canonical envelope", async () => {
    const client = makeClient(() =>
      jsonResponse({
        data: [{ id: "ec1" }],
        pagination: { page: 1, limit: 50, total: 1, pages: 1, has_next: false, has_prev: false },
      }),
    );
    expect(await client.listEvaluationCriteria("ag_1")).toEqual([{ id: "ec1" }]);
  });

  test("listEvaluationCriteria accepts a bare array too", async () => {
    // Both shapes are live realities: the envelope is merged on main but not
    // yet deployed, so decoding only one breaks the day the other ships.
    const client = makeClient(() => jsonResponse([{ id: "ec1" }]));
    expect(await client.listEvaluationCriteria("ag_1")).toEqual([{ id: "ec1" }]);
  });

  test("listEvaluationCriteriaPage exposes pagination metadata", async () => {
    // The canonical {data, pagination} envelope, which the endpoint only emits
    // once the caller opts in with apiVersion 2026-07-27 or later.
    const client = makeClient(() =>
      jsonResponse({
        data: [{ id: "ec1" }],
        pagination: { page: 2, limit: 25, total: 7, pages: 1, has_next: false, has_prev: true },
      }),
    );
    const page = await client.listEvaluationCriteriaPage("ag_1", { page: 2, limit: 25 });
    expect(page.data).toEqual([{ id: "ec1" }]);
    expect(page.pagination?.total).toBe(7);
  });

  test("createEvaluationCriteria sends POST", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/evaluation-criteria");
      return jsonResponse({ id: "crit_1" });
    });
    await client.createEvaluationCriteria("ag_1", {} as any);
  });

  test("getEvaluationCriteria sends GET /agents/evaluation-criteria/:id", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/evaluation-criteria/crit_1");
      return jsonResponse({ id: "crit_1" });
    });
    await client.getEvaluationCriteria("crit_1");
  });

  test("deleteEvaluationCriteria sends DELETE", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/agents/evaluation-criteria/crit_1");
      return new Response(null, { status: 204 });
    });
    await client.deleteEvaluationCriteria("crit_1");
  });

  test("testDraftEvaluation sends POST /agents/:id/evaluation-criteria/test-draft", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/evaluation-criteria/test-draft");
      return jsonResponse({});
    });
    await client.testDraftEvaluation("ag_1", {} as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────────────────────

describe("Models", () => {
  test("listModelAlerts sends GET /models/alerts", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/models/alerts");
      return jsonResponse({ alerts: [], total: 0 });
    });
    await client.listModelAlerts();
  });

  test("getModelRecommendations sends GET /models/:id/recommendations", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/models/m_1/recommendations");
      return jsonResponse({});
    });
    await client.getModelRecommendations("m_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

describe("Search", () => {
  test("search sends GET /search with query params", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      const u = new URL(req.url);
      expect(u.pathname).toBe("/search");
      expect(u.searchParams.get("q")).toBe("hello");
      expect(u.searchParams.get("limit")).toBe("5");
      expect(u.searchParams.get("entity_type")).toBe("agent");
      return jsonResponse({ results: [] });
    });
    await client.search({ query: "hello", limit: 5, entityType: "agent" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination Helper
// ─────────────────────────────────────────────────────────────────────────────

describe("Pagination Helper", () => {
  const pageOf = (page: number, pages: number, limit: number, total: number) => ({
    page,
    limit,
    total,
    pages,
    has_next: page < pages,
    has_prev: page > 1,
  });

  // Two full-envelope pages, as the server sends them, then nothing more.
  function twoPageClient(path: string, seen: string[]) {
    return makeClient((req) => {
      const url = new URL(req.url);
      expect(url.pathname).toBe(path);
      seen.push(url.search);
      const page = Number(url.searchParams.get("page"));
      return jsonResponse({
        data: page === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }],
        pagination: pageOf(page, 2, 2, 3),
      });
    });
  }

  test("paginate walks listSources and stops after the last page", async () => {
    const seen: string[] = [];
    const client = twoPageClient("/sources", seen);
    const ids: string[] = [];
    for await (const source of client.paginate((opts) => client.listSources(opts), { limit: 2 })) {
      ids.push(source.id);
    }
    expect(ids).toEqual(["a", "b", "c"]);
    expect(seen).toEqual(["?page=1&limit=2", "?page=2&limit=2"]);
  });

  test("paginate walks listAgents and stops after the last page", async () => {
    const seen: string[] = [];
    const client = twoPageClient("/agents", seen);
    const ids: string[] = [];
    for await (const agent of client.paginate((opts) => client.listAgents(opts), { limit: 2 })) {
      ids.push(agent.id);
    }
    expect(ids).toEqual(["a", "b", "c"]);
    expect(seen).toEqual(["?page=1&limit=2", "?page=2&limit=2"]);
  });

  // The four evaluation listings answer `{data, total, page, limit}` with no
  // `pagination` key unless the client opts into 2026-07-27.
  test.each([
    { total: 3, requests: 2, ids: ["p1a", "p1b", "p2a"] },
    { total: 4, requests: 2, ids: ["p1a", "p1b", "p2a", "p2b"] },
    { total: 2, requests: 1, ids: ["p1a", "p1b"] },
  ])("paginate walks a flat-shaped listing of $total", async ({ total, requests, ids }) => {
    const seen: string[] = [];
    const client = makeClient((req) => {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/agents/evaluation-criteria/c1/results");
      seen.push(url.search);
      const page = Number(url.searchParams.get("page"));
      const all = [`p${page}a`, `p${page}b`].map((id) => ({ id }));
      return jsonResponse({ data: all.slice(0, total - (page - 1) * 2), total, page, limit: 2 });
    });
    const got: string[] = [];
    for await (const result of client.paginate((opts) => client.listEvaluationResults("c1", opts), {
      limit: 2,
    })) {
      got.push(result.id);
    }
    expect(got).toEqual(ids);
    expect(seen).toHaveLength(requests);
  });

  test("paginate stops on a flat-shaped listing whose server ignores page", async () => {
    let calls = 0;
    const client = makeClient(() => {
      calls++;
      return jsonResponse({ data: [{ id: "a" }, { id: "b" }], total: 3, page: 1, limit: 2 });
    });
    const got: string[] = [];
    for await (const result of client.paginate((opts) => client.listEvaluationResults("c1", opts), {
      limit: 2,
    })) {
      got.push(result.id);
    }
    expect(calls).toBe(2);
  });

  test("paginate makes one request for a single full page", async () => {
    let requests = 0;
    const client = makeClient(() => {
      requests += 1;
      return jsonResponse({ data: [{ id: "a" }, { id: "b" }], pagination: pageOf(1, 1, 2, 2) });
    });
    const ids: string[] = [];
    for await (const source of client.paginate((opts) => client.listSources(opts), { limit: 2 })) {
      ids.push(source.id);
    }
    expect(ids).toEqual(["a", "b"]);
    expect(requests).toBe(1);
  });

  test("paginate follows pages when has_next is absent", async () => {
    const client = makeClient(() => jsonResponse({}));
    let fetched = 0;
    const items: string[] = [];
    for await (const item of client.paginate(
      async ({ page }) => {
        fetched += 1;
        return { data: page === 1 ? ["a", "b"] : ["c"], pagination: { pages: 2 } };
      },
      { limit: 2 },
    )) {
      items.push(item);
    }
    expect(items).toEqual(["a", "b", "c"]);
    expect(fetched).toBe(2);
  });

  test("paginate yields a bare array once", async () => {
    let requests = 0;
    const client = makeClient(() => {
      requests += 1;
      return jsonResponse([{ id: "p1" }, { id: "p2" }]);
    });
    const ids: string[] = [];
    for await (const drive of client.paginate(() => client.listCloudDrives(), { limit: 2 })) {
      ids.push(drive.id);
    }
    expect(ids).toEqual(["p1", "p2"]);
    expect(requests).toBe(1);
  });

  test("paginate still accepts a custom fetcher's items and total_pages", async () => {
    let pagesFetched = 0;
    const client = makeClient(() => jsonResponse({}));

    const allItems: string[] = [];
    for await (const item of client.paginate(
      async (opts) => {
        pagesFetched++;
        if (opts.page === 1) {
          return { items: ["a", "b"], pagination: { page: 1, total_pages: 2 } };
        }
        return { items: ["c"], pagination: { page: 2, total_pages: 2 } };
      },
      { limit: 2 },
    )) {
      allItems.push(item);
    }

    expect(allItems).toEqual(["a", "b", "c"]);
    expect(pagesFetched).toBe(2);
  });

  test("paginate treats a null data as an empty page", async () => {
    const client = makeClient(() => jsonResponse({}));
    const items: unknown[] = [];
    for await (const item of client.paginate(async () => ({ data: null }))) items.push(item);
    expect(items).toEqual([]);
  });

  test("paginate throws SeclaiError on a page with no items key", async () => {
    const client = makeClient(() => jsonResponse({ configs: [{ id: "c1" }], total: 1 }));
    const run = async () => {
      // The legacy `configs` shape is not one paginate() reads; the cast stands
      // in for a caller whose fetcher is typed more loosely than it behaves.
      for await (const _ of client.paginate<unknown>(
        async (opts) => (await client.listAlertConfigs(opts)) as { data?: unknown[] },
      )) {
        void _;
      }
    };
    await expect(run()).rejects.toThrow(SeclaiError);
    await expect(run()).rejects.not.toThrow(TypeError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Raw Request
// ─────────────────────────────────────────────────────────────────────────────

describe("Raw Requests", () => {
  test("request sends JSON body and content-type", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(req.headers["content-type"]).toContain("application/json");
      expect(req.bodyText).toBe(JSON.stringify({ hello: "world" }));
      return jsonResponse({ ok: true });
    });
    await client.request("POST", "/test", { json: { hello: "world" } });
  });

  test("requestRaw returns raw Response", async () => {
    const client = makeClient(() => new Response("raw-data", { status: 200 }));
    const resp = await client.requestRaw("GET", "/download");
    expect(await resp.text()).toBe("raw-data");
  });

  test("requestRaw throws on error status", async () => {
    const client = makeClient(() => new Response("error", { status: 500 }));
    await expect(client.requestRaw("GET", "/fail")).rejects.toBeInstanceOf(SeclaiAPIStatusError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AbortSignal Support
// ─────────────────────────────────────────────────────────────────────────────

describe("AbortSignal Support", () => {
  test("request passes signal to fetch", async () => {
    const controller = new AbortController();
    const client = new Seclai({
      apiKey: "test-key",
      baseUrl: "https://test.invalid",
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBe(controller.signal);
        return jsonResponse({ ok: true });
      },
    });
    await client.request("GET", "/test", { signal: controller.signal });
  });

  test("requestRaw passes signal to fetch", async () => {
    const controller = new AbortController();
    const client = new Seclai({
      apiKey: "test-key",
      baseUrl: "https://test.invalid",
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBe(controller.signal);
        return new Response("ok");
      },
    });
    await client.requestRaw("GET", "/test", { signal: controller.signal });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source Exports (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe("Source Exports — extended", () => {
  test("deleteSourceExport sends DELETE /sources/:id/exports/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/sources/src_1/exports/exp_1");
      return new Response(null, { status: 204 });
    });
    await client.deleteSourceExport("src_1", "exp_1");
  });

  test("getSourceExport sends GET /sources/:id/exports/:id", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/sources/src_1/exports/exp_1");
      return jsonResponse({ id: "exp_1", status: "completed" });
    });
    await client.getSourceExport("src_1", "exp_1");
  });

  test("estimateSourceExport sends POST /sources/:id/exports/estimate", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/sources/src_1/exports/estimate");
      return jsonResponse({ size: 1024 });
    });
    await client.estimateSourceExport("src_1", {} as any);
  });

  test("cancelSourceExport sends POST /sources/:id/exports/:id/cancel", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/sources/src_1/exports/exp_1/cancel");
      return jsonResponse({ id: "exp_1" });
    });
    await client.cancelSourceExport("src_1", "exp_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory Banks (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe("Memory Banks — extended", () => {
  test("getAgentsUsingMemoryBank sends GET /memory_banks/:id/agents", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/memory_banks/mb_1/agents");
      return jsonResponse([]);
    });
    await client.getAgentsUsingMemoryBank("mb_1");
  });

  test("compactMemoryBank sends POST /memory_banks/:id/compact", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/memory_banks/mb_1/compact");
      return new Response(null, { status: 204 });
    });
    await client.compactMemoryBank("mb_1");
  });

  test("deleteMemoryBankSource sends DELETE /memory_banks/:id/source", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/memory_banks/mb_1/source");
      return new Response(null, { status: 204 });
    });
    await client.deleteMemoryBankSource("mb_1");
  });

  test("testMemoryBankCompaction sends POST /memory_banks/:id/test-compaction", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/memory_banks/mb_1/test-compaction");
      return jsonResponse({ evaluation: {} });
    });
    await client.testMemoryBankCompaction("mb_1", {} as any);
  });

  test("testCompactionPromptStandalone sends POST /memory_banks/test-compaction", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/memory_banks/test-compaction");
      return jsonResponse({ evaluation: {} });
    });
    await client.testCompactionPromptStandalone({} as any);
  });

  test("listMemoryBankTemplates sends GET /memory_banks/templates", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/memory_banks/templates");
      return jsonResponse([]);
    });
    await client.listMemoryBankTemplates();
  });

  test("generateMemoryBankConfig sends POST /memory_banks/ai-assistant", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/memory_banks/ai-assistant");
      return jsonResponse({});
    });
    await client.generateMemoryBankConfig({} as any);
  });

  test("getMemoryBankAiLastConversation sends GET", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/memory_banks/ai-assistant/last-conversation");
      return jsonResponse({});
    });
    await client.getMemoryBankAiLastConversation();
  });

  test("acceptMemoryBankAiSuggestion sends PATCH", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PATCH");
      expect(new URL(req.url).pathname).toBe("/memory_banks/ai-assistant/conv_1");
      return jsonResponse({});
    });
    await client.acceptMemoryBankAiSuggestion("conv_1", {} as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Alerts (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe("Alerts — extended", () => {
  test("addAlertComment sends POST /alerts/:id/comments", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/alerts/alert_1/comments");
      return jsonResponse({});
    });
    await client.addAlertComment("alert_1", {} as any);
  });

  test("subscribeToAlert sends POST /alerts/:id/subscribe", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/alerts/alert_1/subscribe");
      return jsonResponse({});
    });
    await client.subscribeToAlert("alert_1");
  });

  test("unsubscribeFromAlert sends POST /alerts/:id/unsubscribe", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/alerts/alert_1/unsubscribe");
      return jsonResponse({});
    });
    await client.unsubscribeFromAlert("alert_1");
  });

  test("getAlertConfig sends GET /alerts/configs/:id", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/alerts/configs/cfg_1");
      return jsonResponse({ id: "cfg_1" });
    });
    await client.getAlertConfig("cfg_1");
  });

  test("listOrganizationAlertPreferences sends GET", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/alerts/organization-preferences/list");
      return jsonResponse({ preferences: [], total: 0 });
    });
    await client.listOrganizationAlertPreferences();
  });

  test("updateOrganizationAlertPreference sends PATCH and returns the typed preference", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PATCH");
      expect(new URL(req.url).pathname).toBe("/alerts/organization-preferences/org_1/model_alert");
      return jsonResponse({
        organization_id: "org_1",
        alert_type: "model_alert",
        subscribed: true,
        is_override: false,
      });
    });
    const pref = await client.updateOrganizationAlertPreference("org_1", "model_alert", {} as any);
    // Typed fields are reachable without a cast.
    expect(pref.subscribed).toBe(true);
    expect(pref.alert_type).toBe("model_alert");
    expect(pref.is_override).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Models (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe("Models — extended", () => {
  test("markAllModelAlertsRead sends POST /models/alerts/mark-all-read", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/models/alerts/mark-all-read");
      return new Response(null, { status: 204 });
    });
    await client.markAllModelAlertsRead();
  });

  test("markModelAlertRead sends PATCH /models/alerts/:id/read", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PATCH");
      expect(new URL(req.url).pathname).toBe("/models/alerts/alert_1/read");
      return new Response(null, { status: 204 });
    });
    await client.markModelAlertRead("alert_1");
  });

  test("getUnreadModelAlertCount sends GET", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/models/alerts/unread-count");
      return jsonResponse({ count: 3 });
    });
    await client.getUnreadModelAlertCount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Evaluations (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent Evaluations — extended", () => {
  test("updateEvaluationCriteria sends PATCH", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PATCH");
      expect(new URL(req.url).pathname).toBe("/agents/evaluation-criteria/crit_1");
      return jsonResponse({ id: "crit_1" });
    });
    await client.updateEvaluationCriteria("crit_1", {} as any);
  });

  test("getEvaluationCriteriaSummary sends GET /agents/evaluation-criteria/:id/summary", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      expect(new URL(req.url).pathname).toBe("/agents/evaluation-criteria/crit_1/summary");
      return jsonResponse({});
    });
    await client.getEvaluationCriteriaSummary("crit_1");
  });

  test("listEvaluationResults sends GET /agents/evaluation-criteria/:id/results", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/evaluation-criteria/crit_1/results");
      return jsonResponse({ data: [], total: 0, page: 1, limit: 20 });
    });
    await client.listEvaluationResults("crit_1");
  });

  test("createEvaluationResult sends POST /agents/evaluation-criteria/:id/results", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/evaluation-criteria/crit_1/results");
      return jsonResponse({ id: "res_1" });
    });
    await client.createEvaluationResult("crit_1", {} as any);
  });

  test("listEvaluationResults with pagination sends GET with query params", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/agents/evaluation-criteria/crit_1/results");
      expect(u.searchParams.get("page")).toBe("2");
      expect(u.searchParams.get("limit")).toBe("10");
      return jsonResponse({ data: [], total: 0, page: 2, limit: 10 });
    });
    await client.listEvaluationResults("crit_1", { page: 2, limit: 10 });
  });

  test("listCompatibleRuns sends GET /agents/evaluation-criteria/:id/compatible-runs", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/evaluation-criteria/crit_1/compatible-runs");
      return jsonResponse({ data: [], total: 0, page: 1, limit: 20 });
    });
    await client.listCompatibleRuns("crit_1");
  });

  test("listRunEvaluationResults sends GET /agents/:agentId/runs/:runId/evaluation-results", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/runs/run_1/evaluation-results");
      return jsonResponse([]);
    });
    await client.listRunEvaluationResults("ag_1", "run_1");
  });

  test("getNonManualEvaluationSummary sends GET with agent_id query", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/agents/evaluation-results/non-manual-summary");
      expect(u.searchParams.get("agent_id")).toBe("ag_1");
      return jsonResponse({ by_mode: [] });
    });
    await client.getNonManualEvaluationSummary("ag_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Content (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe("Content — extended", () => {
  test("replaceContentWithInlineText sends PUT /contents/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PUT");
      expect(new URL(req.url).pathname).toBe("/contents/cv_1");
      return jsonResponse({ id: "cv_1" });
    });
    await client.replaceContentWithInlineText("cv_1", {} as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Solutions (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe("Solutions — extended", () => {
  test("unlinkKnowledgeBasesFromSolution sends DELETE", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/knowledge-bases");
      return jsonResponse({ id: "sol_1" });
    });
    await client.unlinkKnowledgeBasesFromSolution("sol_1", { ids: ["kb_1"] } as any);
  });

  test("unlinkSourceConnectionsFromSolution sends DELETE", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/source-connections");
      return jsonResponse({ id: "sol_1" });
    });
    await client.unlinkSourceConnectionsFromSolution("sol_1", { ids: ["src_1"] } as any);
  });

  test("addSolutionConversationTurn sends POST /solutions/:id/conversations", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/conversations");
      return jsonResponse({});
    });
    await client.addSolutionConversationTurn("sol_1", {} as any);
  });

  test("markSolutionConversationTurn sends PATCH", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PATCH");
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/conversations/conv_1");
      return jsonResponse({});
    });
    await client.markSolutionConversationTurn("sol_1", "conv_1", {} as any);
  });

  test("generateSolutionAiKnowledgeBase sends POST", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/ai-assistant/knowledge-base");
      return jsonResponse({});
    });
    await client.generateSolutionAiKnowledgeBase("sol_1", {} as any);
  });

  test("generateSolutionAiSource sends POST", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/solutions/sol_1/ai-assistant/source");
      return jsonResponse({});
    });
    await client.generateSolutionAiSource("sol_1", {} as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Top-Level AI Assistant
// ─────────────────────────────────────────────────────────────────────────────

describe("Top-Level AI Assistant", () => {
  test("submitAiFeedback sends POST /ai-assistant/feedback", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/ai-assistant/feedback");
      return jsonResponse({});
    });
    await client.submitAiFeedback({} as any);
  });

  test("aiAssistantKnowledgeBase sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/ai-assistant/knowledge-base");
      return jsonResponse({});
    });
    await client.aiAssistantKnowledgeBase({} as any);
  });

  test("aiAssistantSource sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/ai-assistant/source");
      return jsonResponse({});
    });
    await client.aiAssistantSource({} as any);
  });

  test("aiAssistantSolution sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/ai-assistant/solution");
      return jsonResponse({});
    });
    await client.aiAssistantSolution({} as any);
  });

  test("aiAssistantMemoryBank sends POST", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/ai-assistant/memory-bank");
      return jsonResponse({});
    });
    await client.aiAssistantMemoryBank({} as any);
  });

  test("getAiAssistantMemoryBankHistory sends GET", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/ai-assistant/memory-bank/last-conversation");
      return jsonResponse({});
    });
    await client.getAiAssistantMemoryBankHistory();
  });

  test("acceptAiAssistantPlan sends POST with JSON body", async () => {
    const requestBody = { confirm_deletions: true };
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/ai-assistant/conv_1/accept");
      expect(req.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(req.bodyText!)).toEqual(requestBody);
      return jsonResponse({});
    });
    await client.acceptAiAssistantPlan("conv_1", requestBody as any);
  });

  test("declineAiAssistantPlan sends POST", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/ai-assistant/conv_1/decline");
      return new Response(null, { status: 204 });
    });
    await client.declineAiAssistantPlan("conv_1");
  });

  test("acceptAiMemoryBankSuggestion sends PATCH with body", async () => {
    const requestBody = { accepted: true };
    const client = makeClient((req) => {
      expect(req.method).toBe("PATCH");
      expect(new URL(req.url).pathname).toBe("/ai-assistant/memory-bank/conv_1");
      expect(req.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(req.bodyText!)).toEqual(requestBody);
      return jsonResponse({});
    });
    await client.acceptAiMemoryBankSuggestion("conv_1", requestBody as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent AI Assistant (extended)
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent AI Assistant — extended", () => {
  test("getAgentAiConversationHistory sends GET with the required step_type", async () => {
    const client = makeClient((req) => {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/agents/ag_1/ai-assistant/conversations");
      // Asserting only the path is what let this method ship unable to send the
      // parameter the API requires.
      expect(url.searchParams.get("step_type")).toBe("llm");
      return jsonResponse([]);
    });
    await client.getAgentAiConversationHistory("ag_1", { stepType: "llm" });
  });

  test("getAgentAiConversationHistory rejects a call without stepType", async () => {
    const client = makeClient(() => jsonResponse([]));
    await expect(client.getAgentAiConversationHistory("ag_1")).rejects.toThrow(
      /stepType/,
    );
  });

  test("markAgentAiSuggestion sends PATCH", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PATCH");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/ai-assistant/conv_1");
      return new Response(null, { status: 204 });
    });
    await client.markAgentAiSuggestion("ag_1", "conv_1", {} as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bearer Token Auth
// ─────────────────────────────────────────────────────────────────────────────

describe("Bearer Token Auth", () => {
  test("static accessToken sends Authorization Bearer header", async () => {
    const client = new Seclai({
      accessToken: "my-jwt-token",
      baseUrl: "https://test.invalid",
      fetch: makeFetch((req) => {
        expect(req.headers["authorization"]).toBe("Bearer my-jwt-token");
        expect(req.headers["x-api-key"]).toBeUndefined();
        return jsonResponse({ ok: true });
      }),
    });
    await client.request("GET", "/test");
  });

  test("accessToken function provider is called per request", async () => {
    let callCount = 0;
    const provider = () => {
      callCount++;
      return `token-${callCount}`;
    };
    const client = new Seclai({
      accessToken: provider,
      baseUrl: "https://test.invalid",
      fetch: makeFetch((req) => {
        expect(req.headers["authorization"]).toMatch(/^Bearer token-\d+$/);
        return jsonResponse({ ok: true });
      }),
    });

    await client.request("GET", "/test1");
    await client.request("GET", "/test2");
    expect(callCount).toBe(2);
  });

  test("async accessToken provider is supported", async () => {
    const provider = async () => {
      await new Promise((r) => setTimeout(r, 1));
      return "async-token";
    };
    const client = new Seclai({
      accessToken: provider,
      baseUrl: "https://test.invalid",
      fetch: makeFetch((req) => {
        expect(req.headers["authorization"]).toBe("Bearer async-token");
        return jsonResponse({ ok: true });
      }),
    });
    await client.request("GET", "/test");
  });

  test("accountId sends X-Account-Id header", async () => {
    const client = new Seclai({
      accessToken: "tok",
      accountId: "550e8400-e29b-41d4-a716-446655440000",
      baseUrl: "https://test.invalid",
      fetch: makeFetch((req) => {
        expect(req.headers["x-account-id"]).toBe("550e8400-e29b-41d4-a716-446655440000");
        expect(req.headers["authorization"]).toBe("Bearer tok");
        return jsonResponse({ ok: true });
      }),
    });
    await client.request("GET", "/test");
  });

  test("accountId also works with apiKey auth", async () => {
    const client = new Seclai({
      apiKey: "k",
      accountId: "acct-123",
      baseUrl: "https://test.invalid",
      fetch: makeFetch((req) => {
        expect(req.headers["x-account-id"]).toBe("acct-123");
        expect(req.headers["x-api-key"]).toBe("k");
        return jsonResponse({ ok: true });
      }),
    });
    await client.request("GET", "/test");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INI Parser
// ─────────────────────────────────────────────────────────────────────────────

describe("INI Parser", () => {
  test("parses default and profile sections", () => {
    const ini = `
[default]
sso_account_id = acct-default
sso_region = us-east-1
sso_client_id = client123
sso_domain = auth.seclai.com

# Comment line
[profile staging]
sso_account_id = acct-staging
`;
    const result = parseIni(ini);
    expect(result["default"]).toEqual({
      sso_account_id: "acct-default",
      sso_region: "us-east-1",
      sso_client_id: "client123",
      sso_domain: "auth.seclai.com",
    });
    expect(result["staging"]).toEqual({
      sso_account_id: "acct-staging",
    });
  });

  test("ignores comment and empty lines", () => {
    const ini = `
; semicolon comment
# hash comment

[default]
key = value
`;
    const result = parseIni(ini);
    expect(result["default"]).toEqual({ key: "value" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Model Playground Experiments
// ─────────────────────────────────────────────────────────────────────────────

describe("Model Playground Experiments", () => {
  test("deleteExperiment sends DELETE /models/playground/experiments/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/models/playground/experiments/exp_1");
      return new Response(null, { status: 204 });
    });
    await client.deleteExperiment("exp_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

describe("Identity", () => {
  test("getMe sends GET /me", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      expect(new URL(req.url).pathname).toBe("/me");
      return jsonResponse({
        account_id: "acct_personal",
        organizations: [{ id: "org_1", name: "Acme", account_id: "acct_acme" }],
      });
    });
    const me = await client.getMe();
    expect(me.account_id).toBe("acct_personal");
    expect(me.organizations[0].name).toBe("Acme");
  });

  test("getMe sends X-Account-Id when the client targets an org", async () => {
    const client = new Seclai({
      apiKey: "test-key",
      baseUrl: "https://api.test",
      accountId: "acct_acme",
      fetch: makeFetch((req) => {
        expect(req.headers["x-account-id"]).toBe("acct_acme");
        return jsonResponse({ account_id: "acct_acme", organizations: [] });
      }),
    });
    await client.getMe();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agents — Enable / Disable
// ─────────────────────────────────────────────────────────────────────────────

describe("Agents — Enable / Disable", () => {
  test("disableAgent sends POST /agents/:id/disable", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/disable");
      return jsonResponse({ id: "ag_1", disabled: true });
    });
    const agent = await client.disableAgent("ag_1");
    expect(agent.disabled).toBe(true);
  });

  test("enableAgent sends POST /agents/:id/enable", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/enable");
      return jsonResponse({ id: "ag_1", disabled: false });
    });
    const agent = await client.enableAgent("ag_1");
    expect(agent.disabled).toBe(false);
  });

  test("getAgentCallers sends GET /agents/:id/callers", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/callers");
      return jsonResponse([{ id: "ag_2", name: "Caller", disabled: false }]);
    });
    const callers = await client.getAgentCallers("ag_1");
    expect(callers).toHaveLength(1);
    expect(callers[0].name).toBe("Caller");
  });

  test("disableAgent surfaces a 409 as SeclaiAPIStatusError", async () => {
    const client = makeClient(() => jsonResponse({ detail: "blocked by callers" }, 409));
    await expect(client.disableAgent("ag_1")).rejects.toThrow(SeclaiAPIStatusError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Email Triggers
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent Email Triggers", () => {
  test("setEmailTriggerConfig sends PUT /agents/:id/triggers/:tid/email-config", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PUT");
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/triggers/tr_1/email-config");
      const body = JSON.parse(req.bodyText!);
      expect(body.alias).toBe("support");
      expect(body.allowed_senders).toEqual(["example.com"]);
      expect(body.require_sender_auth).toBe(false);
      return jsonResponse({
        trigger_id: "tr_1",
        agent_id: "ag_1",
        trigger_type: "EMAIL_RECEIVED",
        email_addresses: ["support.acct@agent.seclai.com"],
      });
    });
    const config = await client.setEmailTriggerConfig("ag_1", "tr_1", {
      alias: "support",
      allowed_senders: ["example.com"],
      require_sender_auth: false,
    });
    expect(config.email_addresses).toEqual(["support.acct@agent.seclai.com"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Email Governance
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent Email Governance", () => {
  test("listAgentEmailOptOuts sends GET with agent_id/limit/offset", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/agents/agent-email-optouts");
      expect(u.searchParams.get("agent_id")).toBe("ag_1");
      expect(u.searchParams.get("limit")).toBe("25");
      expect(u.searchParams.get("offset")).toBe("50");
      return jsonResponse({ items: [], total: 0 });
    });
    await client.listAgentEmailOptOuts({ agentId: "ag_1", limit: 25, offset: 50 });
  });

  test("listAgentEmailOptOuts omits unset filters", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.searchParams.has("agent_id")).toBe(false);
      expect(u.searchParams.has("limit")).toBe(false);
      return jsonResponse({ items: [], total: 0 });
    });
    await client.listAgentEmailOptOuts();
  });

  test("removeAgentEmailOptOut sends DELETE /agents/agent-email-optouts/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/agents/agent-email-optouts/oo_1");
      return new Response(null, { status: 204 });
    });
    await client.removeAgentEmailOptOut("oo_1");
  });

  test("listBlockedEmailSenders sends GET with limit/offset", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/agents/blocked-email-senders");
      expect(u.searchParams.get("limit")).toBe("10");
      expect(u.searchParams.get("offset")).toBe("0");
      return jsonResponse({ items: [], total: 0, auto_block_mode: "disabled" });
    });
    const result = await client.listBlockedEmailSenders({ limit: 10, offset: 0 });
    expect(result.auto_block_mode).toBe("disabled");
  });

  test("blockEmailSender sends POST /agents/blocked-email-senders", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/blocked-email-senders");
      const body = JSON.parse(req.bodyText!);
      expect(body.sender_email).toBe("spam@example.com");
      expect(body.match_type).toBe("domain");
      return jsonResponse({
        id: "bl_1",
        created_at: "2026-07-01T00:00:00Z",
        sender_email: "spam@example.com",
        match_type: "domain",
        source: "manual",
        note: null,
      }, 201);
    });
    const blocked = await client.blockEmailSender({
      sender_email: "spam@example.com",
      match_type: "domain",
    });
    expect(blocked.id).toBe("bl_1");
  });

  test("unblockEmailSender sends DELETE /agents/blocked-email-senders/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/agents/blocked-email-senders/bl_1");
      return new Response(null, { status: 204 });
    });
    await client.unblockEmailSender("bl_1");
  });

  test("setAutoBlockMode sends PUT /agents/blocked-email-senders/mode", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PUT");
      expect(new URL(req.url).pathname).toBe("/agents/blocked-email-senders/mode");
      expect(JSON.parse(req.bodyText!).mode).toBe("input_and_output");
      return jsonResponse({ items: [], total: 0, auto_block_mode: "input_and_output" });
    });
    const result = await client.setAutoBlockMode({ mode: "input_and_output" });
    expect(result.auto_block_mode).toBe("input_and_output");
  });

  test("listInboundEmailRejections sends GET with agent_id/limit", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/agents/inbound-email-rejections");
      expect(u.searchParams.get("agent_id")).toBe("ag_1");
      expect(u.searchParams.get("limit")).toBe("5");
      return jsonResponse([{ id: "rj_1", reason: "unauthorized_sender" }]);
    });
    const rejections = await client.listInboundEmailRejections({ agentId: "ag_1", limit: 5 });
    expect(rejections).toHaveLength(1);
  });

  test("getInboundEmailStatus sends GET /agents/inbound-email-status", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/inbound-email-status");
      return jsonResponse({ paused: true, queued_backlog: 42 });
    });
    const status = await client.getInboundEmailStatus();
    expect(status.paused).toBe(true);
    expect(status.queued_backlog).toBe(42);
  });

  test("cancelQueuedEmailRuns sends POST .../cancel-queued", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/inbound-email-status/cancel-queued");
      return jsonResponse({ cancelled: 7 });
    });
    const result = await client.cancelQueuedEmailRuns();
    expect(result.cancelled).toBe(7);
  });

  test("resumeInboundEmail sends POST .../resume", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/inbound-email-status/resume");
      return jsonResponse({ resumed: true });
    });
    const result = await client.resumeInboundEmail();
    expect(result.resumed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Email Domains
// ─────────────────────────────────────────────────────────────────────────────

describe("Email Domains", () => {
  test("listEmailDomains sends GET /email-domains", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      expect(new URL(req.url).pathname).toBe("/email-domains");
      return jsonResponse({ domains: [], can_add_vanity: true, has_vanity: false });
    });
    const result = await client.listEmailDomains();
    expect(result.can_add_vanity).toBe(true);
  });

  test("addEmailDomain sends POST /email-domains", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/email-domains");
      const body = JSON.parse(req.bodyText!);
      expect(body.kind).toBe("custom");
      expect(body.value).toBe("agent.example.com");
      expect(body.delegated).toBe(true);
      return jsonResponse({
        id: "dom_1",
        domain: "agent.example.com",
        kind: "custom",
        status: "pending",
        is_primary: false,
      });
    });
    const domain = await client.addEmailDomain({
      kind: "custom",
      value: "agent.example.com",
      delegated: true,
    });
    expect(domain.id).toBe("dom_1");
  });

  test("addEmailDomain accepts a vanity domain without `delegated`", async () => {
    const client = makeClient((req) => {
      const body = JSON.parse(req.bodyText!);
      expect(body).toEqual({ kind: "vanity", value: "acme" });
      expect("delegated" in body).toBe(false);
      return jsonResponse({
        id: "dom_2", domain: "acme.seclai.com", kind: "vanity",
        status: "pending", is_primary: false,
      });
    });
    // Compiles without `delegated` — the server defaults it to false.
    const domain = await client.addEmailDomain({ kind: "vanity", value: "acme" });
    expect(domain.kind).toBe("vanity");
  });

  test("removeEmailDomain sends DELETE /email-domains/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/email-domains/dom_1");
      return jsonResponse({ removed: true, cleanup_note: "Delete the NS record" });
    });
    const result = await client.removeEmailDomain("dom_1");
    expect(result.cleanup_note).toBe("Delete the NS record");
  });

  test("verifyEmailDomain sends POST /email-domains/:id/verify", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/email-domains/dom_1/verify");
      return jsonResponse({
        id: "dom_1", domain: "agent.example.com", kind: "custom",
        status: "verified", is_primary: false, verified: true,
      });
    });
    const domain = await client.verifyEmailDomain("dom_1");
    expect(domain.verified).toBe(true);
  });

  test("setPrimaryEmailDomain sends POST /email-domains/:id/primary", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/email-domains/dom_1/primary");
      return jsonResponse({
        id: "dom_1", domain: "agent.example.com", kind: "custom",
        status: "verified", is_primary: true,
      });
    });
    const domain = await client.setPrimaryEmailDomain("dom_1");
    expect(domain.is_primary).toBe(true);
  });

  test("useSharedEmailDomain sends POST /email-domains/use-shared-domain", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/email-domains/use-shared-domain");
      return new Response(null, { status: 204 });
    });
    await client.useSharedEmailDomain();
  });

  test("sendEmailDomainTestEmail sends POST /email-domains/:id/test-email", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/email-domains/dom_1/test-email");
      return jsonResponse({ sent: true });
    });
    const result = await client.sendEmailDomainTestEmail("dom_1");
    expect(result.sent).toBe(true);
  });

  test("getDmarcSummary sends GET /email-domains/:id/dmarc with window params", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/email-domains/dom_1/dmarc");
      expect(u.searchParams.get("days")).toBe("7");
      expect(u.searchParams.get("top_sources")).toBe("3");
      return jsonResponse({
        window_days: 7, report_count: 2, total_messages: 100,
        passed_messages: 99, failed_messages: 1, top_failing_sources: [],
      });
    });
    const summary = await client.getDmarcSummary("dom_1", { days: 7, topSources: 3 });
    expect(summary.window_days).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Models — media filters & generation tiers
// ─────────────────────────────────────────────────────────────────────────────

describe("Models — media filters & generation tiers", () => {
  test("listModels forwards the media capability filters", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/models");
      expect(u.searchParams.get("supports_input_media")).toBe("pdf");
      expect(u.searchParams.get("supports_output_media")).toBe("image");
      expect(u.searchParams.get("supports_tool_use")).toBe("true");
      return jsonResponse([]);
    });
    await client.listModels({
      supportsInputMedia: "pdf",
      supportsOutputMedia: "image",
      supportsToolUse: true,
    });
  });

  test("getGenerationTiers sends GET /models/generation-tiers", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      expect(new URL(req.url).pathname).toBe("/models/generation-tiers");
      return jsonResponse({ tiers: [{ modality: "image", tier: "fast", model: "m_1" }] });
    });
    const tiers = await client.getGenerationTiers() as Record<string, unknown>;
    expect(tiers["tiers"]).toEqual([{ modality: "image", tier: "fast", model: "m_1" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Docs Search
// ─────────────────────────────────────────────────────────────────────────────

describe("Docs Search", () => {
  test("searchDocs sends GET /docs-search with query params", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      const u = new URL(req.url);
      expect(u.pathname).toBe("/docs-search");
      expect(u.searchParams.get("q")).toBe("agent triggers");
      expect(u.searchParams.get("mode")).toBe("semantic");
      expect(u.searchParams.get("limit")).toBe("3");
      return jsonResponse({ results: [] });
    });
    await client.searchDocs({ query: "agent triggers", mode: "semantic", limit: 3 });
  });

  test("searchDocs omits mode and limit when unset", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.searchParams.get("q")).toBe("webhooks");
      expect(u.searchParams.has("mode")).toBe(false);
      expect(u.searchParams.has("limit")).toBe(false);
      return jsonResponse({ results: [] });
    });
    await client.searchDocs({ query: "webhooks" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Token Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Token Validation", () => {
  test("isTokenValid returns true for future expiry", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(isTokenValid({
      accessToken: "t", expiresAt: future, clientId: "c", region: "r", cognitoDomain: "d",
    })).toBe(true);
  });

  test("isTokenValid returns false for past expiry", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isTokenValid({
      accessToken: "t", expiresAt: past, clientId: "c", region: "r", cognitoDomain: "d",
    })).toBe(false);
  });

  test("isTokenValid returns false within 30s buffer", () => {
    const almostExpired = new Date(Date.now() + 10_000).toISOString(); // 10s out
    expect(isTokenValid({
      accessToken: "t", expiresAt: almostExpired, clientId: "c", region: "r", cognitoDomain: "d",
    })).toBe(false);
  });
});


describe("API version", () => {
  test("Seclai-Version header is omitted unless opted in", async () => {
    // The point of the option: upgrading the SDK must not silently move an
    // account onto a newer API version and change response shapes.
    const client = makeClient((req) => {
      expect(req.headers["seclai-version"]).toBeUndefined();
      return jsonResponse({ data: [] });
    });
    await client.listAgents();
  });

  test("Seclai-Version header is sent when set", async () => {
    const client = makeClient(
      (req) => {
        expect(req.headers["seclai-version"]).toBe("2026-07-27");
        return jsonResponse({ data: [] });
      },
      { apiVersion: "2026-07-27" },
    );
    await client.listAgents();
  });

  test("getApiVersion sends GET /version", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("GET");
      expect(new URL(req.url).pathname).toBe("/version");
      return jsonResponse({
        pinned_version: null,
        effective_version: "2026-01-01",
        default_version: "2026-01-01",
        latest_version: "2026-07-27",
        known_versions: ["2026-01-01", "2026-07-27"],
      });
    });
    const res = await client.getApiVersion();
    expect(res.latest_version).toBe("2026-07-27");
  });

  test("updateApiVersion sends explicit null to clear the pin", async () => {
    // null is the documented way to clear the pin, so it must reach the wire.
    let body: unknown;
    const client = makeClient((req) => {
      expect(req.method).toBe("PUT");
      expect(new URL(req.url).pathname).toBe("/version");
      body = JSON.parse(req.bodyText!);
      return jsonResponse({ pinned_version: null });
    });
    await client.updateApiVersion(null);
    expect(body).toEqual({ version: null });
  });
});


describe("Undeclared and required query params", () => {
  test("listAlerts does not send severity", async () => {
    // GET /alerts declares no severity filter: it never filtered anything, and
    // sending it is a 422 once apiVersion is 2026-07-27 or later.
    const client = makeClient((req) => {
      expect(new URL(req.url).searchParams.has("severity")).toBe(false);
      return jsonResponse({ data: [] });
    });
    await client.listAlerts({ severity: "high" });
  });

  test("listModelAlerts translates page to offset", async () => {
    // /models/alerts declares limit/offset, not page, so page 2 used to return
    // page 1.
    const client = makeClient((req) => {
      const q = new URL(req.url).searchParams;
      expect(q.get("offset")).toBe("50");
      expect(q.get("limit")).toBe("25");
      expect(q.has("page")).toBe(false);
      return jsonResponse({ alerts: [], total: 0 });
    });
    await client.listModelAlerts({ page: 3, limit: 25 });
  });

  test("getAgentAiConversationHistory sends step_type", async () => {
    // step_type is required by the API and the method had no way to send it,
    // so every call answered 422.
    const client = makeClient((req) => {
      expect(new URL(req.url).searchParams.get("step_type")).toBe("llm");
      return jsonResponse({ turns: [] });
    });
    await client.getAgentAiConversationHistory("ag_1", { stepType: "llm" });
  });
});


describe("Version-gated evaluation result shapes", () => {
  test("listRunEvaluationResults reads the canonical pagination", async () => {
    // The run-level endpoint is version-gated to {data, pagination}. Reading
    // only the flat total/page/limit reported undefined for opted-in callers.
    const client = makeClient(
      () =>
        jsonResponse({
          data: [],
          pagination: { page: 2, limit: 25, total: 7, pages: 1, has_next: false, has_prev: true },
        }),
      { apiVersion: "2026-07-27" },
    );
    const res = await client.listRunEvaluationResults("ag_1", "r_1", { page: 2, limit: 25 });
    expect(res.pagination?.total).toBe(7);
  });

  test("listAgentEvaluationResults still reads the flat shape", async () => {
    // The agent-level endpoint is not version-gated, so the shared type must
    // keep serving both.
    const client = makeClient(() => jsonResponse({ data: [], total: 7, page: 2, limit: 25 }));
    const res = await client.listAgentEvaluationResults("ag_1", { page: 2, limit: 25 });
    expect(res.total).toBe(7);
    expect(res.pagination).toBeUndefined();
  });
});


describe("Typed alert list shapes", () => {
  test("listAlerts decodes the typed envelope", async () => {
    const client = makeClient(() =>
      jsonResponse({
        data: [{ id: "al1", title: "Disk full", status: "triggered" }],
        pagination: { page: 1, limit: 20, total: 1, pages: 1, has_next: false, has_prev: false },
      }),
    );
    const res = await client.listAlerts();
    expect(res.data[0].id).toBe("al1");
    expect(res.pagination.total).toBe(1);
  });

  test("listAlertConfigs reads either top-level key", async () => {
    // `configs` by default, `data` once opted in.
    const legacy = makeClient(() => jsonResponse({ configs: [{ id: "c1" }], total: 1 }));
    const a = await legacy.listAlertConfigs();
    expect(a.configs?.[0].id).toBe("c1");

    const canonical = makeClient(() =>
      jsonResponse({
        data: [{ id: "c1" }],
        pagination: { page: 1, limit: 20, total: 1, pages: 1, has_next: false, has_prev: false },
      }),
    );
    const b = await canonical.listAlertConfigs();
    expect(b.data?.[0].id).toBe("c1");
    expect(b.pagination?.total).toBe(1);
  });

  test("listModelAlerts reads either top-level key", async () => {
    const legacy = makeClient(() => jsonResponse({ alerts: [{ id: "m1" }], total: 1 }));
    const a = await legacy.listModelAlerts();
    expect(a.alerts?.[0].id).toBe("m1");

    const canonical = makeClient(() =>
      jsonResponse({
        data: [{ id: "m1" }],
        pagination: { page: 1, limit: 20, total: 1, pages: 1, has_next: false, has_prev: false },
      }),
    );
    const b = await canonical.listModelAlerts();
    expect(b.data?.[0].id).toBe("m1");
  });
});

describe("Typed returns", () => {
  test("search returns the typed envelope", async () => {
    const client = makeClient(() =>
      jsonResponse({ results: [{ entity_type: "agent", name: "Support" }] }),
    );
    const res = await client.search({ query: "support" });
    // Deliberately not paginated — the spec carves this shape out to match the
    // MCP search_resources tool.
    expect(res.results[0].name).toBe("Support");
  });

  test("getAlert returns the typed detail", async () => {
    const client = makeClient(() =>
      jsonResponse({ alert: { id: "al1", title: "Disk full" }, comments: [], subscribers: [] }),
    );
    const res = await client.getAlert("al1");
    expect(res.alert.title).toBe("Disk full");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retyped methods — runtime smoke
//
// The 20 methods below had their return types narrowed from `unknown` by a bulk
// edit. A TypeScript `as` cast is unchecked, so neither the compiler nor the
// type tests can prove the body still issues the right request and hands back a
// parsed object. This table calls each one against a mock and asserts both.
// ─────────────────────────────────────────────────────────────────────────────

describe("Retyped methods issue the right request and parse the body", () => {
  const BODY = { id: "x1", alert: { id: "x1" }, results: [], data: [], ok: true };

  const cases: Array<[string, string, string, (c: Seclai) => Promise<unknown>]> = [
    ["getAlert", "GET", "/alerts/a1", (c) => c.getAlert("a1")],
    ["changeAlertStatus", "POST", "/alerts/a1/status", (c) => c.changeAlertStatus("a1", { status: "resolved" })],
    ["addAlertComment", "POST", "/alerts/a1/comments", (c) => c.addAlertComment("a1", { comment: "hi" })],
    ["subscribeToAlert", "POST", "/alerts/a1/subscribe", (c) => c.subscribeToAlert("a1")],
    ["unsubscribeFromAlert", "POST", "/alerts/a1/unsubscribe", (c) => c.unsubscribeFromAlert("a1")],
    ["listAlerts", "GET", "/alerts", (c) => c.listAlerts()],
    ["listAlertConfigs", "GET", "/alerts/configs", (c) => c.listAlertConfigs()],
    ["createAlertConfig", "POST", "/alerts/configs", (c) => c.createAlertConfig({ alert_type: "x" } as never)],
    ["getAlertConfig", "GET", "/alerts/configs/c1", (c) => c.getAlertConfig("c1")],
    ["updateAlertConfig", "PATCH", "/alerts/configs/c1", (c) => c.updateAlertConfig("c1", {} as never)],
    ["listModelAlerts", "GET", "/models/alerts", (c) => c.listModelAlerts()],
    ["getUnreadModelAlertCount", "GET", "/models/alerts/unread-count", (c) => c.getUnreadModelAlertCount()],
    ["getModelRecommendations", "GET", "/models/m1/recommendations", (c) => c.getModelRecommendations("m1")],
    ["listExperiments", "GET", "/models/playground/experiments", (c) => c.listExperiments()],
    ["createExperiment", "POST", "/models/playground/experiments", (c) => c.createExperiment({} as never)],
    ["getExperiment", "GET", "/models/playground/experiments/e1", (c) => c.getExperiment("e1")],
    ["cancelExperiment", "POST", "/models/playground/experiments/e1/cancel", (c) => c.cancelExperiment("e1")],
    ["search", "GET", "/search", (c) => c.search({ query: "q" })],
    ["acceptAiMemoryBankSuggestion", "PATCH", "/ai-assistant/memory-bank/cv1", (c) => c.acceptAiMemoryBankSuggestion("cv1", {} as never)],
    ["acceptMemoryBankAiSuggestion", "PATCH", "/memory_banks/ai-assistant/cv1", (c) => c.acceptMemoryBankAiSuggestion("cv1", {} as never)],
  ];

  test.each(cases)("%s sends %s %s and returns a parsed object", async (_name, verb, path, call) => {
    let seen: { method: string; pathname: string } | undefined;
    const client = makeClient((req) => {
      seen = { method: req.method, pathname: new URL(req.url).pathname };
      return jsonResponse(BODY);
    });
    const res = await call(client);
    expect(seen).toEqual({ method: verb, pathname: path });
    // A parsed object, not a Response and not a raw string.
    expect(typeof res).toBe("object");
    expect(res).not.toBeNull();
    expect(res).toHaveProperty("id", "x1");
  });
});

describe("API version constants", () => {
  test("constants track the spec's x-seclai-versions block", async () => {
    const spec = JSON.parse(
      readFileSync(new URL("../openapi/seclai.openapi.json", import.meta.url), "utf8"),
    );
    const v = spec["x-seclai-versions"];
    expect(SeclaiApiVersion.Default).toBe(v.default);
    expect(SeclaiApiVersion.Latest).toBe(v.latest);
    const known = Object.entries(SeclaiApiVersion)
      .filter(([k]) => k.startsWith("V"))
      .map(([, val]) => val);
    expect(known).toEqual(v.known);
  });

  test("a constant reaches the wire", async () => {
    const client = makeClient(
      (req) => {
        expect(req.headers["seclai-version"]).toBe("2026-10-03");
        return jsonResponse({ data: [] });
      },
      { apiVersion: SeclaiApiVersion.Latest },
    );
    await client.listAgents();
  });

  test("an unknown version is rejected", () => {
    // A newer server version can reshape responses, and this client would
    // mis-decode them silently rather than error. Fail closed at construction.
    expect(() => new Seclai({ apiKey: "k", apiVersion: "2099-01-01" })).toThrow(
      /2099-01-01[\s\S]*allowUnknownApiVersion/,
    );
  });

  test("an unknown version is allowed when asked", async () => {
    const client = makeClient(
      (req) => {
        expect(req.headers["seclai-version"]).toBe("2099-01-01");
        return jsonResponse({ data: [] });
      },
      { apiVersion: "2099-01-01", allowUnknownApiVersion: true },
    );
    await client.listAgents();
  });

  test("a known version needs no escape hatch", async () => {
    const client = makeClient(
      (req) => {
        expect(req.headers["seclai-version"]).toBe(SeclaiApiVersion.Latest);
        return jsonResponse({ data: [] });
      },
      { apiVersion: SeclaiApiVersion.Latest },
    );
    await client.listAgents();
  });
});

describe("API version guard cannot be bypassed via defaultHeaders", () => {
  test("an unknown version in defaultHeaders is rejected", () => {
    // defaultHeaders is spread last so it wins, which means it can carry a
    // Seclai-Version. Validating only `apiVersion` left the guard one header
    // away from being bypassed.
    expect(
      () =>
        new Seclai({
          apiKey: "k",
          defaultHeaders: { "Seclai-Version": "2099-01-01" },
        }),
    ).toThrow(/2099-01-01[\s\S]*defaultHeaders/);
  });

  test("a lowercase header key is caught too", () => {
    expect(
      () =>
        new Seclai({
          apiKey: "k",
          defaultHeaders: { "seclai-version": "2099-01-01" },
        }),
    ).toThrow(/2099-01-01/);
  });

  test("the escape hatch still covers the header form", async () => {
    const client = makeClient(
      (req) => {
        expect(req.headers["seclai-version"]).toBe("2099-01-01");
        return jsonResponse({ data: [] });
      },
      {
        defaultHeaders: { "Seclai-Version": "2099-01-01" },
        allowUnknownApiVersion: true,
      },
    );
    await client.listAgents();
  });

  test("a caller-supplied header overrides rather than duplicating", async () => {
    const client = makeClient(
      (req) => {
        // One value, not two: differing cases would otherwise emit both keys and
        // let the server pick arbitrarily.
        expect(req.headers["seclai-version"]).toBe("2026-07-27");
        return jsonResponse({ data: [] });
      },
      {
        apiVersion: SeclaiApiVersion.V2026_07_01,
        defaultHeaders: { "seclai-version": SeclaiApiVersion.V2026_07_27 },
      },
    );
    await client.listAgents();
  });

  test("a known version in defaultHeaders needs no escape hatch", () => {
    expect(
      () =>
        new Seclai({
          apiKey: "k",
          defaultHeaders: { "Seclai-Version": SeclaiApiVersion.V2026_07_27 },
        }),
    ).not.toThrow();
  });
});

describe("API version guard validates what the merge produces", () => {
  test("a second, differently-cased header cannot slip past the guard", () => {
    // The merge lets the LAST entry win. Validating the first match would
    // approve "2026-07-27" and then send "2099-01-01".
    expect(
      () =>
        new Seclai({
          apiKey: "k",
          defaultHeaders: {
            "Seclai-Version": SeclaiApiVersion.V2026_07_27,
            "seclai-version": "2099-01-01",
          },
        }),
    ).toThrow(/2099-01-01/);
  });

  test("and the value it approves is the one that reaches the wire", async () => {
    let seen: string[] = [];
    const client = makeClient(
      (req) => {
        seen = [req.headers["seclai-version"] ?? ""];
        return jsonResponse({ data: [] });
      },
      {
        defaultHeaders: {
          "Seclai-Version": SeclaiApiVersion.V2026_07_01,
          "seclai-version": SeclaiApiVersion.V2026_07_27,
        },
      },
    );
    await client.listAgents();
    expect(seen).toEqual([SeclaiApiVersion.V2026_07_27]);
  });

  test("the option is still named as the source when it is the culprit", () => {
    expect(() => new Seclai({ apiKey: "k", apiVersion: "2099-01-01" })).toThrow(
      /via apiVersion/,
    );
  });
});

describe("Cloud drives, embedders/rerankers and source contents", () => {
  const PAGINATION = { page: 1, limit: 1, total: 1, pages: 1, has_next: false, has_prev: false };

  type Call = {
    name: string;
    run: (c: Seclai) => Promise<unknown>;
    verb: string;
    path: string;
    query?: [string, string][];
    body?: unknown;
  };

  const calls: Call[] = [
    { name: "listCloudDriveProviders", run: (c) => c.listCloudDriveProviders(), verb: "GET", path: "/cloud-drives/providers" },
    { name: "listCloudDrives", run: (c) => c.listCloudDrives(), verb: "GET", path: "/cloud-drives" },
    { name: "getCloudDrive", run: (c) => c.getCloudDrive("c1"), verb: "GET", path: "/cloud-drives/c1" },
    {
      name: "updateCloudDrive",
      run: (c) => c.updateCloudDrive("c1", { name: "Contracts" }),
      verb: "PATCH",
      path: "/cloud-drives/c1",
      body: { name: "Contracts" },
    },
    { name: "disconnectCloudDrive", run: (c) => c.disconnectCloudDrive("c1"), verb: "POST", path: "/cloud-drives/c1/disconnect" },
    { name: "deleteCloudDrive", run: (c) => c.deleteCloudDrive("c1"), verb: "DELETE", path: "/cloud-drives/c1" },
    { name: "getAgentsUsingCloudDrive", run: (c) => c.getAgentsUsingCloudDrive("c1"), verb: "GET", path: "/cloud-drives/c1/agents" },
    {
      name: "listCloudDriveRejections with a limit",
      run: (c) => c.listCloudDriveRejections("c1", { limit: 20 }),
      verb: "GET",
      path: "/cloud-drives/c1/rejections",
      query: [["limit", "20"]],
    },
    { name: "listCloudDriveRejections", run: (c) => c.listCloudDriveRejections("c1"), verb: "GET", path: "/cloud-drives/c1/rejections" },
    {
      name: "listEmbeddingModels with a filter",
      run: (c) => c.listEmbeddingModels({ supportsInputMedia: "image" }),
      verb: "GET",
      path: "/models/embedders",
      query: [["supports_input_media", "image"]],
    },
    { name: "listEmbeddingModels", run: (c) => c.listEmbeddingModels(), verb: "GET", path: "/models/embedders" },
    { name: "listRerankerModels", run: (c) => c.listRerankerModels(), verb: "GET", path: "/models/rerankers" },
    {
      name: "listSourceContents with every option",
      run: (c) =>
        c.listSourceContents("s1", {
          page: 2,
          limit: 10,
          sort: "title",
          order: "asc",
          status: "failed",
          contentVersionIds: ["cv1", "cv2"],
        }),
      verb: "GET",
      path: "/sources/s1/contents",
      query: [
        ["page", "2"],
        ["limit", "10"],
        ["sort", "title"],
        ["order", "asc"],
        ["status", "failed"],
        ["content_version_id", "cv1"],
        ["content_version_id", "cv2"],
      ],
    },
    { name: "listSourceContents", run: (c) => c.listSourceContents("s1"), verb: "GET", path: "/sources/s1/contents" },
    {
      name: "getSourceContentStatus",
      run: (c) => c.getSourceContentStatus("s1", "cv1"),
      verb: "GET",
      path: "/sources/s1/contents/cv1",
    },
  ];

  test.each(calls)("$name sends $verb $path", async ({ run, verb, path, query, body }) => {
    let seen: unknown;
    const client = makeClient((req) => {
      const url = new URL(req.url);
      seen = {
        verb: req.method,
        path: url.pathname,
        query: [...url.searchParams.entries()],
        body: req.bodyText === undefined ? undefined : JSON.parse(req.bodyText),
      };
      return jsonResponse({ data: [] });
    });
    await run(client);
    expect(seen).toEqual({ verb, path, query: query ?? [], body });
  });

  const lists: { name: string; run: (c: Seclai) => Promise<unknown[]> }[] = [
    { name: "listCloudDriveProviders", run: (c) => c.listCloudDriveProviders() },
    { name: "listCloudDrives", run: (c) => c.listCloudDrives() },
    { name: "getAgentsUsingCloudDrive", run: (c) => c.getAgentsUsingCloudDrive("c1") },
    { name: "listCloudDriveRejections", run: (c) => c.listCloudDriveRejections("c1") },
  ];

  test.each(lists)("$name reads the legacy bare array", async ({ run }) => {
    const client = makeClient(() => jsonResponse([{ id: "x1" }]));
    expect(await run(client)).toEqual([{ id: "x1" }]);
  });

  test.each(lists)("$name reads the 2026-07-27 envelope", async ({ run }) => {
    const client = makeClient(() => jsonResponse({ data: [{ id: "x1" }], pagination: PAGINATION }));
    expect(await run(client)).toEqual([{ id: "x1" }]);
  });

  const modelLists: { name: string; run: (c: Seclai) => Promise<{ models: unknown[] }> }[] = [
    { name: "listEmbeddingModels", run: (c) => c.listEmbeddingModels() },
    { name: "listRerankerModels", run: (c) => c.listRerankerModels() },
  ];

  test.each(modelLists)("$name reads the legacy models key", async ({ run }) => {
    const client = makeClient(() =>
      jsonResponse({ models: [{ model_type: "m1" }], default_model_type: "m1" }),
    );
    const res = await run(client);
    expect(res.models).toEqual([{ model_type: "m1" }]);
    expect(res).toHaveProperty("default_model_type", "m1");
  });

  test.each(modelLists)("$name keeps models and the pricing on the 2026-07-27 envelope", async ({ run }) => {
    const client = makeClient(() =>
      jsonResponse({ data: [{ model_type: "m1" }], pagination: PAGINATION, default_model_type: "m1" }),
    );
    const res = await run(client);
    expect(res.models).toEqual([{ model_type: "m1" }]);
    expect(res).toHaveProperty("default_model_type", "m1");
    expect(res).toHaveProperty("pagination", PAGINATION);
  });

  test("listSourceContents returns the envelope", async () => {
    const body = { data: [{ content_version_id: "cv1" }], pagination: PAGINATION };
    const client = makeClient(() => jsonResponse(body));
    expect(await client.listSourceContents("s1")).toEqual(body);
  });

  test("listSourceContents with no ids returns an empty page without a request", async () => {
    let requests = 0;
    const client = makeClient(() => {
      requests += 1;
      return jsonResponse({ data: [{ content_version_id: "cv1" }], pagination: PAGINATION });
    });
    expect(await client.listSourceContents("s1", { contentVersionIds: [] })).toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, pages: 0, has_next: false, has_prev: false },
    });
    expect(
      (await client.listSourceContents("s1", { contentVersionIds: [], page: 3, limit: 5 })).pagination,
    ).toEqual({ page: 3, limit: 5, total: 0, pages: 0, has_next: false, has_prev: false });
    expect(requests).toBe(0);
  });

  test("deleteCloudDrive discards the acknowledgement", async () => {
    const client = makeClient(() => jsonResponse({ ok: true }));
    expect(await client.deleteCloudDrive("c1")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Version-gated lists: every gated endpoint, both response shapes
// ─────────────────────────────────────────────────────────────────────────────

// Every `METHOD path` the API serves through a version gate. Regenerate from the
// backend (seclai/backend/api/src/api/routers/api): list each call to
// `versioned_list_response`, `versioned_offset_list_response` and
// `versioned_complete_list_response`, and write down the route of the handler it
// returns from — the router's prefix without `/api`, plus the decorator's verb
// and path. One entry per call site.
const GATED_ENDPOINTS = [
  "GET /agents/{agent_id}/evaluation-criteria",
  "GET /agents/evaluation-criteria/{criteria_id}/results",
  "GET /agents/{agent_id}/runs/{run_id}/evaluation-results",
  "GET /agents/{agent_id}/evaluation-runs",
  "GET /agents/{agent_id}/evaluation-results",
  "GET /agents/evaluation-criteria/{criteria_id}/compatible-runs",
  "GET /agents/inbound-email-rejections",
  "GET /agents/agent-email-optouts",
  "GET /agents/blocked-email-senders",
  "PUT /agents/blocked-email-senders/mode",
  "GET /agents/{agent_id}/callers",
  "GET /alerts/configs",
  "GET /alerts/organization-preferences/list",
  "GET /cloud-drives/providers",
  "GET /cloud-drives",
  "GET /cloud-drives/{connection_id}/agents",
  "GET /cloud-drives/{connection_id}/rejections",
  "GET /email-domains",
  "GET /governance/ai-assistant/conversations",
  "GET /knowledge_bases",
  "GET /memory_banks/templates",
  "GET /memory_banks",
  "GET /memory_banks/{memory_bank_id}/agents",
  "GET /models/generation-tiers",
  "GET /models/alerts",
  "GET /models/playground/experiments",
  "GET /models",
  "GET /models/embedders",
  "GET /models/rerankers",
  "GET /solutions/{solution_id}/conversations",
] as const;

describe("Version-gated lists", () => {
  const ITEMS = [{ id: "x1" }];
  // `versioned_list_response` / `versioned_offset_list_response`: a real page.
  const PAGED = { page: 1, limit: 50, total: 1, pages: 1, has_next: false, has_prev: false };
  // `versioned_complete_list_response`: one page spanning the whole list.
  const COMPLETE = { page: 1, limit: 1, total: 1, pages: 1, has_next: false, has_prev: false };

  type Row = {
    endpoint: (typeof GATED_ENDPOINTS)[number];
    name: string;
    call: (c: Seclai) => Promise<unknown>;
    /** The body below 2026-07-27, and what the method must return for it. */
    legacy: unknown;
    wantLegacy: unknown;
    /** The body from 2026-07-27, and what the method must return for it. */
    canonical: unknown;
    wantCanonical: unknown;
  };

  /** A method declared as an array: the items on either shape. */
  const arrayRow = (
    endpoint: Row["endpoint"],
    name: string,
    call: Row["call"],
    pagination: typeof PAGED,
  ): Row => ({
    endpoint,
    name,
    call,
    legacy: ITEMS,
    wantLegacy: ITEMS,
    canonical: { data: ITEMS, pagination },
    wantCanonical: ITEMS,
  });

  /**
   * A method declared as an object. `legacy` is the default body; from
   * 2026-07-27 its list moves to `data`, its counters into `pagination`, and
   * `extras` stay beside them — and the method must still return every legacy
   * field, with `data` and `pagination` kept.
   */
  const keyedRow = (
    endpoint: Row["endpoint"],
    name: string,
    call: Row["call"],
    pagination: typeof PAGED,
    legacy: Record<string, unknown>,
    extras: Record<string, unknown> = {},
  ): Row => ({
    endpoint,
    name,
    call,
    legacy,
    wantLegacy: legacy,
    canonical: { data: ITEMS, pagination, ...extras },
    wantCanonical: { ...legacy, data: ITEMS, pagination },
  });

  const FLAT = { data: ITEMS, total: 1, page: 1, limit: 50 };
  const BLOCKED = { auto_block_mode: "disabled" };
  const DOMAIN_CAPS = {
    can_add_vanity: true,
    can_add_custom: false,
    has_vanity: false,
    has_custom: false,
    vanity_plan_names: ["Pro"],
    custom_plan_names: ["Enterprise"],
  };
  const EMBEDDER_EXTRAS = {
    storage_credits: [{ dimension: 1024, credits: 1 }],
    file_processing_credits_per_mb: 2,
    default_model_type: "m1",
    default_dimension: 1024,
  };
  const RERANKER_EXTRAS = { default_model_type: "m1", search_processing_credits: 3 };

  const rows: Row[] = [
    arrayRow("GET /agents/{agent_id}/evaluation-criteria", "listEvaluationCriteria", (c) => c.listEvaluationCriteria("a1"), PAGED),
    {
      endpoint: "GET /agents/{agent_id}/evaluation-criteria",
      name: "listEvaluationCriteriaPage",
      call: (c) => c.listEvaluationCriteriaPage("a1"),
      legacy: ITEMS,
      wantLegacy: { data: ITEMS },
      canonical: { data: ITEMS, pagination: PAGED },
      wantCanonical: { data: ITEMS, pagination: PAGED },
    },
    keyedRow("GET /agents/evaluation-criteria/{criteria_id}/results", "listEvaluationResults", (c) => c.listEvaluationResults("c1"), PAGED, FLAT),
    {
      endpoint: "GET /agents/{agent_id}/runs/{run_id}/evaluation-results",
      name: "listRunEvaluationResults",
      call: (c) => c.listRunEvaluationResults("a1", "r1"),
      legacy: ITEMS,
      wantLegacy: { data: ITEMS },
      canonical: { data: ITEMS, pagination: PAGED },
      wantCanonical: { ...FLAT, pagination: PAGED },
    },
    keyedRow("GET /agents/{agent_id}/evaluation-runs", "listEvaluationRuns", (c) => c.listEvaluationRuns("a1"), PAGED, FLAT),
    keyedRow("GET /agents/{agent_id}/evaluation-results", "listAgentEvaluationResults", (c) => c.listAgentEvaluationResults("a1"), PAGED, FLAT),
    keyedRow("GET /agents/evaluation-criteria/{criteria_id}/compatible-runs", "listCompatibleRuns", (c) => c.listCompatibleRuns("c1"), PAGED, FLAT),
    arrayRow("GET /agents/inbound-email-rejections", "listInboundEmailRejections", (c) => c.listInboundEmailRejections(), PAGED),
    keyedRow("GET /agents/agent-email-optouts", "listAgentEmailOptOuts", (c) => c.listAgentEmailOptOuts(), PAGED, { items: ITEMS, total: 1 }),
    keyedRow("GET /agents/blocked-email-senders", "listBlockedEmailSenders", (c) => c.listBlockedEmailSenders(), PAGED, { items: ITEMS, total: 1, ...BLOCKED }, BLOCKED),
    keyedRow("PUT /agents/blocked-email-senders/mode", "setAutoBlockMode", (c) => c.setAutoBlockMode({ mode: "disabled" }), COMPLETE, { items: ITEMS, total: 1, ...BLOCKED }, BLOCKED),
    arrayRow("GET /agents/{agent_id}/callers", "getAgentCallers", (c) => c.getAgentCallers("a1"), COMPLETE),
    keyedRow("GET /alerts/configs", "listAlertConfigs", (c) => c.listAlertConfigs(), PAGED, { configs: ITEMS, total: 1 }),
    keyedRow("GET /alerts/organization-preferences/list", "listOrganizationAlertPreferences", (c) => c.listOrganizationAlertPreferences(), COMPLETE, { preferences: ITEMS, total: 1 }),
    arrayRow("GET /cloud-drives/providers", "listCloudDriveProviders", (c) => c.listCloudDriveProviders(), COMPLETE),
    arrayRow("GET /cloud-drives", "listCloudDrives", (c) => c.listCloudDrives(), COMPLETE),
    arrayRow("GET /cloud-drives/{connection_id}/agents", "getAgentsUsingCloudDrive", (c) => c.getAgentsUsingCloudDrive("d1"), COMPLETE),
    arrayRow("GET /cloud-drives/{connection_id}/rejections", "listCloudDriveRejections", (c) => c.listCloudDriveRejections("d1"), PAGED),
    keyedRow("GET /email-domains", "listEmailDomains", (c) => c.listEmailDomains(), COMPLETE, { domains: ITEMS, ...DOMAIN_CAPS }, DOMAIN_CAPS),
    arrayRow("GET /governance/ai-assistant/conversations", "listGovernanceAiConversations", (c) => c.listGovernanceAiConversations(), PAGED),
    keyedRow("GET /knowledge_bases", "listKnowledgeBases", (c) => c.listKnowledgeBases(), PAGED, { knowledge_bases: ITEMS, page: 1, limit: 50, total: 1 }),
    arrayRow("GET /memory_banks/templates", "listMemoryBankTemplates", (c) => c.listMemoryBankTemplates(), COMPLETE),
    keyedRow("GET /memory_banks", "listMemoryBanks", (c) => c.listMemoryBanks(), PAGED, { memory_banks: ITEMS, page: 1, limit: 50, total: 1 }),
    arrayRow("GET /memory_banks/{memory_bank_id}/agents", "getAgentsUsingMemoryBank", (c) => c.getAgentsUsingMemoryBank("m1"), COMPLETE),
    keyedRow("GET /models/generation-tiers", "getGenerationTiers", (c) => c.getGenerationTiers(), COMPLETE, { tiers: ITEMS }),
    keyedRow("GET /models/alerts", "listModelAlerts", (c) => c.listModelAlerts(), PAGED, { alerts: ITEMS, total: 1 }),
    keyedRow("GET /models/playground/experiments", "listExperiments", (c) => c.listExperiments(), PAGED, { experiments: ITEMS, total: 1 }),
    arrayRow("GET /models", "listModels", (c) => c.listModels(), COMPLETE),
    keyedRow("GET /models/embedders", "listEmbeddingModels", (c) => c.listEmbeddingModels(), COMPLETE, { models: ITEMS, ...EMBEDDER_EXTRAS }, EMBEDDER_EXTRAS),
    keyedRow("GET /models/rerankers", "listRerankerModels", (c) => c.listRerankerModels(), COMPLETE, { models: ITEMS, ...RERANKER_EXTRAS }, RERANKER_EXTRAS),
    arrayRow("GET /solutions/{solution_id}/conversations", "listSolutionConversations", (c) => c.listSolutionConversations("s1"), COMPLETE),
  ];

  /** Serve `body`, failing unless the request is the row's `METHOD path`. */
  function clientFor(endpoint: string, body: unknown): Seclai {
    const [verb, template] = endpoint.split(" ");
    const path = new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    return makeClient((req) => {
      expect(req.method).toBe(verb);
      expect(new URL(req.url).pathname).toMatch(path);
      return jsonResponse(body);
    });
  }

  test("every gated endpoint has a row", () => {
    expect(GATED_ENDPOINTS).toHaveLength(30);
    expect([...new Set(rows.map((row) => row.endpoint))].sort()).toEqual([...GATED_ENDPOINTS].sort());
  });

  test.each(rows)("$name returns its declared shape for the default body", async (row) => {
    expect(await row.call(clientFor(row.endpoint, row.legacy))).toEqual(row.wantLegacy);
  });

  test.each(rows)("$name returns its declared shape for the 2026-07-27 body", async (row) => {
    expect(await row.call(clientFor(row.endpoint, row.canonical))).toEqual(row.wantCanonical);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Headers: one value per header, and a guarded Seclai-Version, on every path
// ─────────────────────────────────────────────────────────────────────────────

describe("Request headers", () => {
  // `makeFetch` reads headers through `Headers`, which joins two spellings of a
  // name into one value. These tests need the object exactly as it was sent.
  function recordingClient(
    extra: Partial<ConstructorParameters<typeof Seclai>[0]>,
    respond: () => Response = () => jsonResponse({ data: [] }),
  ) {
    const sent: { headers: Record<string, string>; body: unknown }[] = [];
    const client = new Seclai({
      baseUrl: "https://test.invalid",
      fetch: async (_input, init) => {
        sent.push({ headers: { ...(init?.headers as Record<string, string>) }, body: init?.body });
        return respond();
      },
      ...extra,
    });
    return { client, sent };
  }

  const done = () =>
    makeSseResponse([`event: done\ndata: ${JSON.stringify({ run_id: "r1", status: "completed" })}\n\n`]);

  const CREDENTIAL_DEFAULTS = { "X-API-KEY": "other", "X-Trace": "default" };

  test("request() sends one value per header whatever the case", async () => {
    const { client, sent } = recordingClient({ apiKey: "real", defaultHeaders: CREDENTIAL_DEFAULTS });
    await client.request("POST", "/agents", {
      json: { name: "a" },
      headers: { "x-trace": "request", "Content-Type": "application/x-ndjson" },
    });
    expect(sent[0].headers).toEqual({
      "Content-Type": "application/x-ndjson",
      "x-trace": "request",
      "x-api-key": "real",
    });
  });

  test("request() sends the JSON content type when the caller sets none", async () => {
    const { client, sent } = recordingClient({ apiKey: "real" });
    await client.request("POST", "/agents", { json: { name: "a" } });
    expect(sent[0].headers).toEqual({ "content-type": "application/json", "x-api-key": "real" });
  });

  test("request() sends the bearer token and account id once", async () => {
    const { client, sent } = recordingClient({
      accessToken: "tok",
      accountId: "acct",
      defaultHeaders: { Authorization: "Bearer other", "X-Account-Id": "other" },
    });
    await client.request("GET", "/agents", { headers: { AUTHORIZATION: "Bearer third" } });
    expect(sent[0].headers).toEqual({ authorization: "Bearer tok", "x-account-id": "acct" });
  });

  test("requestRaw() sends one value per header whatever the case", async () => {
    const { client, sent } = recordingClient({ apiKey: "real", defaultHeaders: CREDENTIAL_DEFAULTS });
    await client.requestRaw("POST", "/agents", {
      json: { name: "a" },
      headers: { "x-trace": "request", "CONTENT-TYPE": "application/x-ndjson" },
    });
    expect(sent[0].headers).toEqual({
      "CONTENT-TYPE": "application/x-ndjson",
      "x-trace": "request",
      "x-api-key": "real",
    });
  });

  test("a download sends one value per header", async () => {
    const { client, sent } = recordingClient({ apiKey: "real", defaultHeaders: CREDENTIAL_DEFAULTS });
    await client.downloadSourceExport("s1", "e1");
    expect(sent[0].headers).toEqual({ "X-Trace": "default", "x-api-key": "real" });
  });

  test("an upload leaves the content type to the multipart body", async () => {
    const { client, sent } = recordingClient({
      apiKey: "real",
      defaultHeaders: { ...CREDENTIAL_DEFAULTS, "Content-type": "application/json" },
    });
    await client.uploadFileToSource("s1", { file: new Uint8Array([1]), fileName: "a.txt" });
    expect(sent[0].headers).toEqual({ "X-Trace": "default", "x-api-key": "real" });
    expect(sent[0].body).toBeInstanceOf(FormData);
  });

  const STREAM_DEFAULTS = { ...CREDENTIAL_DEFAULTS, Accept: "application/json", "Content-Type": "text/plain" };
  const STREAM_HEADERS = {
    "X-Trace": "default",
    "x-api-key": "real",
    accept: "text/event-stream",
    "content-type": "application/json",
  };

  test("runStreamingAgentAndWait() sends one value per header", async () => {
    const { client, sent } = recordingClient({ apiKey: "real", defaultHeaders: STREAM_DEFAULTS }, done);
    await client.runStreamingAgentAndWait("a1", { input: "x" } as never);
    expect(sent[0].headers).toEqual(STREAM_HEADERS);
  });

  test("runStreamingAgent() sends one value per header", async () => {
    const { client, sent } = recordingClient({ apiKey: "real", defaultHeaders: STREAM_DEFAULTS }, done);
    for await (const _ of client.runStreamingAgent("a1", { input: "x" } as never)) void _;
    expect(sent[0].headers).toEqual(STREAM_HEADERS);
  });

  test("a per-request Seclai-Version replaces the client's in any case", async () => {
    const { client, sent } = recordingClient({ apiKey: "real", apiVersion: SeclaiApiVersion.V2026_07_01 });
    await client.request("GET", "/agents", { headers: { "seclai-version": SeclaiApiVersion.V2026_07_27 } });
    await client.requestRaw("GET", "/agents", { headers: { "SECLAI-VERSION": SeclaiApiVersion.V2026_07_27 } });
    expect(sent.map((s) => s.headers)).toEqual([
      { "seclai-version": "2026-07-27", "x-api-key": "real" },
      { "SECLAI-VERSION": "2026-07-27", "x-api-key": "real" },
    ]);
  });

  test.each(["Seclai-Version", "seclai-version"])(
    "an unknown per-request %s is rejected before anything is sent",
    async (name) => {
      const { client, sent } = recordingClient({ apiKey: "real", apiVersion: SeclaiApiVersion.V2026_07_01 });
      const headers = { [name]: "2099-01-01" };
      await expect(client.request("GET", "/agents", { headers })).rejects.toThrow(SeclaiConfigurationError);
      await expect(client.requestRaw("GET", "/agents", { headers })).rejects.toThrow(
        `via headers['${name}']`,
      );
      expect(sent).toEqual([]);
    },
  );

  test("an empty Seclai-Version is rejected, not treated as absent", async () => {
    expect(
      () =>
        new Seclai({
          apiKey: "real",
          apiVersion: SeclaiApiVersion.Latest,
          defaultHeaders: { "Seclai-Version": "" },
        }),
    ).toThrow(/via defaultHeaders\['Seclai-Version'\]/);

    const { client, sent } = recordingClient({ apiKey: "real", apiVersion: SeclaiApiVersion.Latest });
    await expect(client.request("GET", "/agents", { headers: { "seclai-version": "" } })).rejects.toThrow(
      SeclaiConfigurationError,
    );
    expect(sent).toEqual([]);
  });

  test("allowUnknownApiVersion lets an unknown per-request version through", async () => {
    const { client, sent } = recordingClient({ apiKey: "real", allowUnknownApiVersion: true });
    await client.request("GET", "/agents", { headers: { "Seclai-Version": "2099-01-01" } });
    expect(sent[0].headers).toEqual({ "Seclai-Version": "2099-01-01", "x-api-key": "real" });
  });
});

describe("A list response that is not a list", () => {
  const clientAnswering = (body: unknown) => makeClient(() => jsonResponse(body));

  test.each([
    ["an error-shaped object", { error: "boom" }],
    ["a string", "<html>login</html>"],
    ["null", null],
    ["a key holding a non-array", { knowledge_bases: { a: 1 }, models: { a: 1 } }],
  ])("throws SeclaiError for %s rather than reading as no results", async (_name, body) => {
    const client = clientAnswering(body);
    await expect(client.listKnowledgeBases()).rejects.toThrow(SeclaiError);
    await expect(client.listModels()).rejects.toThrow(SeclaiError);
    await expect(client.listCloudDrives()).rejects.toThrow(SeclaiError);
    await expect(client.listMemoryBankTemplates()).rejects.toThrow(SeclaiError);
  });

  test("an explicit null list is still an empty list", async () => {
    const client = clientAnswering({ data: null, pagination: null });
    expect(await client.listModels()).toEqual([]);
    expect((await client.listKnowledgeBases()).knowledge_bases).toEqual([]);
  });
});

describe("Header edge cases from untyped callers", () => {
  function recording(extra: Partial<ConstructorParameters<typeof Seclai>[0]> = {}) {
    const sent: Record<string, string>[] = [];
    const client = new Seclai({
      apiKey: "real",
      baseUrl: "https://test.invalid",
      fetch: async (_input, init) => {
        sent.push({ ...(init?.headers as Record<string, string>) });
        return jsonResponse({ data: [] });
      },
      ...extra,
    });
    return { client, sent };
  }

  test.each([undefined, null])("a %s content-type does not displace the JSON one", async (value) => {
    const { client, sent } = recording();
    const headers = { "content-type": value } as unknown as Record<string, string>;
    await client.request("POST", "/agents", { json: { a: 1 }, headers });
    expect(sent[0]).toEqual({ "content-type": "application/json", "x-api-key": "real" });
  });

  test("the guard names the spelling that carried the rejected version", () => {
    expect(
      () =>
        new Seclai({
          apiKey: "real",
          defaultHeaders: { "Seclai-Version": "2026-07-27", "seclai-version": "2099-01-01" },
        }),
    ).toThrow("defaultHeaders['seclai-version']");
  });
});
