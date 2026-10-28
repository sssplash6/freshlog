/**
 * The JSON body as an object, or null when it isn't one.
 *
 * A write reads named fields off its body, so a body with no fields to read is
 * one answer, whatever it is instead: text that isn't JSON, an array, `null`, a
 * bare number, or nothing at all. The route refuses it as a whole rather than
 * finding out field by field.
 */
export async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}
