// Type definitions for the MailKite SDK.

export interface Attachment {
  filename: string;
  url?: string;
  content?: string;
  contentType?: string;
}

export type TemplateData = Record<string, string | number | boolean | null>;

export interface SendMessage {
  from: string;
  to: string | string[];
  /** Required unless supplied by a template. */
  subject?: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  inReplyTo?: string;
  attachments?: Attachment[];
  /** Send from a saved template — a user template (tpl_…) or base template (base_…). */
  templateId?: string;
  /** Values substituted into the template's {{merge_tags}}; HTML values are auto-escaped. */
  templateData?: TemplateData;
}

export interface SendResult {
  id: string;
  status: string;
}

export interface AgentMessage {
  /** The message for the agent — it reads this as the incoming email body and decides what to do. */
  text: string;
  /** Optional subject line the agent sees on the message. */
  subject?: string;
  /** Optional sender address the agent sees as the originator. Defaults to the account's API caller address. */
  from?: string;
  /** Optional HTML body. `text` is still required — the agent reasons over the plain-text content. */
  html?: string;
  /** Target a specific agent by its route id (rte_…). Omit to use the account's default agent. */
  routeId?: string;
  /** Target the agent whose route matches this address. Alternative to routeId. */
  address?: string;
  /** Override the model the agent runs on for this call (e.g. claude-sonnet-4-6). */
  model?: string;
}

export interface AgentResult {
  /** Whether the agent ran to completion. */
  ok: boolean;
  /** The agent's reply — its final message after running. */
  text?: string;
  /** Id of the stored message the agent processed (msg_…). */
  messageId?: string;
  /** Error detail when `ok` is false. */
  error?: string;
}

export interface RouteMessage {
  /** Sender address recorded on the message. */
  from: string;
  /** Target route by id (rte_…). One of routeId or address is required. */
  routeId?: string;
  /** Target route by the address it matches. One of routeId or address is required. */
  address?: string;
  /** Optional subject line. */
  subject?: string;
  /** Plain-text body. */
  text?: string;
  /** HTML body. */
  html?: string;
}

export interface RouteResult {
  /** Stored message id (msg_…). */
  id: string;
  /** Whether the message was handed to the route's action. */
  routed: boolean;
  /** The action the matched route performed: webhook, forward, agent, store, or drop. */
  action: string;
}

export interface TemplateMeta {
  id: string;
  name: string;
  category: string;
  subject: string;
  is_base: number;
  updated_at: number;
}

export interface CreateTemplateRequest {
  /** Clone this base template (base_…) into your own; name optional when set. */
  baseId?: string;
  name?: string;
  subject?: string;
  html?: string;
  text?: string;
  json?: string;
  theme?: string;
}

export interface RegistrantContact {
  firstName: string;
  lastName: string;
  email: string;
  /** E.164-ish, +<cc>.<number>, e.g. "+1.4155551234". */
  phone: string;
  address: string;
  city: string;
  zip: string;
  /** ISO 3166-1 alpha-2, e.g. "US". */
  country: string;
  /** ISO 3166-2 subdivision, e.g. "US-CA". */
  state?: string;
  organization?: string;
  type?: "individual" | "company" | "association" | "publicbody";
}

export interface RegisterDomainRequest {
  domain: string;
  contact: RegistrantContact;
  /** Registration term in years; defaults to 1. */
  years?: number;
  /** Validate without charging/registering (testing/preview). */
  dryRun?: boolean;
}

export interface UploadAttachmentRequest {
  /** Shown to recipients on download. Optional when derivable from `path`/`url`. */
  filename?: string;
  /** Local file path — read off disk and streamed as raw bytes (Node/CLI only). */
  path?: string;
  /** Raw file bytes — streamed as a binary upload. */
  bytes?: Uint8Array | Buffer;
  /** Remote http(s) URL — MailKite fetches and re-hosts it. */
  url?: string;
  /** base64-encoded file bytes (lowest-common-denominator fallback). */
  content?: string;
  contentType?: string;
  /** 7 | 30 | 90 | 365, default 7 */
  retentionDays?: number;
}

export interface UploadAttachmentResult {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
  expiresAt: string;
}

export interface CreateListRequest {
  name: string;
}

export interface UpdateListRequest {
  name: string;
}

export interface AddListContactsRequest {
  /** Contact ids (ctr_…) to add. */
  contactIds: string[];
}

/** Who a broadcast goes to: every subscribed contact, or one list. */
export interface BroadcastAudience {
  type: "all" | "list" | "filter";
  /** List id (lst_…) when `type` is "list". */
  id?: string;
  /** Saved-segment query when `type` is "filter". */
  query?: string;
}

export interface CreateBroadcastRequest {
  /** Sender address on a verified domain. Required. */
  from: string;
  name?: string;
  replyTo?: string;
  subject?: string;
  preview?: string;
  audience?: BroadcastAudience;
  templateId?: string;
  html?: string;
  text?: string;
  footerAddress?: string;
}

