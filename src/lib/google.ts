import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { appUrl } from "@/lib/email/send";

/**
 * Freshlog's read-only line to a mentor's Google Calendar and Meet.
 *
 * Plain `fetch` against four endpoints rather than the `googleapis` package:
 * that is tens of megabytes to call two list methods, and every response
 * field this reads is named below where a reader can check it against
 * Google's reference.
 *
 * OFF UNLESS CONFIGURED. Without the three variables in `.env.example` the
 * Settings row is not drawn and the sync does nothing, so this can ship before
 * the Google Cloud side is set up.
 */

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/meetings.space.readonly",
] as const;

/** The two a connection is useless without. A consent screen lets people untick them. */
const REQUIRED_SCOPES = GOOGLE_SCOPES.slice(2);

function clientId() {
  return process.env.GOOGLE_CONNECT_CLIENT_ID ?? "";
}
function clientSecret() {
  return process.env.GOOGLE_CONNECT_CLIENT_SECRET ?? "";
}

/** The cookie that carries the consent round trip's state. */
export const STATE_COOKIE = "google_connect_state";

export function googleConfigured(): boolean {
  return Boolean(clientId() && clientSecret() && tokenKey());
}

export function redirectUri(): string {
  return `${appUrl()}/api/google/callback`;
}

/* ------------------------------------------------------------------ *
 * The refresh token, at rest
 * ------------------------------------------------------------------ */

/**
 * 32 bytes, base64. A token stored in the clear would make every copy of the
 * database — the nightly backup on the same disk included — a key to every
 * connected mentor's calendar.
 */
function tokenKey(): Buffer | null {
  const raw = process.env.GOOGLE_TOKEN_KEY ?? "";
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function sealToken(token: string): string {
  const key = tokenKey();
  if (!key) throw new Error("GOOGLE_TOKEN_KEY is not a base64 32-byte key.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

export function openToken(sealed: string): string {
  const key = tokenKey();
  if (!key) throw new Error("GOOGLE_TOKEN_KEY is not a base64 32-byte key.");
  const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/* ------------------------------------------------------------------ *
 * OAuth
 * ------------------------------------------------------------------ */

export function consentUrl(state: string, loginHint: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // `offline` for a refresh token; `consent` because Google sends one only on
    // the first grant, and a mentor reconnecting after a revoke needs a new one.
    access_type: "offline",
    prompt: "consent",
    state,
    login_hint: loginHint,
  }).toString();
  return url.toString();
}

export type Granted = {
  refreshToken: string;
  scope: string;
  email: string;
  googleId: string;
};

/**
 * Trade the consent screen's code for a refresh token and the account it
 * belongs to. Throws with a reason the callback turns into a word on
 * /settings.
 */
export async function exchangeCode(code: string): Promise<Granted> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new GoogleError("failed", `token exchange ${res.status}`);
  const body = (await res.json()) as {
    refresh_token?: string;
    scope?: string;
    id_token?: string;
  };
  if (!body.refresh_token || !body.id_token) throw new GoogleError("failed", "no refresh token");
  const scope = body.scope ?? "";
  const granted = new Set(scope.split(" "));
  if (!REQUIRED_SCOPES.every((s) => granted.has(s))) {
    throw new GoogleError("missing-scope", scope);
  }
  // The ID token came straight from Google's token endpoint over TLS, which is
  // the case OpenID Connect allows to be read without checking its signature.
  const claims = JSON.parse(
    Buffer.from(body.id_token.split(".")[1] ?? "", "base64url").toString("utf8")
  ) as { sub?: string; email?: string; email_verified?: boolean };
  if (!claims.sub || !claims.email || claims.email_verified === false) {
    throw new GoogleError("failed", "no verified email");
  }
  return {
    refreshToken: body.refresh_token,
    scope,
    email: claims.email.toLowerCase(),
    googleId: claims.sub,
  };
}

/** A short-lived access token from the stored refresh token. */
export async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    // `invalid_grant` is Google saying the grant is gone — revoked, expired,
    // password changed. Anything else is worth retrying on the next run.
    throw new GoogleError(
      body.error === "invalid_grant" ? "revoked" : "failed",
      `refresh ${res.status} ${body.error ?? ""}`.trim()
    );
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Best effort: a mentor who disconnects is disconnected here whatever Google says. */
export async function revoke(refreshToken: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => undefined);
}

