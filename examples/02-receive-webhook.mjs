// Receive inbound email as a webhook — and VERIFY the signature before trusting it.
//
// When mail arrives at any address on a verified domain, MailKite POSTs a JSON
// `email.received` event to your webhook URL, signed with HMAC-SHA256. Always verify
// the `x-mailkite-signature` header against your webhook secret (dashboard → Webhooks)
// so nobody can forge inbound mail to your endpoint.
//
// Run:  MAILKITE_WEBHOOK_SECRET=whsec_… node 02-receive-webhook.mjs
//       (expose it with `ngrok http 3000` and set the public URL as your webhook)
// Deps: npm install mailkite express

import express from "express";
import { MailKite } from "mailkite";

const mk = new MailKite(process.env.MAILKITE_API_KEY || "unused-for-verify");
const SECRET = process.env.MAILKITE_WEBHOOK_SECRET;

const app = express();
// IMPORTANT: verify against the RAW body bytes — re-serialized JSON breaks the HMAC.
app.use(express.text({ type: "*/*" }));

app.post("/hooks/mailkite", async (req, res) => {
  // verifyWebhook(signature, payload, secret, toleranceMs?) — positional. payload is the RAW body.
  const ok = await mk.verifyWebhook(req.header("x-mailkite-signature"), req.body, SECRET);
  if (!ok) return res.status(401).send("bad signature");

  const event = JSON.parse(req.body);
  if (event.type === "email.received") {
    const m = event.message ?? event; // { from, to, subject, text, html, messageId, … }
    console.log(`📬 ${m.from} → ${m.to}: ${m.subject}`);
    // …do your thing: store it, notify a channel, kick off a workflow…
  }

  // Reply 200 to acknowledge. You can also return a control body to act on the message,
  // e.g. mark spam / drop / block-sender — see mk.replyOk()/replySpam()/replyDrop().
  res.json({ status: "ok" });
});

app.listen(3000, () => console.log("listening on http://localhost:3000/hooks/mailkite"));
