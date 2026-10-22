import type { ActionState } from "@/lib/actions/shared";

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

/**
 * An action's result as the answer. The state is the body, unchanged, so the app
 * shows the sentence the website shows; a refusal is a 400.
 *
 * `null` is the state before anything was submitted (see `ActionState`). An
 * action that finishes with it has not said what happened, which is the
 * server's fault and not the caller's.
 */
export function fromAction(state: ActionState): Response {
  if (state === null) {
    return json({ ok: false, error: "Something went wrong. Try again." }, 500);
  }
  return json(state, state.ok ? 200 : 400);
}
