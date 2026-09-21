# ProxyMailer Node.js SDK

Official TypeScript / JavaScript client for the ProxyMailer application send API.

- **Package:** [`@proxymailer/sdk`](https://www.npmjs.com/package/@proxymailer/sdk)
- **Repository:** [webxspark-devs/proxymailer-sdk-node](https://github.com/webxspark-devs/proxymailer-sdk-node)
- **Production API origin:** `https://proxymailer.wxp.app`
- **Contract (OpenAPI):** [`proxy-mailer/sdks/openapi.yaml`](https://github.com/webxspark-devs/proxy-mailer/blob/main/sdks/openapi.yaml)
- **Full developer guide:** [docs/developers/sdks.md](https://github.com/webxspark-devs/proxy-mailer/blob/main/docs/developers/sdks.md)

ProxyMailer is a multi-tenant **BYOK email control plane**. Apps send to ProxyMailer over HTTP; delivery uses organization-owned Generic SMTP / ESP credentials.

---

## Requirements

| Item | Version / note |
| --- | --- |
| Node.js | **18+** (native `fetch`) |
| Module system | ESM (`"type": "module"`); TypeScript types included |

---

## Install

```bash
npm install @proxymailer/sdk
# pnpm add @proxymailer/sdk
# yarn add @proxymailer/sdk
```

---

## Configuration

### Production (always)

```bash
export PROXYMAILER_API_KEY=pm_live_…
export PROXYMAILER_BASE_URL=https://proxymailer.wxp.app
```

| Variable | Required | Rules |
| --- | --- | --- |
| `PROXYMAILER_API_KEY` | yes | Must start with `pm_live_` |
| `PROXYMAILER_BASE_URL` | strongly recommended | Origin only — **no** trailing slash, **no** `/api/v1`. Production: `https://proxymailer.wxp.app` |

Local override:

```bash
export PROXYMAILER_BASE_URL=http://localhost:8080
```

Never commit real keys. Log prefix only.

---

## Quick start

```ts
import {
  Client,
  ValidationError,
  AuthenticationError,
  RateLimitError,
  ApiError,
} from "@proxymailer/sdk";

const client = new Client(process.env.PROXYMAILER_API_KEY!, {
  baseUrl: process.env.PROXYMAILER_BASE_URL ?? "https://proxymailer.wxp.app",
  timeoutMs: 30_000,
  maxRetries: 3,
});

try {
  const result = await client.send({
    from: "Acme <noreply@acme.com>",
    to: ["user@example.com"],
    subject: "Welcome",
    html: "<p>Hello</p>",
    text: "Hello",
    stream: "transactional",
    meta: { user_id: "42" },
    attachments: [
      Client.attachmentFromBytes("note.txt", "hello", "text/plain"),
      await Client.attachmentFromPath("/tmp/invoice.pdf"),
    ],
  });

  console.log(result.id, result.status, result.isQueued());
  console.log(result.providerMessageId, result.attachmentCount, result.httpStatus);
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(err.errors);
  } else if (err instanceof AuthenticationError) {
    console.error("auth", err.statusCode);
  } else if (err instanceof RateLimitError) {
    console.error("rate limited", err.retryAfterSeconds);
  } else if (err instanceof ApiError) {
    console.error("api", err.statusCode, err.context);
  }
  throw err;
}
```

---

## `Client` / `ClientOptions`

```ts
new Client(apiKey: string, options?: ClientOptions)
```

| Option | Default | Notes |
| --- | --- | --- |
| `baseUrl` | `https://proxymailer.wxp.app` | Trailing `/` stripped |
| `timeoutMs` | `30000` | AbortController |
| `maxRetries` | `3` | `408`/`425`/`429`/`5xx` + transport |
| `fetch` | global `fetch` | Inject in tests |
| `userAgent` | `proxymailer-node/{VERSION}` | Also `X-ProxyMailer-Client` |

Invalid keys (not starting with `pm_live_`) throw `TypeError` before any network call.

Each attempt sends `Authorization: Bearer …`, `Accept: application/json`, `User-Agent`,
`X-ProxyMailer-Client`, and a fresh `X-Request-Id`.

---

## `send(message)`

| Field | Required | Type notes |
| --- | --- | --- |
| `from` | **yes** | `string` or `{ email?: string; address?: string; name?: string }` |
| `to` | **yes** | address or `Address[]` (groups/aliases allowed) |
| `cc` / `bcc` | no | same |
| `subject` / `text` / `html` | no | |
| `stream` | no | Defaults to **`transactional`** in the client |
| `meta` | no | `Record<string, unknown>` |
| `sync` | no | `boolean` — wait for provider attempt |
| `attachments` | no | max 10 |

### Streams

| Examples | Class | Queue | Weight |
| --- | --- | --- | --- |
| `transactional`, `otp`, `auth`, `alert`, `notification`, `receipt` | high | `mail-high` | 4 |
| `invoice`, `lifecycle`, `onboarding`, unmapped | normal | `mail-normal` | 2 |
| `marketing`, `newsletter`, `bulk`, `campaign`, `blast` | bulk | `mail-bulk` | 1 |

### `SendResult`

| Field | Meaning |
| --- | --- |
| `id` | Message UUID — **store this** |
| `status` | `queued` \| `sent` \| `failed` |
| `providerMessageId` | May be `null` on async accept |
| `attachmentCount` | Number accepted |
| `httpStatus` | `202`, or `502` for sync-failure body |
| `isQueued()` / `isSent()` / `isFailed()` | Helpers |

HTTP **502** responses that still include `{ id, status }` are returned as a failed
`SendResult` and are **not** retried as transport errors. There is no public
application `GET /messages/{id}` — use dashboard, webhooks, or `sync: true`.

---

## Attachments

```ts
Client.attachmentFromBytes("note.txt", "hello", "text/plain");
Client.attachmentFromBytes("bin.dat", Buffer.from([1, 2, 3]));
await Client.attachmentFromPath("/tmp/invoice.pdf"); // async; MIME guessed from extension
```

Emits Base64 in `content` (aliases `content_base64` / `filename`/`name` /
`content_type`/`type` accepted on the wire).

---

## Groups & mapping graph

```ts
const groups = await client.listGroups();
const group = await client.getGroup(12);
const { data, meta } = await client.getMappings();
// data.nodes / data.edges — React Flow / Cytoscape / D3 ready (source/target)
```

Tenant-scoped; cross-tenant → **404**. Read-only for application keys.

---

## Approved senders (opt-in)

Requires dashboard flag **Allow API to manage approved senders**.

```ts
await client.listApprovedSenders(1, 50);
await client.getApprovedSender(9);
await client.createApprovedSender({
  email: "user@acme.com",
  display_name: "User",
});
await client.updateApprovedSender(9, { status: "disabled" });
await client.deleteApprovedSender(9);
```

---

## Errors & retries

| HTTP | Class | Retried? |
| --- | --- | --- |
| `401` / `403` | `AuthenticationError` | No |
| `422` | `ValidationError` (`.errors`) | No |
| `429` | `RateLimitError` (`.retryAfterSeconds`) | Yes |
| `408` / `425` / `500` / `503` / `504` | `ApiError` | Yes |
| `502` + send body | `SendResult` failed | **No** |
| Other / network | `ApiError` | Yes |

Base: `ProxyMailerError` (`statusCode`, `context`). Backoff ~250ms × 2^n + jitter, cap ~8s.

---

## Testing / build

```bash
npm ci
npm test
npm run build
```

---

## Versioning & publishing

SemVer. Align major bumps with PHP / Python SDKs and OpenAPI when the wire format
breaks. npm publishes from **this** repo’s CI. Maintainer notes:
[publishing.md](https://github.com/webxspark-devs/proxy-mailer/blob/main/docs/developers/publishing.md).

---

## Related docs

- [Authentication](https://github.com/webxspark-devs/proxy-mailer/blob/main/docs/developers/authentication.md)
- [Sending](https://github.com/webxspark-devs/proxy-mailer/blob/main/docs/developers/sending.md)
- [Groups](https://github.com/webxspark-devs/proxy-mailer/blob/main/docs/developers/groups.md)
- [Approved senders](https://github.com/webxspark-devs/proxy-mailer/blob/main/docs/developers/approved-senders.md)
- [Errors](https://github.com/webxspark-devs/proxy-mailer/blob/main/docs/developers/errors.md)
