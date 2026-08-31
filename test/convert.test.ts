import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadShowFile, convert } from "../src/convert/convert";
import { selectAllDefault } from "../src/convert/types";
import { ScnDocument } from "../src/m32/scnDocument";

const ex = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../Examples/${rel}`, import.meta.url)), "latin1");

const M32 = ex("M32/M32R Backup.scn");
const WING_SNAP = ex("Wing/1_SNAPSHOTS/BVBA VANDAMME/BVBA Vandamme.snap");
const WING_CHN = ex("Wing/2_PRESETS/1_VOX SAM.chn");

describe("load + inventory", () => {
  it("detects and parses an M32 scene", () => {
    const l = loadShowFile("M32R Backup.scn", M32);
    expect(l.source).toBe("m32");
    expect(l.target).toBe("wing");
    expect(l.model.channels).toHaveLength(32);
    expect(l.model.channels[0]!.name).toBe("Kick");
    expect(l.inventory.root.find((n) => n.id === "channels")?.children).toHaveLength(32);
  });

  it("detects and parses a WING snapshot", () => {
    const l = loadShowFile("BVBA CLEAN.snap", WING_SNAP);
    expect(l.source).toBe("wing");
    expect(l.model.channels).toHaveLength(40);
    // WING channels above 32 must be flagged non-convertible for the M32 target.
    const ch40 = l.inventory.root
      .find((n) => n.id === "channels")!
      .children!.find((n) => n.id === "channels.40")!;
    expect(ch40.convertible).toBe(false);
  });

  it("detects a WING channel preset", () => {
    const l = loadShowFile("VOX SAM.chn", WING_CHN);
    expect(l.model.kind).toBe("channel-preset");
    expect(l.model.channels[0]!.eq?.bands.length).toBeGreaterThanOrEqual(4);
  });
});

describe("WING -> M32", () => {
  it("produces a scene that still parses and keeps untouched lines", () => {
    const l = loadShowFile("BVBA CLEAN.snap", WING_SNAP);
    const sel = selectAllDefault(l.inventory);
    const res = convert(l, sel);
    expect(res.filename).toMatch(/\(M32\)\.scn$/);
    const doc = ScnDocument.parse(res.text);
    expect(doc.header.version).toBe("4.0");
    // scene name comes from the dropped file name, not the stale internal path
    expect(doc.header.name).toBe("BVBA CLEAN");
    // channel count intact
    expect(doc.paths("/ch/").filter((p) => p.endsWith("/config"))).toHaveLength(32);
    // a WING channel name landed on the M32 strip
    const names = l.model.channels
      .slice(0, 32)
      .map((c) => c.name)
      .filter(Boolean);
    const firstNamed = names[0]!;
    expect(res.text).toContain(`"${firstNamed.slice(0, 12)}"`);
    // report mentions the dropped upper channels
    expect(res.report.some((r) => r.severity === "drop")).toBe(true);
  });
});

describe("high-cut / low-cut filters", () => {
  it("WING flt.hc -> M32 EQ band 4 HCut", () => {
    const j = JSON.parse(WING_CHN);
    j.ch_data.flt.lc = true;
    j.ch_data.flt.lcf = 65;
    j.ch_data.flt.hc = true;
    j.ch_data.flt.hcf = 9000;
    const l = loadShowFile("CONTRABAS.chn", JSON.stringify(j));
    const res = convert(l, selectAllDefault(l.inventory));
    const band4 = res.text.split("\n").find((x) => x.startsWith("/ch/01/eq/4"))!;
    expect(band4).toMatch(/^\/ch\/01\/eq\/4 HCut /);
    // low-cut still lands on the preamp HPF
    const preamp = res.text.split("\n").find((x) => x.startsWith("/ch/01/preamp"))!;
    expect(preamp.split(/\s+/)[3]).toBe("ON"); // hpon
    expect(res.report.some((r) => /high-cut/i.test(r.message))).toBe(true);
  });

  it("M32 EQ HCut band -> WING flt.hc", () => {
    const l = loadShowFile("M32R Backup.scn", M32);
    // ch 14 has "/ch/14/eq ON" with "/ch/14/eq/4 HCut 4k52 ..."
    const res = convert(l, selectAllDefault(l.inventory));
    const json = JSON.parse(res.text);
    expect(json.ae_data.ch["14"].flt.hc).toBe(true);
    expect(json.ae_data.ch["14"].flt.hcf).toBeGreaterThan(4000);
  });
});

describe("clear / blank a strip", () => {
  it("M32 -> WING: a cleared channel comes out blank regardless of selection", () => {
    const l = loadShowFile("M32R Backup.scn", M32);
    const sel = selectAllDefault(l.inventory);
    const res = convert(l, sel, new Set(["channels.1"]));
    const json = JSON.parse(res.text);
    expect(json.ae_data.ch["1"].name).toBe("");
    expect(json.ae_data.ch["1"].fdr).toBeLessThanOrEqual(-140);
    expect(json.ae_data.ch["1"].eq.on).toBe(false);
    // channel 2 still converted normally
    expect(json.ae_data.ch["2"].name).toBe("Snare");
    expect(res.report.some((r) => r.scope === "cleared")).toBe(true);
  });

  it("WING -> M32: a cleared channel is reset on the scene", () => {
    const l = loadShowFile("BVBA Vandamme.snap", WING_SNAP);
    const res = convert(l, selectAllDefault(l.inventory), new Set(["channels.1"]));
    const line = res.text.split("\n").find((x) => x.startsWith("/ch/01/config"))!;
    expect(line).toBe('/ch/01/config "" 1 OFF 1');
    expect(res.text.split("\n").find((x) => x === "/ch/01/eq OFF")).toBeTruthy();
  });
});

describe("M32 -> WING", () => {
  it("produces valid JSON with converted channel names", () => {
    const l = loadShowFile("M32R Backup.scn", M32);
    const sel = selectAllDefault(l.inventory);
    const res = convert(l, sel);
    expect(res.filename).toMatch(/\(WING\)\.snap$/);
    const json = JSON.parse(res.text);
    expect(json.ae_data.ch["1"].name).toBe("Kick");
    expect(json.type).toMatch(/^snapshot/);
  });

  it("round-trips a channel preset to .chn", () => {
    const l = loadShowFile("VOX SAM.chn", WING_CHN);
    const res = convert(l, selectAllDefault(l.inventory));
    // WING preset -> M32 target is a channel strip; ext should be scn
    expect(res.filename).toMatch(/\.scn$/);
    expect(() => ScnDocument.parse(res.text)).not.toThrow();
  });
});
