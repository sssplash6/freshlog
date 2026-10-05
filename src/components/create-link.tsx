import { PlusIcon } from "@/components/icons";
import { LinkButton } from "@/components/ui/button";

/**
 * The create button for a page whose "new" lives on another page — Students'
 * "Add students", which happens on a program. It looks exactly like
 * `CreateButton` (page-create.tsx) and sits in the same slot, so the reader
 * never has to know which of the two kinds of "new" they are pressing.
 */
export function CreateLink({ href, label }: { href: string; label: string }) {
  return (
    <LinkButton href={href} variant="secondary" className="gap-1.5">
      <PlusIcon className="h-4 w-4 shrink-0" />
      {label}
    </LinkButton>
  );
}
