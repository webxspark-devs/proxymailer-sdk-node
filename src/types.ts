export type Address =
  | string
  | {
      email?: string;
      address?: string;
      name?: string;
    };

export type Attachment = {
  filename?: string;
  name?: string;
  content_type?: string;
  type?: string;
  /** Base64-encoded file bytes */
  content?: string;
  /** Alias of content */
  content_base64?: string;
};

export type SendMessage = {
  from: Address;
  to: Address | Address[];
  cc?: Address | Address[];
  bcc?: Address | Address[];
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  stream?: string | null;
  meta?: Record<string, unknown> | null;
  sync?: boolean | null;
  attachments?: Attachment[] | null;
};

export type ClientOptions = {
  /** ProxyMailer base URL without trailing slash */
  baseUrl?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Max transport / 5xx / 429 retries */
  maxRetries?: number;
  /** Override fetch implementation (tests) */
  fetch?: typeof fetch;
  /** Custom User-Agent */
  userAgent?: string;
};

export type SendResponseBody = {
  id?: string;
  status?: string;
  provider_message_id?: string | null;
  attachment_count?: number;
  message?: string;
  errors?: Record<string, string[]>;
};

/** Direct + resolved group payload from GET /api/v1/groups */
export type EmailGroup = {
  id: number;
  name: string;
  description?: string | null;
  identifier_email: string;
  status: "active" | "disabled" | string;
  member_count: number;
  resolved_count: number;
  members: string[];
  resolved_recipients: string[];
  created_at?: string;
  updated_at?: string;
  resolution_error?: string;
};

export type MappingNodeType = "group" | "alias" | "mailbox";

/**
 * Graph node for mail-client visualization (React Flow / Cytoscape / D3).
 * `id` is stable: `group:{id}`, `alias:{id}`, or `mailbox:{email}`.
 */
export type MappingNode = {
  id: string;
  type: MappingNodeType;
  label: string;
  email?: string;
  status?: string;
  description?: string | null;
  member_count?: number;
  resolved_count?: number;
  members?: string[];
  resolved_recipients?: string[];
  target_email?: string;
};

/** Directed edge — `source`/`target` are MappingNode.id values. */
export type MappingEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
};

export type MappingGraph = {
  data: {
    nodes: MappingNode[];
    edges: MappingEdge[];
  };
  meta: {
    group_count: number;
    alias_count: number;
    mailbox_count: number;
    edge_count: number;
    [key: string]: number;
  };
};

export type GroupList = {
  data: EmailGroup[];
  meta: { count: number; [key: string]: unknown };
};