/** Draft edits — all fields optional. */
export type UpdateBroadcastRequest = Partial<CreateBroadcastRequest>;

export interface SendBroadcastRequest {
  /** ISO 8601 timestamp to schedule the send; omit to send now. */
  scheduledAt?: string;
}

export class MailKiteError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown);
}

export class MailKite {
  apiKey: string;
  baseUrl: string;
  constructor(apiKey: string, baseUrl?: string);

  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  requestBinary<T = unknown>(
    method: string,
    path: string,
    bytes: Uint8Array | Buffer,
    meta?: { filename?: string; contentType?: string; retentionDays?: number },
  ): Promise<T>;

  send(message: SendMessage): Promise<SendResult>;

  /**
   * Upload a file and get back a secure, time-limited URL to reference as a send()
   * attachment ({ filename, url }) or link inline. Give the file ONE of four ways:
   * `path` (local file → raw bytes), `bytes` (Buffer/Uint8Array → raw bytes),
   * `url` (remote file MailKite re-hosts), or base64 `content` (fallback).
   */
  uploadAttachment(file: UploadAttachmentRequest): Promise<UploadAttachmentResult>;

  agent(message: AgentMessage): Promise<AgentResult>;
  route(message: RouteMessage): Promise<RouteResult>;

  listTemplates(): Promise<TemplateMeta[]>;
  listBaseTemplates(): Promise<TemplateMeta[]>;
  getTemplate(id: string): Promise<unknown>;
  createTemplate(body: CreateTemplateRequest): Promise<unknown>;

  listDomains(): Promise<unknown>;
  createDomain(body: { domain: string }): Promise<unknown>;
  getDomain(id: string): Promise<unknown>;
  deleteDomain(id: string): Promise<unknown>;
  verifyDomain(id: string): Promise<unknown>;
  setWebhook(id: string, body: { url: string }): Promise<unknown>;
  deleteWebhook(id: string): Promise<unknown>;
  testWebhook(id: string): Promise<unknown>;
  checkDomainAvailability(domain: string): Promise<unknown>;
  registerDomain(body: RegisterDomainRequest): Promise<unknown>;

  listRoutes(): Promise<unknown>;
  createRoute(body: { match: string; action: string; destination: string }): Promise<unknown>;

  listMessages(before?: number, limit?: number): Promise<unknown>;
  getMessage(id: string): Promise<unknown>;
  retryDelivery(id: string): Promise<unknown>;

  /** Semantic search over the MailKite docs. Public — no auth required. */
  semanticSearch(query: string): Promise<{
    query: string;
    matches: Array<{
      slug: string;
      title: string;
      section?: string;
      snippet: string;
      score?: number;
    }>;
  }>;

  /**
   * Verify the `x-mailkite-signature` header on an inbound webhook delivery.
   * Local HMAC-SHA256 check (no network call). Pass the raw, unparsed body.
   * @param toleranceMs reject events older than this many ms (default 300000; 0 disables).
   */
  verifyWebhook(
    signature: string,
    payload: string | Uint8Array,
    secret: string,
    toleranceMs?: number
  ): boolean;
  static verifyWebhook(
    signature: string,
    payload: string | Uint8Array,
    secret: string,
    toleranceMs?: number
  ): boolean;

  /**
   * The exact body a webhook consumer returns to acknowledge a delivery in
   * `ack` mode: the string `{"status":"ok"}`. Local — no network call.
   */
  replyOk(): string;
  static replyOk(): string;

  /**
   * Control-mode reply telling MailKite to mark the message as spam:
   * the string `{"status":"spam"}`. Local — no network call.
   */
  replySpam(): string;
  static replySpam(): string;

  /**
   * Control-mode reply telling MailKite to drop (discard) the message:
   * the string `{"status":"drop"}`. Local — no network call.
   */
  replyDrop(): string;
  static replyDrop(): string;

  /**
   * Control-mode reply telling MailKite to block the sender:
   * the string `{"status":"ok","actions":[{"type":"block-sender"}]}`. Local — no network call.
   */
  replyBlockSender(): string;
  static replyBlockSender(): string;

  /**
   * Encrypt a UTF-8 string to MailKite's at-rest envelope (a JSON string).
   * Wraps a fresh AES-256-GCM content key with the customer's RSA-OAEP-256
   * SPKI/PEM public key. Local — no network call.
   * @param publicKey RSA public key, SPKI/PEM (-----BEGIN PUBLIC KEY-----).
   */
  encrypt(plaintext: string, publicKey: string): string;
  static encrypt(plaintext: string, publicKey: string): string;

  /**
   * Decrypt an at-rest envelope back to the original UTF-8 string. Local.
   * @param envelope the JSON envelope string from `encrypt`/MailKite.
   * @param privateKey RSA private key, PKCS8/PEM (-----BEGIN PRIVATE KEY-----).
   */
  decrypt(envelope: string, privateKey: string): string;
  static decrypt(envelope: string, privateKey: string): string;
}

export default MailKite;
