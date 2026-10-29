import { allocatePickerFor, programGate } from "@/lib/api/v1/programs";
import { inactive, mayUse, ok, signInAgain } from "@/lib/api/v1/respond";
import { readerFor } from "@/lib/api/v1/sessions";
import { getCurrentUser } from "@/lib/dal";

// Reads the token and the database on every request; never prerender. On
// Render the SQLite disk only exists at runtime.
export const dynamic = "force-dynamic";

/**
 * The program's Allocate time picker (`allocatePickerFor`). It is where a
 * grant starts, so it asks the write scope: a Leader or Sales grant reads the
 * program and is refused here, as the grant itself would refuse them.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return signInAgain();
  if (!mayUse(user)) return inactive();
  const gate = await programGate(await readerFor(user), (await params).id, { write: true });
  if ("refusal" in gate) return gate.refusal;
  return ok(await allocatePickerFor(gate.program));
}
