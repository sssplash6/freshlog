"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { PencilIcon, PlusIcon } from "@/components/icons";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * "Make a new one" — in ONE place on every page that offers it.
 *
 * It was five shapes in five places: a "+ New program" text link floating
 * between the attention card and the table on Home, the same link under the
 * title on Programs, "+ Register a mentor" above the filters, a filled
 * secondary "Add students" on a program, and on Students nothing at all once
 * the roster had a row in it. A reader had to learn each page to find out how
 * to add to it.
 *
 * Now it is always the same button in the same place — the right end of the
 * page title's actions — and the form opens as a card directly UNDER the
 * title, not inside the actions cluster: a two-column form that opened where
 * its button was would push the page's own heading sideways, which is why
 * these folds were moved out of the actions row in the first place.
 *
 * The button and the card are siblings far apart in the tree (one is inside
 * `PageTitle`, a server component), so they share their open state through
 * `CreateSlot` rather than through a prop.
 */

type Slot = { open: boolean; setOpen: (open: boolean) => void; id: string };

const CreateContext = createContext<Slot | null>(null);

/** Wraps the page (or the part of it holding both the button and the card). */
export function CreateSlot({
  children,
  defaultOpen = false,
}: {
  children: React.ReactNode;
  /** Opened on arrival — a link that says "add students" should land open. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <CreateContext.Provider value={{ open, setOpen, id }}>{children}</CreateContext.Provider>
  );
}

function useSlot(): Slot {
  const slot = useContext(CreateContext);
  if (!slot) throw new Error("CreateButton and CreatePanel need a CreateSlot around them");
  return slot;
}

/** The same classes `CreateLink` (create-link.tsx) uses, for a "new" that is a link. */
const CREATE_BUTTON = buttonClasses("secondary", "md", "gap-1.5");

export function CreateButton({
  label,
  icon = "plus",
}: {
  label: string;
  /**
   * `edit` for the same slot holding a change to the page's own subject — a
   * mentor's programs and name — rather than a new one. Same place, same
   * button, so a person's page reads like every other page.
   */
  icon?: "plus" | "edit";
}) {
  const { open, setOpen, id } = useSlot();
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={id}
      onClick={() => setOpen(!open)}
      className={CREATE_BUTTON}
    >
      {icon === "edit" ? (
        <PencilIcon className="h-4 w-4 shrink-0" />
      ) : (
        <PlusIcon
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-45")}
        />
      )}
      {label}
    </button>
  );
}

/**
 * The form's card. Renders nothing while closed, so a closed form costs the
 * page no height and holds no stale input. Escape and Cancel close it; the
 * first field takes focus when it opens, because the reader just asked to
 * type into it.
 */
export function CreatePanel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { open, setOpen, id } = useSlot();
  const ref = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!open) return;
    ref.current
      ?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select, [role=combobox]")
      ?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <section
      ref={ref}
      id={id}
      aria-label={title}
      onKeyDown={(e) => {
        // Peel one layer at a time: a Select closing its own listbox claims
        // the Escape first.
        if (e.key === "Escape" && !e.defaultPrevented) close();
      }}
      // 36rem: a create form is a few short fields, never the page's width (DESIGN.md W3).
      className={cn("rise-in max-w-xl rounded-xl bg-surface px-4 py-3 shadow-sm sm:px-5", className)}
    >
      {/* One way out in the panel — Cancel (and Escape). The title button that
          opened it toggles it shut too; a third × was one too many. */}
      <h2 className="mb-3 text-title font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      {children}
      <div className="mt-3 flex justify-end border-t border-line pt-3">
        <Button variant="ghost" size="sm" onClick={close}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
