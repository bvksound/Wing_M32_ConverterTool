import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ScnDocument } from "../src/m32/scnDocument";
import {
  decodeFreq,
  encodeFreq,
  decodeLevel,
  encodeLevel,
  decodeMask,
  encodeMask,
  tokenizeArgs,
} from "../src/m32/tokens";

const scnPath = fileURLToPath(
  new URL("../Examples/M32/M32R Backup.scn", import.meta.url),
);
const scnText = readFileSync(scnPath, "latin1");

describe("ScnDocument", () => {
  it("round-trips an untouched scene line-for-line", () => {
    const doc = ScnDocument.parse(scnText);
    const out = doc.serialize();
    // Compare ignoring a possible single trailing newline difference.
    expect(out.replace(/\n+$/, "")).toBe(scnText.replace(/\n+$/, ""));
  });

  it("indexes channel paths", () => {
    const doc = ScnDocument.parse(scnText);
    expect(doc.getArg("/ch/01/config", 0)).toBe("Kick");
    expect(doc.paths("/ch/01/eq/")).toEqual([
      "/ch/01/eq/1",
      "/ch/01/eq/2",
      "/ch/01/eq/3",
      "/ch/01/eq/4",
    ]);
  });

  it("only rewrites lines it changes", () => {
    const doc = ScnDocument.parse(scnText);
    doc.set("/ch/01/config", ['"Snare"', "1", "RD", "2"]);
    const out = doc.serialize().split("\n");
    expect(out.find((l) => l.startsWith("/ch/01/config "))).toBe(
      '/ch/01/config "Snare" 1 RD 2',
    );
    // A neighbour line is untouched.
    expect(out.find((l) => l.startsWith("/ch/02/config "))).toBe(
      scnText.split(/\r?\n/).find((l) => l.startsWith("/ch/02/config ")),
    );
  });
});

describe("token codecs", () => {
  it("frequencies", () => {
    expect(decodeFreq("3k94")).toBeCloseTo(3940);
    expect(decodeFreq("20k00")).toBe(20000);
    expect(decodeFreq("158.9")).toBeCloseTo(158.9);
    expect(encodeFreq(3940)).toBe("3k94");
    expect(encodeFreq(20000)).toBe("20k00");
    expect(encodeFreq(158.9)).toBe("158.9");
  });

  it("levels", () => {
    expect(decodeLevel("-oo")).toBe(-Infinity);
    expect(decodeLevel("-4.5")).toBe(-4.5);
    expect(encodeLevel(-Infinity)).toBe("-oo");
    expect(encodeLevel(-95)).toBe("-oo");
    expect(encodeLevel(-4.5)).toBe("-4.5");
    expect(encodeLevel(0, true)).toBe("+0.0");
  });

  it("masks", () => {
    expect(decodeMask("%00000001")).toBe(1);
    expect(decodeMask("%00000101")).toBe(5);
    expect(encodeMask(5, 8)).toBe("%00000101");
    expect(encodeMask(1, 6)).toBe("%000001");
  });

  it("tokenizer keeps quoted strings whole", () => {
    expect(tokenizeArgs('"Lead Vox" 1 YE 3')).toEqual([
      '"Lead Vox"',
      "1",
      "YE",
      "3",
    ]);
  });
});
