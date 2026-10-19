/**
 * Gmail integration via Google OAuth 2.0 and the Gmail REST API.
 *
 * Docs: https://developers.google.com/workspace/gmail/api/guides/sending
 *
 * Two flows:
 *   A) Direct send — POST /users/me/messages/send with base64url RFC2822 message
 *   B) Draft create — POST /users/me/drafts with the same message body
 *
 * Per spec §16:
 *   - Independent pre-send revalidation (handled in services/approval-service).
 *   - Durable send_operation with unique operation_id.
 *   - send_status_unknown on network failure → reconcile, never blind retry.
 */


import { encryptSecret, decryptSecret } from "../credentials/index";
import { requireServerEnv } from "../env";
import { audit } from "../audit";
import { getServiceSupabase } from "../db";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_DRAFT_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

export const REQUIRED_SCOPES = [GMAIL_SEND_SCOPE, GMAIL_DRAFT_SCOPE, "openid", "email"];

export interface OAuthState {
  state: string;
  user_id: string;
  created_at: number;
}

export function makeOAuthState(userId: string): OAuthState {
  return {
    state: cryptoRandom(),
    user_id: userId,
    created_at: Date.now(),
  };
}

export function buildAuthorizeUrl(state: string): string {
  const env = requireServerEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_REDIRECT_URI must be set to use Gmail OAuth.");
  }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: REQUIRED_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface TokenSet {
  access_token: string;
  refresh_token: string | null;
  expires_at: number; // epoch ms
  scope: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const env = requireServerEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error("Google OAuth credentials are not configured.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OAuth exchange failed (${res.status}): ${t}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    id_token?: string;
  };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? null,
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
    scope: json.scope,
  };
}

export async function persistSenderAccount(
  userId: string,
  email: string,
  tokens: TokenSet,
): Promise<void> {
  const sb = getServiceSupabase();
  const encryptedRefresh = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : null;
  const { error } = await sb.from("sender_accounts").upsert(
    {
      owner_id: userId,
      email,
      access_token: encryptSecret(tokens.access_token),
      refresh_token_encrypted: encryptedRefresh,
      token_expires_at: new Date(tokens.expires_at).toISOString(),
      scope: tokens.scope,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,email" },
  );
  if (error) throw new Error(`persistSenderAccount: ${error.message}`);
  await audit({
    actor_id: userId,
    action: "gmail.connect",
    resource_type: "sender_account",
    resource_id: email,
    campaign_id: null,
    ticket_id: null,
    metadata: { scope: tokens.scope },
  });
}

export async function getValidAccessToken(userId: string): Promise<string | null> {
  const sb = getServiceSupabase();
  // Use `.order().limit(1)` instead of `.maybeSingle()` so multiple accounts
  // per user don't error. Pick the most recently connected one.
  const { data, error } = await sb
    .from("sender_accounts")
    .select("email, access_token, refresh_token_encrypted, token_expires_at")
    .eq("owner_id", userId)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const exp = new Date(data.token_expires_at).getTime();
  if (exp > Date.now() + 30_000) {
    return decryptSecret(data.access_token);
  }
  if (!data.refresh_token_encrypted) return null;
  const refresh = decryptSecret(data.refresh_token_encrypted);
  const refreshed = await refreshAccessToken(refresh);
  await persistSenderAccount(userId, data.email, refreshed);
  return refreshed.access_token;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const env = requireServerEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error("Google OAuth credentials are not configured.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`refresh failed (${res.status}): ${await res.text()}`);
  const j = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope: string;
  };
  return {
    access_token: j.access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + (j.expires_in - 60) * 1000,
    scope: j.scope,
  };
}

// ─── MIME message construction ─────────────────────────────────────────────

export interface MailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string | null;
  attachments?: Array<{
    filename: string;
    mime: string;
    bytes: Uint8Array;
  }>;
}

