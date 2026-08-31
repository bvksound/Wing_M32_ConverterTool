/**
 * Thin wrapper around a parsed WING `.snap` / `.chn` JSON tree.
 *
 * Same "template + patch" idea as ScnDocument: the writer deep-clones a
 * known-good snapshot and calls `set(path, value)` for the fields a conversion
 * produces; everything else stays exactly as the template had it.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export class WingDoc {
  readonly root: Record<string, Json>;

  constructor(root: Record<string, Json>) {
    this.root = root;
  }

  static parse(text: string): WingDoc {
    return new WingDoc(JSON.parse(text));
  }

  clone(): WingDoc {
    return new WingDoc(structuredClone(this.root));
  }

  get type(): string {
    return typeof this.root.type === "string" ? this.root.type : "";
  }

  get isChannelPreset(): boolean {
    return this.type.startsWith("chpreset");
  }

  get isSnapshot(): boolean {
    return this.type.startsWith("snapshot");
  }

  /** `ae_data` for snapshots, `ch_data` re-homed under `ae_data.ch.<n>` shape for presets. */
  get ae(): Record<string, Json> {
    const ae = this.root.ae_data;
    return isObj(ae) ? ae : {};
  }

  /**
   * Read a value by dotted path, e.g. `get("ch.1.eq.on")`. Numeric-looking
   * segments index object keys (WING uses string keys "1".."40"). Returns
   * undefined if any segment is missing.
   */
  get(path: string, base: Json = this.root): Json | undefined {
    let cur: Json | undefined = base;
    for (const seg of path.split(".")) {
      if (!isObj(cur)) return undefined;
      cur = cur[seg];
    }
    return cur;
  }

  getNum(path: string, base?: Json): number | undefined {
    const v = this.get(path, base);
    return typeof v === "number" ? v : undefined;
  }

  getStr(path: string, base?: Json): string | undefined {
    const v = this.get(path, base);
    return typeof v === "string" ? v : undefined;
  }

  getBool(path: string, base?: Json): boolean | undefined {
    const v = this.get(path, base);
    return typeof v === "boolean" ? v : undefined;
  }

  /**
   * Write a value by dotted path, creating intermediate objects as needed.
   * Only writes when the leaf already exists in the template OR `force` is set,
   * so a conversion can't smuggle unknown keys into a WING file by accident.
   */
  set(path: string, value: Json, force = false): boolean {
    const segs = path.split(".");
    const leaf = segs.pop()!;
    let cur: Record<string, Json> = this.root;
    for (const seg of segs) {
      const next = cur[seg];
      if (!isObj(next)) {
        if (!force) return false;
        cur[seg] = {};
      }
      cur = cur[seg] as Record<string, Json>;
    }
    if (!(leaf in cur) && !force) return false;
    cur[leaf] = value;
    return true;
  }

  serialize(): string {
    // WING writes its .snap / .chn files as a single minified line.
    return JSON.stringify(this.root);
  }
}

export function isObj(v: unknown): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Object keys "1".."N" in numeric order. */
export function numericKeys(o: Json | undefined): string[] {
  if (!isObj(o)) return [];
  return Object.keys(o)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));
}
