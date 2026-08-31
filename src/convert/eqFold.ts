import type { EqBand } from "../model/showModel";

/**
 * Reduce an EQ to `targetBands` bands. Keeps the outer shelves (or the lowest /
 * highest bells if there are no shelves) and then the most tonally-active
 * remaining bands by |gain|. Returns bands ordered low→high frequency.
 */
export function foldEq(bands: EqBand[], targetBands: number): {
  bands: EqBand[];
  dropped: EqBand[];
} {
  if (bands.length <= targetBands) return { bands: [...bands], dropped: [] };

  const sorted = [...bands].sort((a, b) => a.freq - b.freq);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const keep = new Set<EqBand>([first, last]);

  const middle = sorted
    .filter((b) => !keep.has(b))
    .sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain));

  for (const b of middle) {
    if (keep.size >= targetBands) break;
    keep.add(b);
  }

  const kept = sorted.filter((b) => keep.has(b));
  const dropped = sorted.filter((b) => !keep.has(b));
  return { bands: kept, dropped };
}

/** Coerce a neutral band to an M32 band-type token for a given slot position. */
export function m32BandToken(
  band: EqBand,
  position: "first" | "last" | "mid",
): string {
  switch (band.type) {
    case "low-shelf":
      return "LShv";
    case "high-shelf":
      return "HShv";
    case "low-cut":
      return "LCut";
    case "high-cut":
      return "HCut";
    default:
      if (position === "first" && band.gain === 0) return "LShv";
      if (position === "last" && band.gain === 0) return "HShv";
      // A deep, high bell that ends up in the top slot is functionally a
      // top-end roll-off. The M32 only has 4 bands, so keeping it as a narrow
      // PEQ leaves the octaves below it un-attenuated and the curve springs
      // back up between bands — a high shelf tracks the WING roll-off better.
      if (position === "last" && band.gain <= -10 && band.freq >= 4000) {
        return "HShv";
      }
      if (position === "first" && band.gain <= -10 && band.freq <= 120) {
        return "LShv";
      }
      return "PEQ";
  }
}
