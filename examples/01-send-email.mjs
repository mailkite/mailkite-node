// Send an email over a verified domain — the 10-second "it works".
//
// Run:  MAILKITE_API_KEY=mk_live_… node 01-send-email.mjs
// Deps: npm install mailkite

import { MailKite } from "mailkite";

const mk = new MailKite(process.env.MAILKITE_API_KEY);

const res = await mk.send({
  from: "hello@yourdomain.com", // an address on a domain you've verified
  to: "ada@example.com",
  subject: "Your invoice #1042",
  html: "<p>Thanks for your order — receipt attached.</p>",
  // text: "plain-text fallback", cc, bcc, replyTo, attachments, templateId, templateData all supported
});

console.log("sent:", res); // → { id: "msg_…", status: "queued" }
