import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import {
  ApiError,
  Client,
  AuthenticationError,
  RateLimitError,
  ValidationError,
} from "../src/index.js";

const KEY = "pm_live_abcdefghijklmnopqrstuvwxyz0123456789ab";

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return mock.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }) as unknown as typeof fetch;
}

test("send success maps result and sets enterprise headers", async () => {
  const fetchImpl = mockFetch(202, {
    id: "11111111-1111-1111-1111-111111111111",
    status: "queued",
    provider_message_id: null,
    attachment_count: 0,
  });
  const client = new Client(KEY, {
    baseUrl: "https://mail.example.com",
    fetch: fetchImpl,
    maxRetries: 0,
  });
  const result = await client.send({
    from: "noreply@acme.test",
    to: ["user@example.com"],
    subject: "Hello",
    text: "Hi",
  });
  assert.equal(result.isQueued(), true);
  assert.equal(result.httpStatus, 202);
  assert.equal((fetchImpl as any).mock.calls.length, 1);
  const [url, init] = (fetchImpl as any).mock.calls[0].arguments;
  assert.equal(url, "https://mail.example.com/api/v1/send");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  assert.match(init.headers["User-Agent"], /^proxymailer-node\//);
  assert.equal(init.headers["X-ProxyMailer-Client"], init.headers["User-Agent"]);
  assert.match(init.headers["X-Request-Id"], /^[a-f0-9]{16}$/);
  assert.equal(init.headers.Accept, "application/json");
  assert.equal(init.headers["Content-Type"], "application/json");
});

test("auth error throws", async () => {
  const client = new Client(KEY, {
    baseUrl: "https://mail.example.com",
    fetch: mockFetch(401, { message: "Valid application API key required." }),
    maxRetries: 0,
  });
  await assert.rejects(
    () => client.send({ from: "a@b.c", to: ["c@d.e"] }),
    (err: unknown) => err instanceof AuthenticationError,
  );
});

test("validation error exposes fields", async () => {
  const client = new Client(KEY, {
    baseUrl: "https://mail.example.com",
    fetch: mockFetch(422, {
      message: "The given data was invalid.",
      errors: { from: ["Unauthorized sender"] },
    }),
    maxRetries: 0,
  });
  try {
    await client.send({ from: "bad@acme.test", to: ["user@example.com"] });
    assert.fail("expected ValidationError");
  } catch (err) {
    assert.ok(err instanceof ValidationError);
    assert.ok(err.errors.from);
  }
});

test("rejects non pm_live keys", () => {
  assert.throws(() => new Client("sk_test_123"), TypeError);
});

test("attachment helpers", async () => {
  const att = Client.attachmentFromBytes("note.txt", "hello", "text/plain");
  assert.equal(att.filename, "note.txt");
  assert.equal(att.content, Buffer.from("hello").toString("base64"));

  const dir = await mkdtemp(join(tmpdir(), "pm-sdk-"));
  try {
    const path = join(dir, "invoice.pdf");
    await writeFile(path, "pdf-bytes");
    const fromPath = await Client.attachmentFromPath(path);
    assert.equal(fromPath.filename, "invoice.pdf");
    assert.equal(fromPath.content_type, "application/pdf");
    assert.equal(fromPath.content, Buffer.from("pdf-bytes").toString("base64"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sync failure 502 returns SendResult without retry", async () => {
  const fetchImpl = mockFetch(502, {
    id: "22222222-2222-2222-2222-222222222222",
    status: "failed",
    provider_message_id: null,
    attachment_count: 0,
  });
  const client = new Client(KEY, {
    baseUrl: "https://mail.example.com",
    fetch: fetchImpl,
    maxRetries: 3,
  });
  const result = await client.send({ from: "a@b.c", to: "c@d.e", sync: true });
  assert.equal(result.isFailed(), true);
  assert.equal(result.httpStatus, 502);
  assert.equal((fetchImpl as any).mock.calls.length, 1);
});

test("honors Retry-After on 429 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = mock.fn(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ message: "Too many requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "0" },
      });
    }
    return new Response(
      JSON.stringify({
        id: "33333333-3333-3333-3333-333333333333",
        status: "sent",
        provider_message_id: "esp-1",
        attachment_count: 0,
      }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const client = new Client(KEY, {
    baseUrl: "https://mail.example.com",
    fetch: fetchImpl,
    maxRetries: 2,
  });
  const result = await client.send({ from: "a@b.c", to: "c@d.e" });
  assert.equal(result.isSent(), true);
  assert.equal(calls, 2);
});

test("exhausted 429 throws RateLimitError", async () => {
  const client = new Client(KEY, {
    baseUrl: "https://mail.example.com",
    fetch: mockFetch(429, { message: "rate limited" }, { "Retry-After": "0" }),
    maxRetries: 0,
  });
  await assert.rejects(
    () => client.send({ from: "a@b.c", to: "c@d.e" }),
    (err: unknown) =>
      err instanceof RateLimitError && err.retryAfterSeconds === 0,
  );
});

test("generic 502 is retried then throws ApiError", async () => {
  const fetchImpl = mockFetch(502, { message: "bad gateway" });
  const client = new Client(KEY, {
    baseUrl: "https://mail.example.com",
    fetch: fetchImpl,
    maxRetries: 1,
  });
  await assert.rejects(
    () => client.send({ from: "a@b.c", to: "c@d.e" }),
    (err: unknown) => err instanceof ApiError && (err as ApiError).statusCode === 502,
  );
  assert.equal((fetchImpl as any).mock.calls.length, 2);
});

test("approved sender helpers unwrap data and hit correct paths", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const responses = [
    {
      data: [{ id: 1, email: "a@acme.test", owned_by_application: true }],
      meta: { count: 1, total: 1, page: 1, per_page: 50, can_manage_approved_senders: true },
    },
    { data: { id: 9, email: "b@acme.test", status: "active", owned_by_application: true } },
    { data: { id: 9, email: "b@acme.test", status: "disabled", owned_by_application: true } },
    { data: { id: 9, email: "b@acme.test", deleted: true } },
  ];
  let i = 0;
  const fetchImpl = mock.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method ?? "GET") });
    const body = responses[i];
    const status = i === 1 ? 201 : 200;
    i += 1;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const client = new Client(KEY, {
    baseUrl: "https://mail.example.com",
    fetch: fetchImpl,
    maxRetries: 0,
  });

  const list = await client.listApprovedSenders();
  assert.ok(Array.isArray(list.data));
  assert.match(calls[0].url, /\/api\/v1\/approved-senders\?/);

  const created = await client.createApprovedSender({ email: "b@acme.test" });
  assert.equal(created.id, 9);
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].url, /\/api\/v1\/approved-senders$/);

  const updated = await client.updateApprovedSender(9, { status: "disabled" });
  assert.equal(updated.status, "disabled");
  assert.equal(calls[2].method, "PATCH");
  assert.match(calls[2].url, /\/api\/v1\/approved-senders\/9$/);

  const deleted = await client.deleteApprovedSender(9);
  assert.equal(deleted.deleted, true);
  assert.equal(calls[3].method, "DELETE");
});
