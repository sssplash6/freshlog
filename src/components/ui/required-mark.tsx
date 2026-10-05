/**
 * The asterisk after a required field's label. One glyph, one colour, one gap,
 * everywhere a form asks for something it cannot do without.
 *
 * It was typed by hand at every label, so it came out three ways: orange on
 * `Field` and the segmented controls, grey where a form wrote "Mentor *" into
 * its own muted label, and white where a legend wrote "Rating *" into ink. The
 * same form could show all three, and a reader takes three colours for three
 * meanings.
 *
 * Muted grey, not orange (October 2026). It was `accent-ink`, and orange
 * means hours in this app and nothing else; the bright form of it also sat at
 * 2.46:1. The star is a convention everybody reads without colour, and the
 * error state — red, with words — is what says something is actually missing.
 *
 * `aria-hidden`: the control itself carries `required`, which is what a screen
 * reader announces. Reading the star aloud as "star" says it a second time,
 * worse.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-muted-fg">
      {" *"}
    </span>
  );
}
