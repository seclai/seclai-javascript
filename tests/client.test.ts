import { describe, expect, test } from "vitest";

import {
  Seclai,
  SeclaiAPIStatusError,
  SeclaiAPIValidationError,
  SeclaiConfigurationError,
  SeclaiError,
  SeclaiStreamingError,
} from "../src/index";

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

function makeClient(handler: (req: RecordedRequest) => Response | Promise<Response>) {
  return new Seclai({ apiKey: "test-key", baseUrl: "https://test.invalid", fetch: makeFetch(handler) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration & Auth
// ─────────────────────────────────────────────────────────────────────────────

describe("Configuration & Auth", () => {
  test("constructor throws when apiKey missing", () => {
    const p = (globalThis as any).process;
    const prev = p?.env?.SECLAI_API_KEY;
    if (p?.env) delete p.env.SECLAI_API_KEY;
    expect(() => new Seclai({ fetch: makeFetch(() => new Response("ok")) })).toThrow(SeclaiConfigurationError);
    if (p?.env) {
      if (prev === undefined) delete p.env.SECLAI_API_KEY;
      else p.env.SECLAI_API_KEY = prev;
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

  test("deleteAgentRun sends DELETE /agents/runs/:id", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("DELETE");
      expect(new URL(req.url).pathname).toBe("/agents/runs/run_1");
      return new Response(null, { status: 204 });
    });
    await client.deleteAgentRun("run_1");
  });

  test("cancelAgentRun sends POST /agents/runs/:id/cancel", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/agents/runs/run_1/cancel");
      return jsonResponse({ id: "run_1", status: "cancelled" });
    });
    await client.cancelAgentRun("run_1");
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
      return jsonResponse({ items: [] });
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
      return jsonResponse({ items: [] });
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
  test("listSources sends GET /sources/ with query params", async () => {
    const client = makeClient((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/sources/");
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
      return jsonResponse({ items: [] });
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
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/evaluation-criteria");
      return jsonResponse({ items: [] });
    });
    await client.listEvaluationCriteria("ag_1");
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
      return jsonResponse({ items: [] });
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
  test("paginate yields items across multiple pages", async () => {
    let pagesFetched = 0;
    const client = makeClient(() => jsonResponse({})); // unused in this test

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

  test("paginate stops on single page", async () => {
    const client = makeClient(() => jsonResponse({}));

    const allItems: string[] = [];
    for await (const item of client.paginate(
      async () => ({ items: ["x"], pagination: { page: 1, total_pages: 1 } }),
    )) {
      allItems.push(item);
    }

    expect(allItems).toEqual(["x"]);
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
      return jsonResponse({ items: [] });
    });
    await client.listOrganizationAlertPreferences();
  });

  test("updateOrganizationAlertPreference sends PATCH", async () => {
    const client = makeClient((req) => {
      expect(req.method).toBe("PATCH");
      expect(new URL(req.url).pathname).toBe("/alerts/organization-preferences/org_1/model_alert");
      return jsonResponse({});
    });
    await client.updateOrganizationAlertPreference("org_1", "model_alert", {} as any);
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
      return jsonResponse({ items: [] });
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
      return jsonResponse({ items: [] });
    });
    await client.listEvaluationResults("crit_1", { page: 2, limit: 10 });
  });

  test("listCompatibleRuns sends GET /agents/evaluation-criteria/:id/compatible-runs", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/evaluation-criteria/crit_1/compatible-runs");
      return jsonResponse({ items: [] });
    });
    await client.listCompatibleRuns("crit_1");
  });

  test("listRunEvaluationResults sends GET /agents/:agentId/runs/:runId/evaluation-results", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/runs/run_1/evaluation-results");
      return jsonResponse({ items: [] });
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
  test("getAgentAiConversationHistory sends GET", async () => {
    const client = makeClient((req) => {
      expect(new URL(req.url).pathname).toBe("/agents/ag_1/ai-assistant/conversations");
      return jsonResponse([]);
    });
    await client.getAgentAiConversationHistory("ag_1");
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
