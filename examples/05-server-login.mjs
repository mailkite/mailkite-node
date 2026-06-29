// Server-side login + register — let YOUR users sign into THEIR own MailKite account.
//
// Two ways to authenticate from a server:
//
//   A) Your OWN account (one MailKite account behind your app):
//      just call signup (register) or login with email + password and keep the token.
//      No redirect, no browser. Shown in `ownAccount()` below.
//
//   B) YOUR USERS' accounts (multi-tenant — each user has their own MailKite account):
//      the OAuth 2.1 + PKCE authorization-code flow. You send the user to MailKite's
//      hosted page where they LOG IN OR REGISTER, then they're redirected back to you
//      with a `code` you exchange for a token that *is* that user. Shown in the Express
//      app below. Register-or-login is handled entirely on the hosted authorize page —
//      a new user just clicks "create account" there and lands back logged in.
//
// Run:  MAILKITE_BASE_URL=https://api.mailkite.dev node 05-server-login.mjs
//       then open http://localhost:3000/login
//
// Deps: npm install mailkite express

import express from "express";
import { MailKite } from "mailkite";
import crypto from "node:crypto";

const ISSUER = process.env.MAILKITE_BASE_URL || "https://api.mailkite.dev";
const REDIRECT_URI = "http://localhost:3000/callback";

// ── A) Server acting as your OWN single account (no redirect) ───────────────────────────────
async function ownAccount() {
  const base = `${ISSUER}`;
  // Register (idempotent-ish: 409 if the email already exists → fall back to login).
  const signup = await fetch(`${base}/api/auth/signup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "you@example.com", password: process.env.MK_PASSWORD }),
  });
  const { token } = signup.ok
    ? await signup.json()
    : await (await fetch(`${base}/api/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "you@example.com", password: process.env.MK_PASSWORD }),
      })).json();
  const mk = MailKite ? new MailKite(token) : null; // the session token works like an API key
  console.log("logged in as own account; domains:", await mk.listDomains());
}

// ── B) OAuth login/register for YOUR USERS (PKCE authorization-code) ─────────────────────────
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sessions = new Map(); // demo store: state → { verifier }. Use a real session store in prod.

const app = express();

// 1. Kick off login. We dynamically register a public client (once; cache the id in prod),
//    create a PKCE pair, and redirect the user to MailKite's hosted login/register page.
app.get("/login", async (req, res) => {
  const reg = await fetch(`${ISSUER}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "My App",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  const { client_id } = await reg.json();

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  sessions.set(state, { verifier, client_id });

  const url = new URL(`${ISSUER}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: REDIRECT_URI,
    scope: "mcp", // full account — the only scope today
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  res.redirect(url.toString()); // → user logs in OR registers here, then comes back to /callback
});

// 2. Handle the redirect back: exchange the one-time code for a token that IS the user.
app.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  const sess = sessions.get(state);
  if (!sess) return res.status(400).send("unknown state");
  sessions.delete(state);

  const tok = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: sess.client_id,
      code_verifier: sess.verifier,
    }).toString(),
  });
  const { access_token, refresh_token } = await tok.json();

  // 3. Now act as that user. Store access_token (and refresh_token to renew it later).
  const mk = new MailKite(access_token);
  const domains = await mk.listDomains();
  res.json({ ok: true, message: "Logged in as the MailKite user.", domains });
});

app.listen(3000, () => console.log("open http://localhost:3000/login"));
