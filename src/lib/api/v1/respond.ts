import type { ActionState } from "@/lib/actions/shared";
import type { WriteResult } from "@/lib/api/v1/types";

/**
 * The answers /api/v1 gives the freshlog app. Every one is JSON, bar the 204
 * that has nothing to say.
 *
 * Every one is also `no-store`. These URLs do not say whose data is behind them
 * (`/api/v1/me` is the same address for everyone; the bearer token is what
 * differs), and the figures change with each session logged. A copy kept
 * anywhere between this server and the phone would show one person another's
 * answer, or yesterday's balance.
 */
const NO_STORE = { "Cache-Control": "no-store" };

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: NO_STORE });

/** The data itself is the body. `201` when the request made something. */
export function ok<T>(data: T, status: 200 | 201 = 200): Response {
  return json(data, status);
}

/** Done, and nothing to say. */
export function noContent(): Response {
  return new Response(null, { status: 204, headers: NO_STORE });
}

/**
 * A request the server will not do, in words the app can show.
 *
 * `field` names the input that is wrong. `code` is for an answer the app acts on
 * rather than shows (`inactive`); only those two ever go in the body.
 */
export function refused(
  error: string,
  status: 400 | 403 | 404 | 429,
  extra: { field?: string; code?: string } = {}
): Response {
  const { field, code } = extra;
  return json({ ok: false, error, field, code }, status);
}

/**
 * No valid token. The app signs out on this answer, so its `code` is part of
 * the contract with it.
 */
export function signInAgain(): Response {
  return json({ ok: false, error: "Sign in again.", code: "unauthenticated" }, 401);
}

/** The words a PENDING or UNASSIGNED account is given; see `inactive`. */
export const INACTIVE = "Your account isn't active yet.";

/**
 * 403 `{ ok: false, error: INACTIVE, code: "inactive" }`: the account is PENDING
 * or UNASSIGNED. The app asks /me again and shows the waiting screen, so its
 * `code` is part of the contract with it.
 */
export function inactive(): Response {
  return refused(INACTIVE, 403, { code: "inactive" });
}

/**
 * An action's result as the answer. A success is the contract's `WriteResult`
 * and nothing more: its `ok`, its `message` (so the app shows the sentence the
 * website shows) and its `receipt`. Whatever else an action adds is for the
 * website and stays on the server. `editSession` echoes back the session it
 * saved, the mentor's note included, and that note is not for everyone who may
 * edit: the student it is about, even one who also administers the program, is
 * never shown it. So no route can send an action's echo, whoever calls it.
 *
 * A refusal is a 400 with its `error` and `field` and nothing else, for the same
 * reason: the `values` it carries are for a web form to refill itself from
 * (`logSession` echoes everything typed, the note included), and the app keeps
 * its own form.
 *
 * `null` is the state before anything was submitted (see `ActionState`). An
 * action that finishes with it has not said what happened, which is the
 * server's fault and not the caller's.
 */
export function fromAction(state: ActionState): Response {
  if (state === null) {
    return json({ ok: false, error: "Something went wrong. Try again." }, 500);
  }
  if (!state.ok) return refused(state.error, 400, { field: state.field });
  const { message, receipt } = state;
  return json({ ok: true, message, receipt } satisfies WriteResult, 200);
}
