import { describe, expect, it, vi } from "vitest";

import { readTemplateInput } from "@/lib/interview-templates";
import { prisma } from "@/lib/prisma";
import { admin, MIGRATED_TEMPLATES, platformAdmin, program, grant } from "@/test/db";

/**
 * The practice-interview templates as rows: what the migration brought over,
 * who may change them, and what retiring one does to the picker and to the
 * interviews already booked with it.
 */
const actor = vi.hoisted(() => ({ value: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dal", () => ({
  getCurrentUser: async () =>
    actor.value ? prisma.user.findUnique({ where: { id: actor.value.id } }) : null,
}));

const { createInterviewTemplate, updateInterviewTemplate, setInterviewTemplateRetired } =
  await import("@/lib/actions/interview-templates");
const { allInterviewTemplates, bookableTemplates, findInterviewTemplate, templateNames } =
  await import("@/lib/interview-template-store");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const NEW = { name: "Oxford tutorial", summary: "A tutor testing how you think.", questions: "Why this subject?\n\nWhat would you change?" };

describe("the migrated templates", () => {
  it("are the five that were in the code, Session 1 first with its four questions", async () => {
    const all = await allInterviewTemplates();
    expect(all.map((t) => t.id)).toEqual([...MIGRATED_TEMPLATES]);
    expect(all[0].name).toBe("Freshman Interview Practice: Session 1");
    expect(all[0].questions).toHaveLength(4);
    expect(all[0].summary).toBe("The school's first session: getting to know you, and why college.");
  });

  it("name an interview whose template is gone as a practice interview", async () => {
    const name = await templateNames();
    expect(name("visa")).toBe("Student visa");
    expect(name("no-such-template")).toBe("Practice interview");
  });
});

describe("readTemplateInput", () => {
  it("takes one question per line, dropping blanks and list numbers", () => {
    const input = readTemplateInput({
      name: "  Mock   panel ",
      summary: "",
      questions: "1. Tell me about yourself.\r\n\n- Why us?\n  •  What next?  ",
    });
    expect(input).toEqual({
      ok: true,
      name: "Mock panel",
      summary: "",
      questions: ["Tell me about yourself.", "Why us?", "What next?"],
    });
  });

  it("refuses a template with no name or no questions", () => {
    expect(readTemplateInput({ name: "ab", summary: "", questions: "Q?" })).toMatchObject({ ok: false });
    expect(readTemplateInput({ name: "Panel", summary: "", questions: "\n  \n" })).toMatchObject({ ok: false });
  });
});

describe("writing templates", () => {
  it("is for platform admins only, not an admin of one program", async () => {
    const p = await program();
    const a = await admin();
    await grant({ userId: a.id, programId: p.id });
    actor.value = a;

    const res = await createInterviewTemplate(null, form(NEW));
    expect(res).toMatchObject({ ok: false, error: "Only a platform admin can do that." });
    expect(await prisma.interviewTemplate.count()).toBe(MIGRATED_TEMPLATES.length);
  });

  it("adds a new template at the end of the picker", async () => {
    actor.value = await platformAdmin();
    expect(await createInterviewTemplate(null, form(NEW))).toMatchObject({ ok: true });

    const bookable = await bookableTemplates();
    expect(bookable.at(-1)).toMatchObject({
      name: "Oxford tutorial",
      summary: "A tutor testing how you think.",
      questions: ["Why this subject?", "What would you change?"],
    });
  });

  it("refuses a second template with the same name, whatever its capitals", async () => {
    actor.value = await platformAdmin();
    const res = await createInterviewTemplate(null, form({ ...NEW, name: "student VISA" }));
    expect(res).toMatchObject({ ok: false, error: "A template called Student visa already exists." });
  });

  it("edits a template's questions in place, keeping its id", async () => {
    actor.value = await platformAdmin();
    await createInterviewTemplate(null, form(NEW));
    const made = (await prisma.interviewTemplate.findFirstOrThrow({ where: { name: NEW.name } })).id;

    const res = await updateInterviewTemplate(
      null,
      form({ templateId: made, name: "Oxford tutorial", summary: "", questions: "Only this?" })
    );
    expect(res).toMatchObject({ ok: true });
    expect(await findInterviewTemplate(made)).toMatchObject({ summary: "", questions: ["Only this?"] });
  });

  it("retires a template out of the picker, still readable by id, and puts it back", async () => {
    actor.value = await platformAdmin();
    expect(
      await setInterviewTemplateRetired(null, form({ templateId: "visa", retire: "1" }))
    ).toMatchObject({ ok: true });

    expect((await bookableTemplates()).map((t) => t.id)).not.toContain("visa");
    expect(await findInterviewTemplate("visa")).toMatchObject({ name: "Student visa" });
    expect((await templateNames())("visa")).toBe("Student visa");

    await setInterviewTemplateRetired(null, form({ templateId: "visa", retire: "0" }));
    expect((await bookableTemplates()).map((t) => t.id)).toContain("visa");
  });

  it("keeps the last template in the picker", async () => {
    actor.value = await platformAdmin();
    for (const id of MIGRATED_TEMPLATES.slice(1)) {
      await setInterviewTemplateRetired(null, form({ templateId: id, retire: "1" }));
    }
    const res = await setInterviewTemplateRetired(
      null,
      form({ templateId: MIGRATED_TEMPLATES[0], retire: "1" })
    );
    expect(res).toMatchObject({ ok: false });
    expect(await bookableTemplates()).toHaveLength(1);
  });
});
