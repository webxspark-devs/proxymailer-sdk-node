import {
  ApiError,
  AuthenticationError,
  ProxyMailerError,
  RateLimitError,
  ValidationError,
} from "./errors.js";
import { SendResult } from "./send-result.js";
import type {
  Attachment,
  ClientOptions,
  EmailGroup,
  GroupList,
  MappingGraph,
  SendMessage,
  SendResponseBody,
} from "./types.js";

const VERSION = "1.0.0";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayMs(attempt: number, base = 250, max = 8000): number {
  const exp = base * 2 ** Math.max(0, attempt);
  const jitter = exp * Math.random() * 0.25;
  return Math.min(max, exp + jitter);
}

function shouldRetry(attempt: number, maxRetries: number, status: number): boolean {
  if (attempt >= maxRetries) return false;
  return [408, 425, 429, 500, 502, 503, 504].includes(status) || status === 0;
}

function isSyncFailure(status: number, body: SendResponseBody): boolean {
  return status === 502 && body.id != null && body.status != null;
}

function isTerminal(status: number, body: SendResponseBody): boolean {
  return (status >= 200 && status < 300) || isSyncFailure(status, body);
}

/** Minimal extension → MIME map (keeps the SDK dependency-free). */
function guessContentType(ext: string): string {
  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".csv": "text/csv",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".zip": "application/zip",
    ".xml": "application/xml",
    ".md": "text/markdown",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * Official ProxyMailer Node.js SDK client.
 */
export class Client {
  static readonly VERSION = VERSION;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(apiKey: string, options: ClientOptions = {}) {
    const key = apiKey.trim();
    if (!key.startsWith("pm_live_")) {
      throw new TypeError("API key must be a ProxyMailer key starting with pm_live_.");
    }
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? "https://proxymailer.wxp.app").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetch ?? fetch;
    this.userAgent = options.userAgent ?? `proxymailer-node/${VERSION}`;
  }

  async send(message: SendMessage): Promise<SendResult> {
    const payload = this.normalize(message);
    let attempt = 0;

    while (true) {
      try {
        const { status, body, retryAfter } = await this.postJson(payload);
        if (isTerminal(status, body)) {
          return SendResult.fromResponse(body, status);
        }
        if (shouldRetry(attempt, this.maxRetries, status) && !isSyncFailure(status, body)) {
          attempt += 1;
          const wait =
            status === 429 && retryAfter != null
              ? retryAfter * 1000
              : delayMs(attempt);
          await sleep(wait);
          continue;
        }
        this.throwForStatus(status, body, retryAfter);
      } catch (err) {
        if (err instanceof ProxyMailerError && !(err instanceof RateLimitError)) {
          throw err;
        }
        if (err instanceof RateLimitError) {
          if (!shouldRetry(attempt, this.maxRetries, 429)) throw err;
          attempt += 1;
          await sleep((err.retryAfterSeconds ?? delayMs(attempt) / 1000) * 1000);
          continue;
        }
        if (!shouldRetry(attempt, this.maxRetries, 0)) {
          throw new ApiError(
            `Transport error: ${err instanceof Error ? err.message : String(err)}`,
            0,
          );
        }
        attempt += 1;
        await sleep(delayMs(attempt));
      }
    }
  }

  static attachmentFromBytes(
    filename: string,
    bytes: Buffer | Uint8Array | string,
    contentType = "application/octet-stream",
  ): Attachment {
    const buf =
      typeof bytes === "string"
        ? Buffer.from(bytes)
        : Buffer.isBuffer(bytes)
          ? bytes
          : Buffer.from(bytes);
    return {
      filename,
      content_type: contentType,
      content: buf.toString("base64"),
    };
  }

  static async attachmentFromPath(
    path: string,
    filename?: string,
    contentType?: string,
  ): Promise<Attachment> {
    const fs = await import("node:fs/promises");
    const { basename, extname } = await import("node:path");
    const bytes = await fs.readFile(path);
    return Client.attachmentFromBytes(
      filename ?? basename(path),
      bytes,
      contentType ?? guessContentType(extname(path)),
    );
  }

  /** List email groups for this API key's organization (read-only). */
  async listGroups(): Promise<GroupList> {
    const body = await this.getJson("/api/v1/groups");
    return body as GroupList;
  }

  /** Fetch one email group including resolved recipients. */
  async getGroup(groupId: number): Promise<EmailGroup> {
    const body = await this.getJson(`/api/v1/groups/${groupId}`);
    return ((body.data as EmailGroup) ?? body) as EmailGroup;
  }

  /**
   * Fetch the tenant group/alias mapping graph for mail-client visualization.
   * Nodes/edges use source/target so React Flow / Cytoscape / D3 work directly.
   */
  async getMappings(): Promise<MappingGraph> {
    const body = await this.getJson("/api/v1/mappings");
    return body as MappingGraph;
  }

  /** List approved senders this application registered (requires admin opt-in). */
  async listApprovedSenders(
    page = 1,
    perPage = 50,
  ): Promise<{ data: Record<string, unknown>[]; meta: Record<string, unknown> }> {
    const qs = new URLSearchParams({
      page: String(Math.max(1, page)),
      per_page: String(Math.min(100, Math.max(1, perPage))),
    });
    const body = await this.getJson(`/api/v1/approved-senders?${qs}`);
    return body as { data: Record<string, unknown>[]; meta: Record<string, unknown> };
  }

  async getApprovedSender(senderId: number): Promise<Record<string, unknown>> {
    const body = await this.getJson(`/api/v1/approved-senders/${senderId}`);
    return ((body.data as Record<string, unknown>) ?? body) as Record<string, unknown>;
  }

  async createApprovedSender(payload: {
    email: string;
    display_name?: string | null;
    sending_domain_id?: number | null;
  }): Promise<Record<string, unknown>> {
    const body = await this.writeJson("POST", "/api/v1/approved-senders", payload);
    return ((body.data as Record<string, unknown>) ?? body) as Record<string, unknown>;
  }

  async updateApprovedSender(
    senderId: number,
    payload: {
      display_name?: string | null;
      status?: string;
      sending_domain_id?: number | null;
    },
  ): Promise<Record<string, unknown>> {
    const body = await this.writeJson("PATCH", `/api/v1/approved-senders/${senderId}`, payload);
    return ((body.data as Record<string, unknown>) ?? body) as Record<string, unknown>;
  }

  async deleteApprovedSender(senderId: number): Promise<Record<string, unknown>> {
    const body = await this.writeJson("DELETE", `/api/v1/approved-senders/${senderId}`, null);
    return ((body.data as Record<string, unknown>) ?? body) as Record<string, unknown>;
  }

  private normalize(message: SendMessage): Record<string, unknown> {
    if (message.from == null || message.from === "") {
      throw new ValidationError("`from` is required.");
    }
    if (
      message.to == null ||
      message.to === "" ||
      (Array.isArray(message.to) && message.to.length === 0)
    ) {
      throw new ValidationError("`to` is required.");
    }

    const payload: Record<string, unknown> = {
      from: message.from,
      to: message.to,
      stream: message.stream ?? "transactional",
    };

    for (const field of ["subject", "text", "html"] as const) {
      if (message[field] != null) payload[field] = message[field];
    }
    for (const field of ["cc", "bcc", "meta", "attachments"] as const) {
      const value = message[field];
      if (value != null && !(Array.isArray(value) && value.length === 0)) {
        payload[field] = value;
      }
    }
    if (message.sync != null) payload.sync = Boolean(message.sync);

    return payload;
  }

  private async postJson(payload: Record<string, unknown>): Promise<{
    status: number;
    body: SendResponseBody;
    retryAfter: number | null;
  }> {
    return this.requestJson("POST", "/api/v1/send", payload);
  }

  private async getJson(path: string): Promise<Record<string, unknown>> {
    const { status, body } = await this.requestJson("GET", path, null);
    if (status < 200 || status >= 300) {
      this.throwForStatus(status, body as SendResponseBody, null);
    }
    return body as Record<string, unknown>;
  }

  private async writeJson(
    method: string,
    path: string,
    payload: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const { status, body } = await this.requestJson(method, path, payload);
    if (status < 200 || status >= 300) {
      this.throwForStatus(status, body as SendResponseBody, null);
    }
    return body as Record<string, unknown>;
  }

  private async requestJson(
    method: string,
    path: string,
    payload: Record<string, unknown> | null,
  ): Promise<{
    status: number;
    body: SendResponseBody;
    retryAfter: number | null;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "User-Agent": this.userAgent,
        "X-ProxyMailer-Client": this.userAgent,
        "X-Request-Id": crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      };
      if (payload !== null) {
        headers["Content-Type"] = "application/json";
      }
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: payload !== null ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let body: SendResponseBody = {};
      if (text) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            body = parsed as SendResponseBody;
          } else {
            body = { message: text };
          }
        } catch {
          body = { message: text };
        }
      }
      const retryHeader = res.headers.get("retry-after");
      const retryAfter =
        retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : null;
      return { status: res.status, body, retryAfter };
    } finally {
      clearTimeout(timer);
    }
  }

  private throwForStatus(
    status: number,
    body: SendResponseBody,
    retryAfter: number | null,
  ): never {
    const message = body.message ?? "ProxyMailer request failed";
    if (status === 401 || status === 403) {
      throw new AuthenticationError(message, status, body as Record<string, unknown>);
    }
    if (status === 422) {
      throw new ValidationError(message, body.errors ?? {}, status);
    }
    if (status === 429) {
      throw new RateLimitError(message, retryAfter, status);
    }
    throw new ApiError(message, status, body as Record<string, unknown>);
  }
}
