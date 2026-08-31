import type { Platform, ShowModel } from "../model/showModel";
import { readM32 } from "../m32/m32Reader";
import { writeM32 } from "../m32/m32Writer";
import { readWing } from "../wing/wingReader";
import { writeWing } from "../wing/wingWriter";
import { buildInventory } from "./inventory";
import type { ConversionResult, Inventory, ReportEntry, Selection } from "./types";

export interface LoadedFile {
  filename: string;
  model: ShowModel;
  source: Platform;
  target: Platform;
  inventory: Inventory;
}

/** Sniff a dropped file and parse it into a model + inventory. */
export function loadShowFile(filename: string, text: string): LoadedFile {
  const source = detectPlatform(filename, text);
  const model = source === "m32" ? readM32(text) : readWing(text);
  const target: Platform = source === "m32" ? "wing" : "m32";

  // The dropped file's own name is the most reliable show name — the internal
  // fields (WING `active_scene`, even the M32 header) are often stale paths.
  const stem = filename.replace(/.*[\\/]/, "").replace(/\.[^.]+$/, "").trim();
  if (stem) model.meta.name = stem;

  return {
    filename,
    model,
    source,
    target,
    inventory: buildInventory(model, target),
  };
}

export function detectPlatform(filename: string, text: string): Platform {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".scn")) return "m32";
  if (lower.endsWith(".snap") || lower.endsWith(".chn")) return "wing";
  const trimmed = text.trimStart();
  if (trimmed.startsWith("#") && /^#[\d.]+#/.test(trimmed)) return "m32";
  if (trimmed.startsWith("{")) return "wing";
  throw new Error(`Cannot determine console type for "${filename}".`);
}

export function convert(loaded: LoadedFile, selection: Selection): ConversionResult {
  const report: ReportEntry[] = [];
  const { model, target } = loaded;

  const text =
    target === "m32"
      ? writeM32(model, selection, report)
      : writeWing(model, selection, report);

  summarise(loaded, selection, report);

  const base = stripExt(loaded.filename);
  const ext = target === "m32" ? "scn" : model.kind === "channel-preset" ? "chn" : "snap";
  return {
    filename: `${base} (${target.toUpperCase()}).${ext}`,
    text,
    mime: target === "m32" ? "text/plain" : "application/json",
    report: report.sort(bySeverity),
  };
}

function summarise(loaded: LoadedFile, selection: Selection, report: ReportEntry[]): void {
  const { model, source, target } = loaded;
  const t = target.toUpperCase();

  if (source === "wing" && target === "m32") {
    const lostCh = model.channels.filter((c) => c.index > 32 && used(c)).length;
    if (lostCh)
      report.push({
        severity: "drop",
        scope: "channels",
        message: `${lostCh} WING channel(s) above 32 have content and cannot exist on the M32.`,
      });
    if (model.matrices.length > 6)
      report.push({ severity: "drop", scope: "matrices", message: `WING matrices 7–8 dropped (M32 has 6).` });
    if (model.dcas.filter((d) => d.index > 8 && (d.name || d.fader > -90)).length)
      report.push({ severity: "drop", scope: "dcas", message: `WING DCAs above 8 dropped (M32 has 8).` });
  }

  const picked = countLeaves(selection);
  report.unshift({
    severity: "info",
    scope: "summary",
    message: `${picked} item(s) selected → ${t}. Everything not selected keeps the target template's values.`,
  });
}

function used(c: ShowModel["channels"][number]): boolean {
  return Boolean(c.name.trim()) || (Number.isFinite(c.fader) && c.fader > -90);
}
function countLeaves(sel: Selection): number {
  return sel.size;
}
function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}
function bySeverity(a: ReportEntry, b: ReportEntry): number {
  const rank = (e: ReportEntry) => {
    if (e.scope === "summary") return -1;
    return { drop: 0, warn: 1, info: 2, ok: 3 }[e.severity] ?? 9;
  };
  return rank(a) - rank(b);
}
