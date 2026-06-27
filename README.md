# MailKite for Node.js

Official [MailKite](https://mailkite.dev) SDK. One low-level `request()` plus one
method per endpoint. Requires Node 18+ (uses the built-in `fetch`).

## Install

```bash
npm install mailkite
```

## Usage

```js
import { MailKite } from "mailkite";

const mk = new MailKite(process.env.MAILKITE_API_KEY);

const { id, status } = await mk.send({
  from: "hello@myapp.ai",
  to: "ada@example.com",
  subject: "Your invoice #1042",
  html: "<p>Thanks! Receipt attached.</p>",
});
```

Point at a different base URL with `new MailKite(key, "https://api.mailkite.dev")`.

## Methods

`send(message)`, `agent(message)`, `route(message)`, `listDomains()`, `createDomain({ domain })`, `getDomain(id)`,
`deleteDomain(id)`, `verifyDomain(id)`, `setWebhook(id, { url })`,
`deleteWebhook(id)`, `testWebhook(id)`, `checkDomainAvailability(domain)`,
`registerDomain({ domain, contact })`, `listRoutes()`,
`createRoute({ match, action, destination })`, `listMessages()`,
`getMessage(id)`, `retryDelivery(id)`,
`verifyWebhook(signature, payload, secret, toleranceMs?)`, `replyOk()`,
`encrypt(plaintext, publicKey)`, `decrypt(envelope, privateKey)`.

Non-2xx responses throw a `MailKiteError` with `.status`, `.message`, and `.body`.

## Verifying webhook signatures

Every delivery carries an `x-mailkite-signature` header. `verifyWebhook` recomputes
the HMAC-SHA256 over the raw body, compares it in constant time, and rejects events
outside the ±5-minute replay window — no network call, no API key. It's available as
both a static and an instance method; pass the **raw** request body, not a parsed object.

```js
import express from "express";
import { MailKite } from "mailkite";

const app = express();
app.use("/hooks/mailkite", express.raw({ type: "application/json" }));

app.post("/hooks/mailkite", (req, res) => {
  const ok = MailKite.verifyWebhook(
    req.headers["x-mailkite-signature"],
    req.body, // raw Buffer
    process.env.MAILKITE_WEBHOOK_SECRET,
  );
  if (!ok) return res.sendStatus(401);
  res.sendStatus(200);
});
```

Pass `toleranceMs: 0` (the 4th argument) to skip the freshness check; it defaults to
300000 (5 minutes). See [Verifying webhook signatures](https://mailkite.dev/docs/webhook-security).

In `ack` mode a consumer replies with `replyOk()` (the exact body `{"status":"ok"}`)
to acknowledge a delivery — also available as both a static and an instance method.

## At-rest encryption

`encrypt(plaintext, publicKey)` returns MailKite's at-rest envelope as a JSON string —
it wraps a fresh AES-256-GCM content key with your RSA-OAEP-256 SPKI/PEM public key.
`decrypt(envelope, privateKey)` reverses it with the matching PKCS8/PEM private key,
returning the original UTF-8 string. Both are local (no network) and available as
static and instance methods; only the public key is needed to encrypt.

```js
import { MailKite } from "mailkite";

const envelope = MailKite.encrypt("secret note", process.env.MK_PUBLIC_KEY);
const plaintext = MailKite.decrypt(envelope, process.env.MK_PRIVATE_KEY);
```

## Errors

```js
import { MailKiteError } from "mailkite";

try {
  await mk.send(msg);
} catch (e) {
  if (e instanceof MailKiteError) console.error(e.status, e.message);
}
```

See the [full docs](https://mailkite.dev/docs/libraries).
