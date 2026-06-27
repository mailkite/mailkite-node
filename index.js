// MailKite SDK for Node.js.
//
// Shape shared by every MailKite SDK: one low-level `request()` plus one thin
// method per API endpoint. Construct with your API key (mk_live_… for sending,
// or a session token for the management API).
//
//   import { MailKite } from "mailkite";
//   const mk = new MailKite(process.env.MAILKITE_API_KEY);
//   const { id } = await mk.send({ from, to, subject, text });

import crypto from "node:crypto";

const DEFAULT_BASE_URL = "https://api.mailkite.dev";

// Reject webhook events older than this (ms) to block replays. Pass 0 to disable.
const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

export class MailKiteError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = "MailKiteError";
    this.status = status;
    this.body = body;
  }
}

export class MailKite {
  constructor(apiKey, baseUrl = DEFAULT_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
  }

  // Low-level request. Every method below is a one-liner on top of this.
  async request(method, path, body) {
    const headers = { Authorization: `Bearer ${this.apiKey}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    return this._handle(res);
  }

  // Low-level RAW binary request — the file bytes ARE the body (like an S3/R2 PUT),
  // metadata rides in the query string + Content-Type header. Used by uploadAttachment.
  async requestBinary(method, path, bytes, { filename, contentType, retentionDays } = {}) {
    const q = new URLSearchParams({ filename: filename || "file" });
    if (retentionDays != null) q.set("retentionDays", String(retentionDays));
    const res = await fetch(`${this.baseUrl}${path}?${q.toString()}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": contentType || "application/octet-stream",
      },
      body: bytes,
    });
    return this._handle(res);
  }

  async _handle(res) {
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = (data && data.error) || res.statusText || `HTTP ${res.status}`;
      throw new MailKiteError(res.status, message, data);
    }
    return data;
  }

  // --- Sending --------------------------------------------------------------
  // Pass `templateId` (a tpl_… or base_…) + optional `templateData` to send from a template.
  send(message) {
    return this.request("POST", "/v1/send", message);
  }

  // Upload a file and get back a secure, time-limited URL to reference as a send()
  // attachment ({ filename, url }) or link inline — instead of base64-inlining large
  // files on every send. Give the file ONE of four ways:
  //   { path }     local file — read and streamed as raw bytes (the happy path)
  //   { bytes }    a Buffer/Uint8Array — streamed as raw bytes
  //   { url }      a remote URL — MailKite fetches and re-hosts it
  //   { content }  base64 string — decoded server-side (lowest-common-denominator fallback)
  // `path`/`bytes` go up as a real binary upload; `url`/`content` as JSON.
  async uploadAttachment(file) {
    const { filename, content, url, path: filePath, bytes, contentType, retentionDays } = file || {};

    // JSON: ask the server to fetch & re-host a remote file.
    if (url) return this.request("POST", "/v1/attachments", trimUndefined({ url, filename, contentType, retentionDays }));

    // Binary: raw bytes, or a local path we read off disk.
    if (bytes != null || filePath != null) {
      let data = bytes;
      let name = filename;
      let type = contentType;
      if (data == null) {
        const fs = await import("node:fs/promises");
        data = await fs.readFile(filePath);
        name = name || filePath.split(/[\\/]/).pop();
        type = type || guessContentType(name);
      }
      return this.requestBinary("POST", "/v1/attachments", data, { filename: name, contentType: type, retentionDays });
    }

    // JSON: base64 content fallback.
    if (content != null) return this.request("POST", "/v1/attachments", trimUndefined({ content, filename, contentType, retentionDays }));

    throw new MailKiteError(0, "uploadAttachment needs one of: path, bytes, url, or base64 content");
  }

  // --- Agent ----------------------------------------------------------------
  // Hand a message to an agent route and run it. Target a specific agent with
  // `routeId`/`address`, or omit both to use the account's default agent.
  agent(message) {
    return this.request("POST", "/v1/agent", message);
  }
  // Deliver a message through a registered route (one of routeId/address required).
  route(message) {
    return this.request("POST", "/v1/route", message);
  }

  // --- Templates ------------------------------------------------------------
  // List your saved templates (light metadata only). Use getTemplate(id) for the full body.
  listTemplates() {
    return this.request("GET", "/api/templates");
  }
  // List the premade base templates (light metadata). Clone with createTemplate({ baseId }).
  listBaseTemplates() {
    return this.request("GET", "/api/templates/base");
  }
  // Get one template (full: subject, html, text, theme). Works for tpl_… and base_… ids.
  getTemplate(id) {
    return this.request("GET", `/api/templates/${encodeURIComponent(id)}`);
  }
  // Create a template — pass { baseId } to clone a base, or name/subject/html/text/theme directly.
  createTemplate(body) {
    return this.request("POST", "/api/templates", body);
  }

  // --- Domains --------------------------------------------------------------
  listDomains() {
    return this.request("GET", "/api/domains");
  }
  createDomain(body) {
    return this.request("POST", "/api/domains", body);
  }
  getDomain(id) {
    return this.request("GET", `/api/domains/${encodeURIComponent(id)}`);
  }
  deleteDomain(id) {
    return this.request("DELETE", `/api/domains/${encodeURIComponent(id)}`);
  }
  verifyDomain(id) {
    return this.request("POST", `/api/domains/${encodeURIComponent(id)}/verify`);
  }
  setWebhook(id, body) {
    return this.request("PUT", `/api/domains/${encodeURIComponent(id)}/webhook`, body);
  }
  deleteWebhook(id) {
    return this.request("DELETE", `/api/domains/${encodeURIComponent(id)}/webhook`);
  }
  testWebhook(id) {
    return this.request("POST", `/api/domains/${encodeURIComponent(id)}/webhook/test`);
  }
  // Check whether a domain is available to register, and at what price. Read-only — no charge.
  checkDomainAvailability(domain) {
    return this.request("GET", `/api/domains/register/check?domain=${encodeURIComponent(domain)}`);
  }
  // Register (buy) a domain: provisions mail DNS and adds it to the account in one call. Charges.
  registerDomain(body) {
    return this.request("POST", "/api/domains/register", body);
  }

  // --- Routes ---------------------------------------------------------------
  listRoutes() {
    return this.request("GET", "/api/routes");
  }
  createRoute(body) {
    return this.request("POST", "/api/routes", body);
  }

  // --- Messages & deliveries ------------------------------------------------
  listMessages() {
    return this.request("GET", "/api/messages");
  }
  getMessage(id) {
    return this.request("GET", `/api/messages/${encodeURIComponent(id)}`);
  }
  retryDelivery(id) {
    return this.request("POST", `/api/deliveries/${encodeURIComponent(id)}/retry`);
  }

  // --- Lists ----------------------------------------------------------------
  // Static, curated contact lists you can target with a broadcast.
  listLists() {
    return this.request("GET", "/api/lists");
  }
  createList(body) {
    return this.request("POST", "/api/lists", body);
  }
  getList(id) {
    return this.request("GET", `/api/lists/${encodeURIComponent(id)}`);
  }
  updateList(id, body) {
    return this.request("PATCH", `/api/lists/${encodeURIComponent(id)}`, body);
  }
  deleteList(id) {
    return this.request("DELETE", `/api/lists/${encodeURIComponent(id)}`);
  }
  listListContacts(id) {
    return this.request("GET", `/api/lists/${encodeURIComponent(id)}/contacts`);
  }
  addListContacts(id, body) {
    return this.request("POST", `/api/lists/${encodeURIComponent(id)}/contacts`, body);
  }
  removeListContact(id, contactId) {
    return this.request("DELETE", `/api/lists/${encodeURIComponent(id)}/contacts/${encodeURIComponent(contactId)}`);
  }

  // --- Broadcasts -----------------------------------------------------------
  // One-to-many sends to a list audience; every send carries a one-click unsubscribe.
  listBroadcasts() {
    return this.request("GET", "/api/broadcasts");
  }
  createBroadcast(body) {
    return this.request("POST", "/api/broadcasts", body);
  }
  getBroadcast(id) {
    return this.request("GET", `/api/broadcasts/${encodeURIComponent(id)}`);
  }
  updateBroadcast(id, body) {
    return this.request("PATCH", `/api/broadcasts/${encodeURIComponent(id)}`, body);
  }
  deleteBroadcast(id) {
    return this.request("DELETE", `/api/broadcasts/${encodeURIComponent(id)}`);
  }
  sendBroadcast(id, body) {
    return this.request("POST", `/api/broadcasts/${encodeURIComponent(id)}/send`, body);
  }

  // --- Webhooks -------------------------------------------------------------
  // Verify the `x-mailkite-signature` header on an inbound delivery. This is a
  // local HMAC check — no API key or network call needed — so you can call it
  // on a throwaway client (`new MailKite("")`) or use the static form below.
  //
  // Pass the raw, unparsed request body: the signature is over the exact bytes,
  // so a parsed-and-re-serialized object will not match.
  verifyWebhook(signature, payload, secret, toleranceMs = DEFAULT_TOLERANCE_MS) {
    return MailKite.verifyWebhook(signature, payload, secret, toleranceMs);
  }

  static verifyWebhook(signature, payload, secret, toleranceMs = DEFAULT_TOLERANCE_MS) {
    if (typeof signature !== "string" || !signature) return false;

    const parts = {};
    for (const seg of signature.split(",")) {
      const i = seg.indexOf("=");
      if (i !== -1) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
    }
    const t = Number(parts.t);
    if (!parts.t || !parts.v1 || !Number.isFinite(t)) return false;

    // Reject stale events (the t in the header is milliseconds since the epoch).
    if (toleranceMs > 0 && Math.abs(Date.now() - t) > toleranceMs) return false;

    // HMAC-SHA256(secret, "<t>." + rawBody) as lowercase hex.
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${parts.t}.`)
      .update(typeof payload === "string" ? Buffer.from(payload, "utf8") : payload)
      .digest("hex");

    // Constant-time compare.
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(parts.v1, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // The exact body a webhook consumer returns to acknowledge a delivery in `ack`
  // mode. Local — no network, no API key — so it works on a throwaway client or
  // via the static form below.
  replyOk() {
    return MailKite.replyOk();
  }

  static replyOk() {
    return '{"status":"ok"}';
  }

  // Control-mode reply: tell MailKite to mark the message as spam.
  replySpam() {
    return MailKite.replySpam();
  }

  static replySpam() {
    return '{"status":"spam"}';
  }

  // Control-mode reply: tell MailKite to drop (discard) the message.
  replyDrop() {
    return MailKite.replyDrop();
  }

  static replyDrop() {
    return '{"status":"drop"}';
  }

  // Control-mode reply: tell MailKite to block the sender.
  replyBlockSender() {
    return MailKite.replyBlockSender();
  }

  static replyBlockSender() {
    return '{"status":"ok","actions":[{"type":"block-sender"}]}';
  }

  // --- At-rest encryption ---------------------------------------------------
  // Hybrid envelope matching MailKite's at-rest encryption (RSA-OAEP-256 wraps a
  // fresh AES-256-GCM content key). All local — encrypt with the customer's SPKI
  // public key, decrypt with the matching PKCS8 private key. Static + instance.
  encrypt(plaintext, publicKey) {
    return MailKite.encrypt(plaintext, publicKey);
  }

  static encrypt(plaintext, publicKey) {
    const der = pemToDer(publicKey);
    const fp = crypto.createHash("sha256").update(der).digest("hex");

    // Fresh AES-256-GCM content key + 12-byte IV.
    const contentKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", contentKey, iv);
    const body = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf8")),
      cipher.final(),
    ]);
    // WebCrypto convention: the GCM auth tag is appended to the ciphertext.
    const ciphertext = Buffer.concat([body, cipher.getAuthTag()]);

    // Wrap the raw AES key with RSA-OAEP (SHA-256 for both OAEP hash and MGF1).
    const wrappedKey = crypto.publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      contentKey,
    );

    return JSON.stringify({
      v: 1,
      keyAlg: "RSA-OAEP-256",
      fp,
      enc: "A256GCM",
      iv: iv.toString("base64"),
      wrappedKey: wrappedKey.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    });
  }

  decrypt(envelope, privateKey) {
    return MailKite.decrypt(envelope, privateKey);
  }

  static decrypt(envelope, privateKey) {
    const env = typeof envelope === "string" ? JSON.parse(envelope) : envelope;

    // Unwrap the AES content key with RSA-OAEP (SHA-256).
    const contentKey = crypto.privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(env.wrappedKey, "base64"),
    );

    // Split the ciphertext into body + trailing 16-byte GCM auth tag.
    const ct = Buffer.from(env.ciphertext, "base64");
    const body = ct.subarray(0, ct.length - 16);
    const tag = ct.subarray(ct.length - 16);

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      contentKey,
      Buffer.from(env.iv, "base64"),
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  }
}

// Drop undefined-valued keys so we never serialize `"contentType":undefined` etc.
function trimUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

// Best-effort MIME type from a filename extension — only used to label binary
// uploads when the caller didn't pass a contentType. Falls back to octet-stream.
const MIME_BY_EXT = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", csv: "text/csv",
  txt: "text/plain", html: "text/html", json: "application/json", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ics: "text/calendar", ical: "text/calendar",
};
function guessContentType(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

// Strip a PEM wrapper (-----BEGIN …-----) to its base64-decoded DER bytes.
function pemToDer(pem) {
  const b64 = String(pem)
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return Buffer.from(b64, "base64");
}

export default MailKite;