export function buildRfc2822(msg: MailMessage): string {
  const boundary = "mailpilot_" + cryptoRandom();
  const lines: string[] = [];
  lines.push(`From: ${rfcEncodeHeader(msg.from)}`);
  lines.push(`To: ${rfcEncodeHeader(msg.to)}`);
  lines.push(`Subject: ${rfcEncodeHeader(msg.subject)}`);
  lines.push("MIME-Version: 1.0");
  if (msg.attachments && msg.attachments.length > 0) {
    lines.push(
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
    );
    lines.push("");
    lines.push(`--${boundary}`);
    if (msg.html) {
      const altBoundary = "alt_" + cryptoRandom();
      lines.push(
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      );
      lines.push("");
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: 8bit");
      lines.push("");
      lines.push(msg.text);
      lines.push("");
      lines.push(`--${altBoundary}`);
      lines.push('Content-Type: text/html; charset="UTF-8"');
      lines.push("Content-Transfer-Encoding: 8bit");
      lines.push("");
      lines.push(msg.html);
      lines.push("");
      lines.push(`--${altBoundary}--`);
    } else {
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: 8bit");
      lines.push("");
      lines.push(msg.text);
    }
    lines.push("");
    for (const att of msg.attachments) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${att.mime}; name="${att.filename}"`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
      lines.push("");
      lines.push(base64Wrap(Buffer.from(att.bytes).toString("base64")));
      lines.push("");
    }
    lines.push(`--${boundary}--`);
  } else if (msg.html) {
    const altBoundary = "alt_" + cryptoRandom();
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push("");
    lines.push(`--${altBoundary}`);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(msg.text);
    lines.push("");
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(msg.html);
    lines.push("");
    lines.push(`--${altBoundary}--`);
  } else {
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(msg.text);
  }
  return lines.join("\r\n");
}

function rfcEncodeHeader(s: string): string {
  // ASCII short headers can stay as-is. Non-ASCII requires RFC 2047 encoded-word.
  if (/^[\x00-\x7F]+$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
}

function base64Wrap(s: string): string {
  return s.replace(/(.{76})/g, "$1\r\n").trim();
}

function cryptoRandom(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

function toB64Url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

// ─── Send & draft ──────────────────────────────────────────────────────────

export interface SendOutcome {
  gmail_message_id: string | null;
  status: "sent" | "unknown" | "failed";
  error: string | null;
}

export async function sendEmail(
  accessToken: string,
  msg: MailMessage,
): Promise<SendOutcome> {
  const raw = toB64Url(buildRfc2822(msg));
  // Per §5.9: distinguish 4xx (definitive failure, do not retry) from 5xx
  // and network timeouts (outcome unknown, requires reconciliation).
  try {
    const ctrl = AbortSignal.timeout(15_000);
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      signal: ctrl,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    if (res.status === 200) {
      const j = (await res.json()) as { id: string };
      return { gmail_message_id: j.id, status: "sent", error: null };
    }
    if (res.status >= 400 && res.status < 500) {
      // 4xx — definitive failure (401 expired token, 400 invalid message,
      // 413 too large, 403 forbidden). Do NOT retry blindly.
      const body = await res.text();
      return {
        gmail_message_id: null,
        status: "failed",
        error: `gmail ${res.status}: ${body}`,
      };
    }
    // 5xx — server error, outcome unknown.
    return { gmail_message_id: null, status: "unknown", error: `gmail ${res.status}` };
  } catch (e) {
    // Network failure / timeout — outcome unknown.
    return { gmail_message_id: null, status: "unknown", error: (e as Error).message };
  }
}

export interface DraftOutcome {
  gmail_draft_id: string | null;
  status: "created" | "unknown";
  error: string | null;
}

export async function createDraft(
  accessToken: string,
  msg: MailMessage,
): Promise<DraftOutcome> {
  const raw = toB64Url(buildRfc2822(msg));
  try {
    const ctrl = AbortSignal.timeout(15_000);
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      signal: ctrl,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: { raw } }),
    });
    if (res.status === 200) {
      const j = (await res.json()) as { id: string };
      return { gmail_draft_id: j.id, status: "created", error: null };
    }
    return { gmail_draft_id: null, status: "unknown", error: `gmail ${res.status}` };
  } catch (e) {
    return { gmail_draft_id: null, status: "unknown", error: (e as Error).message };
  }
}
