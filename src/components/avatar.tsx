import { avatarUrl, type AvatarPerson } from "@/lib/avatar";
import { cn } from "@/lib/cn";
import { initials, personTone } from "@/lib/person-tone";

type Person = AvatarPerson & { name: string | null; email: string };

/**
 * Someone's face, or their initials in their identity colour when they have no
 * picture set. One component so that every circle in the app — table chips,
 * stacked badges, the profile header — gains pictures at the same moment.
 *
 * `className` carries the box: size, and the text size the initials fall back
 * to (`h-6 w-6 text-[0.625rem]`). Decorative by default — the name is right next to
 * it in a chip — so pass `alt` only where the picture stands alone.
 */
export function Avatar({
  person,
  className,
  alt,
  title,
}: {
  person: Person;
  className?: string;
  alt?: string;
  title?: string;
}) {
  const src = avatarUrl(person);

  if (src) {
    // A plain <img>: /api/avatar is an auth-gated dynamic byte route, which the
    // next/image optimizer can neither read at build time nor improve on — the
    // bytes are already a 256px WebP.
    //
    // The ring is not decoration. A person's identity hue is what makes a
    // column of sessions readable without reading any names (DESIGN.md), and a
    // photograph carries no such hue — so the hue moves to the ring and the
    // scanning property survives the picture. It also does the work at the
    // sizes where a face is too small to recognise anyway.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt ?? ""}
        title={title}
        aria-hidden={alt ? undefined : true}
        className={cn(
          "shrink-0 rounded-full bg-canvas object-cover ring-2",
          personTone(person.id).ring,
          className
        )}
      />
    );
  }

  return (
    <span
      role={alt ? "img" : undefined}
      aria-label={alt}
      title={title}
      aria-hidden={alt ? undefined : true}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        personTone(person.id).badge,
        className
      )}
    >
      {initials(person.name, person.email)}
    </span>
  );
}
