import { redirect } from "next/navigation";

import { readParam, type SearchParams } from "@/lib/filters";

/**
 * The roster moved up to the program itself (`../page.tsx`), so this address is
 * kept only to carry the links that still point at it — a bookmark, an email, a
 * "back to the roster" from an action — to where the list now lives.
 *
 * The query string comes along: a search or a page number in a shared link is
 * the reason somebody sent the link.
 */
export default async function ProgramStudentsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const carried = new URLSearchParams();
  for (const key of Object.keys(query)) {
    const value = readParam(query, key);
    if (value) carried.set(key, value);
  }
  const suffix = carried.toString();
  redirect(`/programs/${id}${suffix ? `?${suffix}` : ""}`);
}
