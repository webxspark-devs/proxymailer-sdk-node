# ProxyMailer Node.js SDK

Official TypeScript/JavaScript client for the ProxyMailer application send API.

## Install

```bash
npm install @proxymailer/sdk
```

Requires Node.js 18+ (native `fetch`).

## Usage

```ts
import { Client } from "@proxymailer/sdk";

const client = new Client(process.env.PROXYMAILER_API_KEY!, {
  baseUrl: process.env.PROXYMAILER_BASE_URL ?? "https://mail.example.com",
});

const result = await client.send({
  from: "Acme <noreply@acme.com>",
  to: ["user@example.com"],
  subject: "Welcome",
  html: "<p>Hello</p>",
  text: "Hello",
  attachments: [
    Client.attachmentFromBytes("note.txt", "hello", "text/plain"),
  ],
});

console.log(result.id, result.status);

// Read-only groups + visualization graph (tenant-scoped)
const groups = await client.listGroups();
const { data } = await client.getMappings(); // data.nodes / data.edges
```

See [`docs/developers`](../../docs/developers/README.md) for the full guide, including [groups & mappings](../../docs/developers/groups.md).

## Publishing (maintainers)

To release `@proxymailer/sdk` on **npm**:

```bash
cd sdks/node
npm ci && npm test && npm run build
npm publish --access public --dry-run   # inspect tarball
npm publish --access public
```

Full checklist (tokens, CI, versioning): [`docs/developers/publishing.md`](../../docs/developers/publishing.md#2-nodejs--npm).
