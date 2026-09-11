import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeZip } from "../src/util/zip";

describe("makeZip", () => {
  it("produces an archive the system unzip can list and extract", () => {
    const entries = [
      { name: "01_Kick.chn", data: JSON.stringify({ type: "chpreset.11", name: "Kick" }) },
      { name: "02_Snare.chn", data: JSON.stringify({ type: "chpreset.11", name: "Snare" }) },
    ];
    const blob = makeZip(entries);
    const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    const zipPath = join(dir, "out.zip");

    return blob.arrayBuffer().then((buf) => {
      writeFileSync(zipPath, Buffer.from(buf));
      const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
      expect(listing).toContain("01_Kick.chn");
      expect(listing).toContain("02_Snare.chn");

      execFileSync("unzip", ["-o", zipPath, "-d", dir]);
      const extracted = execFileSync("cat", [join(dir, "01_Kick.chn")], { encoding: "utf8" });
      expect(JSON.parse(extracted)).toEqual({ type: "chpreset.11", name: "Kick" });
    });
  });

  it("handles zero entries", () => {
    const blob = makeZip([]);
    expect(blob.size).toBeGreaterThan(0); // still a valid (empty) archive
  });
});
