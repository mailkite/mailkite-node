// An AI email agent in ~40 lines: inbound email → Claude drafts a reply → MailKite sends it,
// threaded back to the sender. Give your product an inbox that answers itself.
//
// Flow: MailKite POSTs the inbound `email.received` event → we verify it → hand the message to
// Claude (the Anthropic SDK) to compose a concise reply → send it with `inReplyTo` so it threads.
//
// Run:  MAILKITE_API_KEY=mk_live_… MAILKITE_WEBHOOK_SECRET=whsec_… ANTHROPIC_API_KEY=sk-ant-… \
//       node 03-agent-email-reply.mjs
// Deps: npm install mailkite express @anthropic-ai/sdk

import express from "express";
import { MailKite } from "mailkite";
import Anthropic from "@anthropic-ai/sdk";

const mk = new MailKite(process.env.MAILKITE_API_KEY);
const claude = new Anthropic(); // reads ANTHROPIC_API_KEY
const SECRET = process.env.MAILKITE_WEBHOOK_SECRET;

const SYSTEM = `You are the support agent for Acme. Read the customer's email and write a short,
friendly reply that directly answers them. Plain text, no subject line, no salutation boilerplate
beyond a brief greeting and sign-off. If you can't help, say a human will follow up.`;

const app = express();
app.use(express.text({ type: "*/*" }));

app.post("/hooks/mailkite", async (req, res) => {
  if (!(await mk.verifyWebhook(req.header("x-mailkite-signature"), req.body, SECRET))) {
    return res.status(401).send("bad signature");
  }
  const event = JSON.parse(req.body);
  if (event.type !== "email.received") return res.json({ status: "ok" });
  const m = event.message ?? event;

  // 1. Claude drafts the reply from the inbound message.
  const completion = await claude.messages.create({
    model: "claude-opus-4-8", // swap to claude-sonnet-4-6 / claude-haiku-4-5 for lower cost
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: `From: ${m.from}\nSubject: ${m.subject}\n\n${m.text || m.html}` }],
  });
  const reply = completion.content.find((b) => b.type === "text")?.text ?? "Thanks — a human will follow up.";

  // 2. Send it back over MailKite, threaded to the original (inReplyTo = the inbound message id).
  await mk.send({
    from: m.to,                 // reply from the address that received the mail
    to: m.from,
    subject: m.subject?.startsWith("Re:") ? m.subject : `Re: ${m.subject}`,
    text: reply,
    inReplyTo: m.messageId,
  });

  console.log(`🤖 replied to ${m.from}`);
  res.json({ status: "ok" });
});

app.listen(3000, () => console.log("AI email agent listening on /hooks/mailkite"));
