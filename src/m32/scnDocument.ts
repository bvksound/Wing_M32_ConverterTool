/**
 * A parsed M32 `.scn` scene as an ordered list of parameter lines plus a
 * path index. This is the "template + patch" substrate: we parse a known-good
 * scene, overwrite only the lines a conversion touches, and re-serialise —
 * every untouched line comes back byte-for-byte, so validity is preserved.
 */

import { tokenizeArgs, unquote } from "./tokens";

export interface ScnHeader {
  version: string; // e.g. "4.0"
  name: string;
  notes: string;
  scopeMask: string; // e.g. "%000000000"
  fxOn: string; // trailing flag token(s), kept verbatim
  raw: string;
}

interface ScnEntry {
  path: string;
  args: string[];
  /** Original source line; used verbatim unless `dirty`. */
  rawLine: string;
  dirty: boolean;
}

export class ScnDocument {
  header: ScnHeader;
  private entries: ScnEntry[] = [];
  private byPath = new Map<string, ScnEntry>();
  /** Trailing lines with no leading slash (rare); preserved verbatim. */
  private trailer: string[] = [];

  constructor(header: ScnHeader) {
    this.header = header;
  }

  static parse(text: string): ScnDocument {
    const lines = text.split(/\r?\n/);
    let headerLine = "";
    let idx = 0;
    for (; idx < lines.length; idx++) {
      if (lines[idx]!.trim() === "") continue;
      headerLine = lines[idx]!;
      idx++;
      break;
    }
    const doc = new ScnDocument(parseHeader(headerLine));
    for (; idx < lines.length; idx++) {
      const line = lines[idx]!;
      if (line.trim() === "") continue;
      if (!line.startsWith("/")) {
        doc.trailer.push(line);
        continue;
      }
      const sp = firstSpace(line);
      const path = sp === -1 ? line : line.slice(0, sp);
      const argStr = sp === -1 ? "" : line.slice(sp + 1);
      const entry: ScnEntry = {
        path,
        args: tokenizeArgs(argStr),
        rawLine: line,
        dirty: false,
      };
      doc.entries.push(entry);
      doc.byPath.set(path, entry);
    }
    return doc;
  }

  has(path: string): boolean {
    return this.byPath.has(path);
  }

  /** Raw token list for a path (including quotes on string tokens). */
  get(path: string): string[] | undefined {
    return this.byPath.get(path)?.args;
  }

  /** Convenience: a single arg with quotes stripped. */
  getArg(path: string, i: number): string | undefined {
    const a = this.byPath.get(path)?.args[i];
    return a === undefined ? undefined : unquote(a);
  }

  /**
   * Replace the argument list for an existing path. Marks the line dirty so it
   * is re-serialised with single-space separators. Throws if the path is not in
   * the template (conversions should only touch known lines).
   */
  set(path: string, args: string[]): void {
    const entry = this.byPath.get(path);
    if (!entry) {
      throw new Error(`ScnDocument.set: unknown path "${path}"`);
    }
    entry.args = args;
    entry.dirty = true;
  }

  /** Set one positional arg, keeping the rest. */
  setArg(path: string, i: number, value: string): void {
    const entry = this.byPath.get(path);
    if (!entry) throw new Error(`ScnDocument.setArg: unknown path "${path}"`);
    while (entry.args.length <= i) entry.args.push("0");
    entry.args[i] = value;
    entry.dirty = true;
  }

  /** All paths matching a prefix, in document order. */
  paths(prefix: string): string[] {
    return this.entries
      .filter((e) => e.path.startsWith(prefix))
      .map((e) => e.path);
  }

  serialize(): string {
    const out: string[] = [this.header.raw];
    for (const e of this.entries) {
      out.push(e.dirty ? `${e.path} ${e.args.join(" ")}`.trimEnd() : e.rawLine);
    }
    out.push(...this.trailer);
    return out.join("\n") + "\n";
  }
}

function firstSpace(line: string): number {
  const i = line.indexOf(" ");
  return i;
}

export function parseHeader(line: string): ScnHeader {
  // #4.0# "name" "notes" %000000000 1
  const m = /^#([\d.]+)#\s*(.*)$/.exec(line.trim());
  const version = m?.[1] ?? "4.0";
  const rest = m?.[2] ?? "";
  const toks = tokenizeArgs(rest);
  return {
    version,
    name: unquote(toks[0] ?? '""'),
    notes: unquote(toks[1] ?? '""'),
    scopeMask: toks[2] ?? "%000000000",
    fxOn: toks.slice(3).join(" "),
    raw: line,
  };
}

/** Rebuild the header `raw` string from its fields (used when name changes). */
export function formatHeader(h: ScnHeader): string {
  return `#${h.version}# "${h.name}" "${h.notes}" ${h.scopeMask} ${h.fxOn}`.trimEnd();
}
