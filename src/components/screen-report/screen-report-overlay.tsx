"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type PointerEvent } from "react";

import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { SegmentedRadio } from "@/components/ui/segmented";
import { reportOnScreen } from "@/lib/actions/bugs";
import { BUG_DESCRIPTION_MAX, BUG_SHOT_ACCEPT, type ScreenReportState } from "@/lib/bugs";
import {
  boxFrom,
  captureScale,
  drawMarks,
  MIN_HIDE,
  penWidth,
  toImagePoint,
  type Mark,
  type Point,
} from "@/lib/screen-marks";
import { shrinkToBlob } from "@/lib/shrink-image";

/** Where the picture was taken, read when it was taken. */
export type CaptureContext = {
  pagePath: string | null;
  width: number;
  height: number;
  ratio: number;
  theme: string;
};

type Tool = "pen" | "hide";

const OFFLINE = "Couldn't send the report. Check your connection and try again.";

/** A picked image onto a canvas, shrunk if it is more pixels than a phone will draw. */
async function canvasFromFile(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, captureScale(bitmap.width, bitmap.height, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/**
 * The picture of the page, the marks drawn on it, and one caption.
 *
 * A native modal `<dialog>`: it holds focus, makes the page behind it inert,
 * sits above every popover and toast, and closes on Escape — four things a
 * hand-built overlay gets wrong one at a time. It carries `data-capture-skip`
 * so it is never in its own picture.
 *
 * The canvas holds the picture at full resolution and is shrunk to fit by CSS;
 * every pointer goes through `toImagePoint`, so a mark lands under the finger
 * however small the picture is drawn. On Send the canvas IS the report: the
 * marks are already burned in, Hide boxes included.
 *
 * A failed send keeps everything — the marks, the caption — and says why.
 */
export function ScreenReportOverlay({
  image,
  context,
  onClose,
}: {
  image: HTMLCanvasElement | null;
  context: CaptureContext;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const start = useRef<Point | null>(null);
  // The mark being drawn, in a ref as well as in state: pointer-up must see
  // the last point pointer-move added, not the one the last render saw.
  const drafting = useRef<Mark | null>(null);
  const inFlight = useRef(false);
  const [base, setBase] = useState<HTMLCanvasElement | null>(image);
  const [pickError, setPickError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<{ message: string; field?: "caption" } | null>(null);
  const [sending, startSending] = useTransition();
  // The theme's own tokens, read once: a red that means "this is the
  // problem", and the ink colour, which is opaque in both themes. Only ever
  // rendered in the browser, after a press, so the document is there.
  const [colors] = useState(() => {
    const css = getComputedStyle(document.documentElement);
    return {
      pen: css.getPropertyValue("--color-danger").trim(),
      hide: css.getPropertyValue("--color-ink").trim(),
    };
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !base) return;
    ctx.drawImage(base, 0, 0);
    const lineWidth = penWidth(base.width, canvas.getBoundingClientRect().width);
    drawMarks(ctx, draft ? [...marks, draft] : marks, colors, lineWidth);
  }, [base, marks, draft, colors]);

  function cancel() {
    if (!sending) onClose();
  }

  function point(event: PointerEvent<HTMLCanvasElement>): Point | null {
    if (!base) return null;
    return toImagePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), base);
  }

  function setDrafting(mark: Mark | null) {
    drafting.current = mark;
    setDraft(mark);
  }

  function down(event: PointerEvent<HTMLCanvasElement>) {
    const p = point(event);
    if (!p || sending) return;
    // So a stroke that leaves the canvas keeps drawing, clamped to its edge.
    // It throws for a pointer already gone; the stroke still works without it.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    start.current = p;
    setDrafting(tool === "pen" ? { kind: "pen", points: [p] } : boxFrom(p, p));
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    const p = point(event);
    const from = start.current;
    const d = drafting.current;
    if (!p || !from || !d) return;
    setDrafting(d.kind === "pen" ? { kind: "pen", points: [...d.points, p] } : boxFrom(from, p));
  }

  function up() {
    const done = drafting.current;
    start.current = null;
    setDrafting(null);
    if (!done) return;
    if (done.kind === "hide" && (done.w < MIN_HIDE || done.h < MIN_HIDE)) return;
    setMarks((m) => [...m, done]);
  }

  async function pick(file: File | undefined) {
    setPickError(null);
    if (!file) return;
    try {
      setBase(await canvasFromFile(file));
      setMarks([]);
    } catch {
      setPickError("That image couldn't be opened.");
    }
  }

  function send() {
    const canvas = canvasRef.current;
    // A ref, not `sending`: two presses in one frame both read the render
    // before the button went disabled, and each filed a report.
    if (!canvas || !base || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startSending(async () => {
      try {
        await sendFrom(canvas);
      } finally {
        inFlight.current = false;
      }
    });
  }

  /** The canvas IS the report: the marks are already burned into it. */
  async function sendFrom(canvas: HTMLCanvasElement) {
    let shot: Blob;
    try {
      shot = await shrinkToBlob(canvas);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "That image is too large to attach." });
      return;
    }
    const data = new FormData();
    data.set("caption", caption);
    data.set("screenshot", shot, "screenshot.webp");
    data.set("from", context.pagePath ?? "");
    data.set("width", String(context.width));
    data.set("height", String(context.height));
    data.set("ratio", String(context.ratio));
    data.set("theme", context.theme);
    data.set("userAgent", navigator.userAgent);
    data.set("marks", String(marks.length));

    let result: ScreenReportState;
    try {
      result = await reportOnScreen(null, data);
    } catch {
      setError({ message: OFFLINE });
      return;
    }
    if (result?.ok) {
      const id = result.id;
      onClose();
      toast({ message: "Report sent.", action: { label: "View", run: () => router.push(`/bugs/${id}`) } });
    } else if (result) {
      setError({ message: result.error, field: result.field });
    }
  }

  return (
    <dialog
      ref={dialogRef}
      data-capture-skip
      aria-labelledby="screen-report-title"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-surface text-ink backdrop:bg-ink/40 sm:m-auto sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[min(64rem,calc(100vw-2rem))] sm:rounded-2xl sm:shadow-lg"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="flex h-full flex-col gap-3 p-4 sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="screen-report-title" className="text-title font-semibold">
            Report a bug
          </h2>
          {base && (
            <div className="flex items-center gap-2">
              <SegmentedRadio
                name="screen-report-tool"
                legend={<span className="sr-only">Draw with</span>}
                options={[
                  { value: "pen", label: "Pen" },
                  { value: "hide", label: "Hide" },
                ]}
                defaultValue="pen"
                dense
                onChange={(value) => setTool(value === "hide" ? "hide" : "pen")}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={marks.length === 0 || sending}
                onClick={() => setMarks((m) => m.slice(0, -1))}
              >
                Undo
              </Button>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-fill">
          {base ? (
            <canvas
              ref={canvasRef}
              width={base.width}
              height={base.height}
              aria-label="The page as it looked. Draw on it to show what is wrong."
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              className={`block h-auto max-h-full w-auto max-w-full touch-none ${tool === "pen" ? "cursor-crosshair" : "cursor-cell"}`}
            />
          ) : (
            <div className="space-y-2 p-4 text-center">
              <p className="text-body text-ink">{"This page couldn't be captured."}</p>
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-surface px-4 text-body font-medium text-brand shadow-sm">
                Choose a screenshot instead
                <input
                  type="file"
                  accept={BUG_SHOT_ACCEPT}
                  className="sr-only"
                  onChange={(event) => void pick(event.target.files?.[0])}
                />
              </label>
              {pickError && <p className="text-xs text-danger-ink">{pickError}</p>}
            </div>
          )}
        </div>

        <Field
          label="What should change?"
          required
          hint="Only you and the people fixing it will see this."
          error={error?.field === "caption" ? error.message : undefined}
        >
          <Textarea
            name="caption"
            required
            rows={2}
            maxLength={BUG_DESCRIPTION_MAX}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </Field>

        {error && error.field !== "caption" && (
          <p role="alert" className="text-sm text-danger-ink">
            {error.message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={cancel} disabled={sending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!base || sending}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
