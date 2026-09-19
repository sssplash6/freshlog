import { NextResponse } from "next/server";

import { editSession } from "@/lib/actions/sessions";

/** Inline session edits use HTTP rather than a server-action dispatch so the
 * current page does not receive a new RSC tree while the editor is open. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const formData = await request.formData();
  formData.set("sessionId", id);
  const result = await editSession(null, formData);
  if (!result) {
    return NextResponse.json(
      { ok: false, error: "Session could not be saved." },
      { status: 500 },
    );
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
