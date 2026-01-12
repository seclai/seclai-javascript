import { describe, expect, test } from "vitest";

import {
  Seclai,
  SeclaiAPIStatusError,
  SeclaiAPIValidationError,
  SeclaiConfigurationError,
} from "../src/index";

type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText?: string;
  body?: BodyInit;
};

function getHeader(headers: Headers, name: string): string | undefined {
  const v = headers.get(name);
  return v === null ? undefined : v;
}

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

    return await handler({ url, method, headers, bodyText, body: init?.body ?? undefined });
  };
}

describe("Seclai client", () => {
  test("constructor throws when apiKey missing", () => {
    // avoid Node typings by using globalThis cast
    const p = (globalThis as any).process;
    const prev = p?.env?.SECLAI_API_KEY;
    if (p?.env) delete p.env.SECLAI_API_KEY;

    expect(() => new Seclai({ fetch: makeFetch(() => new Response("ok")) })).toThrow(
      SeclaiConfigurationError
    );

    if (p?.env) {
      if (prev === undefined) delete p.env.SECLAI_API_KEY;
      else p.env.SECLAI_API_KEY = prev;
    }
  });

  test("injects x-api-key header from opts.apiKey", async () => {
    const fetch = makeFetch((req) => {
      expect(req.headers["x-api-key"]).toBe("test-key");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new Seclai({ apiKey: "test-key", baseUrl: "https://example.invalid", fetch });
    await client.request("GET", "/api/sources/");
  });

  test("uses SECLAI_API_URL env var when baseUrl not provided", async () => {
    const p = (globalThis as any).process;
    const prev = p?.env?.SECLAI_API_URL;
    if (p?.env) p.env.SECLAI_API_URL = "https://env.example.invalid";

    const fetch = makeFetch((req) => {
      const u = new URL(req.url);
      expect(u.origin).toBe("https://env.example.invalid");
      expect(u.pathname).toBe("/api/sources/");
      // listSources() always supplies defaults
      expect(u.searchParams.get("page")).toBe("1");
      expect(u.searchParams.get("limit")).toBe("20");
      expect(u.searchParams.get("sort")).toBe("created_at");
      expect(u.searchParams.get("order")).toBe("desc");
      return new Response(JSON.stringify({ data: [], pagination: { page: 1, limit: 20, total: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new Seclai({ apiKey: "k", fetch });
    await client.listSources();

    if (p?.env) {
      if (prev === undefined) delete p.env.SECLAI_API_URL;
      else p.env.SECLAI_API_URL = prev;
    }
  });

  test("throws SeclaiAPIValidationError on 422", async () => {
    const fetch = makeFetch(() => {
      return new Response(JSON.stringify({ detail: [{ loc: ["body"], msg: "bad", type: "value_error" }] }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new Seclai({ apiKey: "k", baseUrl: "https://example.invalid", fetch });

    await expect(client.listSources()).rejects.toBeInstanceOf(SeclaiAPIValidationError);
  });

  test("throws SeclaiAPIStatusError on non-2xx", async () => {
    const fetch = makeFetch(() => new Response("nope", { status: 401 }));

    const client = new Seclai({ apiKey: "k", baseUrl: "https://example.invalid", fetch });

    await expect(client.listSources()).rejects.toBeInstanceOf(SeclaiAPIStatusError);
  });

  test("listSources builds query params", async () => {
    const fetch = makeFetch((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/api/sources/");
      expect(u.searchParams.get("page")).toBe("2");
      expect(u.searchParams.get("limit")).toBe("10");
      expect(u.searchParams.get("sort")).toBe("created_at");
      expect(u.searchParams.get("order")).toBe("asc");
      expect(u.searchParams.get("account_id")).toBe("acc_123");
      return new Response(JSON.stringify({ data: [], pagination: { page: 2, limit: 10, total: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new Seclai({ apiKey: "k", baseUrl: "https://example.invalid", fetch });
    await client.listSources({ page: 2, limit: 10, order: "asc", accountId: "acc_123" });
  });

  test("request sends JSON body and content-type", async () => {
    const fetch = makeFetch((req) => {
      expect(req.method).toBe("POST");
      expect(req.headers["content-type"]).toContain("application/json");
      expect(req.bodyText).toBe(JSON.stringify({ hello: "world" }));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new Seclai({ apiKey: "k", baseUrl: "https://example.invalid", fetch });
    await client.request("POST", "/api/agents/a/runs", { json: { hello: "world" } });
  });

  test("uploadFileToSource sends multipart form data", async () => {
    const fetch = makeFetch((req) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/api/sources/sc_123/upload");
      expect(req.method).toBe("POST");

      // The SDK should NOT set content-type for FormData (fetch will add boundary).
      expect(req.headers["content-type"]).toBeUndefined();

      expect(req.body).toBeInstanceOf(FormData);
      const form = req.body as FormData;

      const title = form.get("title");
      expect(title).toBe("My title");

      const file = form.get("file") as any;
      expect(file).toBeInstanceOf(Blob);
      expect(file.type).toBe("text/plain");
      // Node's FormData typically returns a File here.
      if (typeof file?.name === "string") {
        expect(file.name).toBe("hello.txt");
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new Seclai({ apiKey: "k", baseUrl: "https://example.invalid", fetch });
    await client.uploadFileToSource("sc_123", {
      file: new Uint8Array([104, 101, 108, 108, 111]),
      title: "My title",
      fileName: "hello.txt",
      mimeType: "text/plain",
    });
  });

  test("uploadFileToSource throws SeclaiAPIValidationError on 422", async () => {
    const fetch = makeFetch(() => {
      return new Response(JSON.stringify({ detail: [{ loc: ["body"], msg: "bad", type: "value_error" }] }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    });

    const client = new Seclai({ apiKey: "k", baseUrl: "https://example.invalid", fetch });

    await expect(
      client.uploadFileToSource("sc_123", {
        file: new Uint8Array([1, 2, 3]),
        fileName: "a.bin",
      })
    ).rejects.toBeInstanceOf(SeclaiAPIValidationError);
  });
});
