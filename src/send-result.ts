import type { SendResponseBody } from "./types.js";

export class SendResult {
  constructor(
    public readonly id: string,
    public readonly status: string,
    public readonly providerMessageId: string | null,
    public readonly attachmentCount: number,
    public readonly httpStatus: number,
  ) {}

  static fromResponse(body: SendResponseBody, httpStatus: number): SendResult {
    return new SendResult(
      String(body.id ?? ""),
      String(body.status ?? "unknown"),
      body.provider_message_id == null ? null : String(body.provider_message_id),
      Number(body.attachment_count ?? 0),
      httpStatus,
    );
  }

  isQueued(): boolean {
    return this.status === "queued";
  }

  isSent(): boolean {
    return this.status === "sent";
  }

  isFailed(): boolean {
    return this.status === "failed";
  }
}
