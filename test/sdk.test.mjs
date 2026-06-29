// Unit tests for the MailKite Node SDK. Covers every public function:
//   - request() (auth, content-type, JSON body, errors, base-url trim, empty body)
//   - one thin method per endpoint (correct verb + path + body)
//   - verifyWebhook (valid / tampered / wrong-secret / malformed / replay window)
//
// Run with: npm test   (node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { MailKite, MailKiteError } from "../index.js";

// ---- in-process mock server -------------------------------------------------
let next = { status: 200, body: { ok: true } }; // programmable response
let last = null; // recorded request

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (d) => chunks.push(d));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    last = { method: req.method, url: req.url, headers: req.headers, raw };
    res.writeHead(next.status, { "content-type": "application/json" });
    res.end(next.body === undefined ? "" : JSON.stringify(next.body));
  });
});

const baseUrl = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
});
const KEY = "mk_live_test";
const mk = new MailKite(KEY, baseUrl);

function reply(status, body) {
  next = { status, body };
}

test.after(() => server.close());

// ---- constructor ------------------------------------------------------------
test("constructor trims trailing slashes from the base URL", () => {
  assert.equal(new MailKite("k", "https://api.x.dev///").baseUrl, "https://api.x.dev");
  assert.equal(new MailKite("k").baseUrl, "https://api.mailkite.dev");
});

// ---- request() --------------------------------------------------------------
test("request() sends Bearer auth + JSON content-type and parses the result", async () => {
  reply(200, { id: "x", status: "queued" });
  const out = await mk.request("POST", "/v1/send", { a: 1 });
  assert.equal(last.headers["authorization"], `Bearer ${KEY}`);
  assert.match(last.headers["content-type"], /application\/json/);
  assert.deepEqual(JSON.parse(last.raw), { a: 1 });
  assert.deepEqual(out, { id: "x", status: "queued" });
});

test("request() with no body sends neither content-type nor a payload", async () => {
  reply(200, []);
  await mk.request("GET", "/api/domains");
  assert.equal(last.raw, "");
  assert.equal(last.headers["content-type"], undefined);
});

test("request() returns null for an empty 2xx body", async () => {
  reply(204, undefined);
  assert.equal(await mk.request("DELETE", "/api/x"), null);
});

test("request() throws MailKiteError carrying status, message and body", async () => {
  reply(404, { error: "not found" });
  await assert.rejects(
    () => mk.request("GET", "/api/messages/nope"),
    (e) => {
      assert.ok(e instanceof MailKiteError);
      assert.equal(e.status, 404);
      assert.equal(e.message, "not found");
      assert.deepEqual(e.body, { error: "not found" });
      return true;
    },
  );
});

test("request() falls back to the status text when no error field is present", async () => {
  reply(500, { nope: true });
  await assert.rejects(() => mk.request("GET", "/x"), (e) => e.status === 500 && typeof e.message === "string");
});

// ---- endpoint methods: correct verb + path + body ---------------------------
const cases = [
  ["send", () => mk.send({ from: "a", to: "b", subject: "s", text: "t" }), "POST", "/v1/send", { from: "a", to: "b", subject: "s", text: "t" }],
  ["listDomains", () => mk.listDomains(), "GET", "/api/domains", null],
  ["createDomain", () => mk.createDomain({ domain: "x.dev" }), "POST", "/api/domains", { domain: "x.dev" }],
  ["getDomain", () => mk.getDomain("dom_1"), "GET", "/api/domains/dom_1", null],
  ["deleteDomain", () => mk.deleteDomain("dom_1"), "DELETE", "/api/domains/dom_1", null],
  ["verifyDomain", () => mk.verifyDomain("dom_1"), "POST", "/api/domains/dom_1/verify", null],
  ["setWebhook", () => mk.setWebhook("dom_1", { url: "https://h.dev" }), "PUT", "/api/domains/dom_1/webhook", { url: "https://h.dev" }],
  ["deleteWebhook", () => mk.deleteWebhook("dom_1"), "DELETE", "/api/domains/dom_1/webhook", null],
  ["testWebhook", () => mk.testWebhook("dom_1"), "POST", "/api/domains/dom_1/webhook/test", null],
  ["listRoutes", () => mk.listRoutes(), "GET", "/api/routes", null],
  ["createRoute", () => mk.createRoute({ match: "*@x", action: "webhook", destination: "u" }), "POST", "/api/routes", { match: "*@x", action: "webhook", destination: "u" }],
  ["listMessages", () => mk.listMessages(), "GET", "/api/messages", null],
  ["getMessage", () => mk.getMessage("msg_1"), "GET", "/api/messages/msg_1", null],
  ["retryDelivery", () => mk.retryDelivery("dlv_1"), "POST", "/api/deliveries/dlv_1/retry", null],
];

for (const [name, call, method, path, body] of cases) {
  test(`${name}() → ${method} ${path}`, async () => {
    reply(200, { ok: true });
    await call();
    assert.equal(last.method, method);
    assert.equal(last.url, path);
    if (body === null) assert.equal(last.raw, "");
    else assert.deepEqual(JSON.parse(last.raw), body);
  });
}

test("path parameters are URL-encoded", async () => {
  reply(200, {});
  await mk.getDomain("a/b ?c");
  assert.equal(last.url, "/api/domains/a%2Fb%20%3Fc");
});

// ---- verifyWebhook ----------------------------------------------------------
const SECRET = "whsec_mailkite_test";
const PAYLOAD = '{"type":"email.received","id":"evt_123","message":"It works."}';
const V1 = "3d790f831e170ddba4d001f27532bf2c1fc68ebed52eef72fe453dfa1196b03c";
const HEADER = `t=1750000000000,v1=${V1}`;

const sign = (secret, t, body) => crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
const freshHeader = (secret, body) => {
  const t = Date.now();
  return `t=${t},v1=${sign(secret, t, body)}`;
};

test("verifyWebhook accepts a valid signature (tolerance disabled)", () => {
  assert.equal(MailKite.verifyWebhook(HEADER, PAYLOAD, SECRET, 0), true);
  assert.equal(new MailKite("").verifyWebhook(HEADER, PAYLOAD, SECRET, 0), true);
});

test("verifyWebhook accepts a raw Buffer payload too", () => {
  assert.equal(MailKite.verifyWebhook(HEADER, Buffer.from(PAYLOAD, "utf8"), SECRET, 0), true);
});

test("verifyWebhook rejects a tampered body", () => {
  assert.equal(MailKite.verifyWebhook(HEADER, PAYLOAD + " ", SECRET, 0), false);
});

test("verifyWebhook rejects the wrong secret", () => {
  assert.equal(MailKite.verifyWebhook(HEADER, PAYLOAD, "whsec_wrong", 0), false);
});

test("verifyWebhook rejects malformed or incomplete headers", () => {
  for (const h of ["", "garbage", "t=1750000000000", `v1=${V1}`, `t=notanum,v1=${V1}`, undefined]) {
    assert.equal(MailKite.verifyWebhook(h, PAYLOAD, SECRET, 0), false);
  }
});

test("verifyWebhook enforces the replay window", () => {
  // The fixed vector is far in the past, so the default (5 min) window rejects it.
  assert.equal(MailKite.verifyWebhook(HEADER, PAYLOAD, SECRET), false);
  // A freshly signed event passes with the default window.
  assert.equal(MailKite.verifyWebhook(freshHeader(SECRET, PAYLOAD), PAYLOAD, SECRET), true);
});
