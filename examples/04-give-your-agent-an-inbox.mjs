// Give your agent its own email address — let MailKite's built-in inbox agent answer mail
// for you, no webhook server required.
//
// Instead of running your own webhook → LLM loop (see 03-agent-email-reply.mjs), point a
// route's action at MailKite's hosted `agent`: every email to the matched address is handed
// to an inbox agent that reads it and acts on your instructions — reply, file, or escalate.
//
// Run:  MAILKITE_API_KEY=mk_live_… node 04-give-your-agent-an-inbox.mjs
// Deps: npm install mailkite

import { MailKite } from "mailkite";

const mk = new MailKite(process.env.MAILKITE_API_KEY);

// The domain must already be verified (mk.createDomain + DNS + mk.verifyDomain — see the docs).
const route = await mk.createRoute({
  match: "support@yourdomain.com",     // or "*@agent.yourdomain.com" to give the agent a whole subdomain
  action: "agent",
  agentPrompt: `You are Acme's email support agent. Answer billing and account questions from our
docs, keep replies short and friendly, and escalate anything you're unsure about by forwarding to
team@yourdomain.com. Never share account secrets.`,
});

console.log("inbox agent live:", route); // mail to support@yourdomain.com is now auto-answered

// Test it without sending real mail — hand the agent a message directly and read its reply:
const reply = await mk.agent({ to: "support@yourdomain.com", text: "Hi, how do I reset my password?" });
console.log("agent says:", reply);
