import { describe, expect, it } from "vitest";

import { bodyOf } from "@/lib/api/v1/body";

const post = (body: string) => new Request("http://test", { method: "POST", body });

describe("bodyOf", () => {
  it("reads a JSON object", async () => expect(await bodyOf(post('{"minutes":45}'))).toEqual({ minutes: 45 }));

  it.each([
    ["not JSON", "minutes=45"],
    ["an array", "[1]"],
    ["null", "null"],
    ["nothing", ""],
  ])("answers null for %s", async (_, body) => expect(await bodyOf(post(body))).toBeNull());
});
