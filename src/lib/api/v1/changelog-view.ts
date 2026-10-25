import "server-only";

import type { ApiChangelog } from "@/lib/api/v1/types";
import { isUnseen, readChangelog, splitItem, type SeenFields } from "@/lib/changelog";

/**
 * What's new, as /changelog reads it: `CHANGELOG.md`'s days, newest first (the
 * parser's order), each item split into its headline and detail, and each day
 * marked unseen by `isUnseen`, which judges what this person read rather than
 * when they looked.
 */
export async function changelogFor(user: SeenFields): Promise<ApiChangelog> {
  const entries = await readChangelog();
  return {
    days: entries.map((e) => ({
      day: e.date,
      unseen: isUnseen(e, user),
      new: e.new.map((text) => splitItem(text)),
      fixed: e.fixed.map((text) => splitItem(text)),
    })),
  };
}