export class GoogleError extends Error {
  constructor(
    readonly reason: "failed" | "missing-scope" | "revoked",
    detail: string
  ) {
    super(detail);
  }
}

/* ------------------------------------------------------------------ *
 * Calendar and Meet
 * ------------------------------------------------------------------ */

async function get<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new GoogleError("revoked", `${res.status} ${url}`);
  if (!res.ok) throw new GoogleError("failed", `${res.status} ${url}`);
  return (await res.json()) as T;
}

/** Every page of a Google list method. */
async function all<T>(
  token: string,
  base: string,
  params: Record<string, string>,
  field: string
): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(base);
    url.search = new URLSearchParams({
      ...params,
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const page = await get<Record<string, unknown> & { nextPageToken?: string }>(
      token,
      url.toString()
    );
    out.push(...((page[field] as T[] | undefined) ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export type CalendarEvent = {
  id: string;
  status?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { email?: string; self?: boolean; resource?: boolean }[];
  conferenceData?: {
    conferenceId?: string;
    conferenceSolution?: { key?: { type?: string } };
  };
};

/** The mentor's own calendar, one instance per occurrence of a recurring meeting. */
export function listEvents(token: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  return all<CalendarEvent>(
    token,
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      maxResults: "250",
    },
    "items"
  );
}

export type ConferenceRecord = { name: string; startTime: string; endTime?: string };

/**
 * A Meet code as Google issues them: `abc-defg-hij`. It arrives on a calendar
 * event, which whoever organised the event controls, and it is pasted into a
 * filter expression below — so anything else is refused rather than escaped.
 */
export const MEETING_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/**
 * The calls held on one Meet link inside a window. A recurring meeting keeps
 * its link for every occurrence, so the time window is what picks out this
 * one — and a call everybody left and rejoined is two records, both wanted.
 */
export function listConferences(
  token: string,
  meetingCode: string,
  from: Date,
  to: Date
): Promise<ConferenceRecord[]> {
  if (!MEETING_CODE.test(meetingCode)) {
    return Promise.reject(new GoogleError("failed", "not a Meet code"));
  }
  return all<ConferenceRecord>(
    token,
    "https://meet.googleapis.com/v2/conferenceRecords",
    {
      filter: `space.meeting_code = "${meetingCode}" AND start_time >= "${from.toISOString()}" AND start_time <= "${to.toISOString()}"`,
      pageSize: "25",
    },
    "conferenceRecords"
  );
}

type RawParticipant = {
  name: string;
  signedinUser?: { user?: string };
};
type RawSession = { startTime?: string; endTime?: string };

/** Everyone in one call, with each stretch they were connected. */
export async function listAttendance(
  token: string,
  conference: ConferenceRecord
): Promise<{ user: string | null; sessions: { start: Date; end: Date }[] }[]> {
  const fallbackEnd = conference.endTime ?? new Date().toISOString();
  const participants = await all<RawParticipant>(
    token,
    `https://meet.googleapis.com/v2/${conference.name}/participants`,
    { pageSize: "100" },
    "participants"
  );
  return Promise.all(
    participants.map(async (p) => {
      const sessions = await all<RawSession>(
        token,
        `https://meet.googleapis.com/v2/${p.name}/participantSessions`,
        { pageSize: "100" },
        "participantSessions"
      );
      return {
        user: p.signedinUser?.user ?? null,
        sessions: sessions
          .filter((s) => s.startTime)
          .map((s) => ({
            start: new Date(s.startTime!),
            end: new Date(s.endTime ?? fallbackEnd),
          })),
      };
    })
  );
}
