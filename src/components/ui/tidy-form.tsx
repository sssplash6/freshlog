"use client";

import Form from "next/form";
import type { ComponentProps } from "react";

/**
 * A GET form that leaves empty fields out of the address.
 *
 * A search on Sessions with nothing else chosen went to
 * `?q=zzzz&program=&attendance=&kind=&status=&from=&to=` — six empty
 * parameters riding every shared link and every bookmark (October 2026 audit).
 * An empty field means "no filter", which is exactly what an absent parameter
 * means, so they are dropped.
 *
 * The empty inputs are disabled for the instant the form is read — a disabled
 * control is not part of a submission — and switched back a tick later, so the
 * page the reader is still looking at keeps its fields.
 */
export function TidyForm(props: ComponentProps<typeof Form>) {
  return (
    <Form
      {...props}
      onSubmit={(event) => {
        props.onSubmit?.(event);
        const form = event.currentTarget;
        const emptied: HTMLInputElement[] = [];
        for (const el of Array.from(form.elements)) {
          if (
            el instanceof HTMLInputElement &&
            el.name &&
            !el.disabled &&
            el.type !== "submit" &&
            el.value === ""
          ) {
            el.disabled = true;
            emptied.push(el);
          }
        }
        setTimeout(() => emptied.forEach((el) => (el.disabled = false)), 0);
      }}
    />
  );
}
