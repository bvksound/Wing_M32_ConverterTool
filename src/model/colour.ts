import type { ColourName } from "./showModel";

/**
 * Strip-colour mapping between the two consoles and the neutral palette.
 *
 * M32 uses two-letter codes (optionally suffixed `i` for the inverted/filled
 * variant). WING uses a 1..12 palette index. Neither palette is a superset of
 * the other, so this is a best-effort nearest-colour map.
 */

const M32_TO_NEUTRAL: Record<string, ColourName> = {
  OFF: "off",
  RD: "red",
  GN: "green",
  YE: "yellow",
  BL: "blue",
  MG: "magenta",
  CY: "cyan",
  WH: "white",
};

const NEUTRAL_TO_M32: Record<ColourName, string> = {
  off: "OFF",
  red: "RD",
  green: "GN",
  yellow: "YE",
  blue: "BL",
  magenta: "MG",
  cyan: "CY",
  white: "WH",
  orange: "YE",
  purple: "MG",
};

// WING palette index -> neutral. Indices from observed snapshots; the WING
// palette runs roughly: 1 blue, 2 sky, 3 cyan, 4 green, 5 mint, 6 yellow,
// 7 orange, 8 red, 9 pink, 10 purple, 11 grey, 12 white.
const WING_TO_NEUTRAL: Record<number, ColourName> = {
  0: "off",
  1: "blue",
  2: "blue",
  3: "cyan",
  4: "green",
  5: "green",
  6: "yellow",
  7: "orange",
  8: "red",
  9: "magenta",
  10: "purple",
  11: "white",
  12: "white",
  13: "cyan",
  14: "green",
  15: "yellow",
};

const NEUTRAL_TO_WING: Record<ColourName, number> = {
  off: 0,
  blue: 1,
  cyan: 3,
  green: 4,
  yellow: 6,
  orange: 7,
  red: 8,
  magenta: 9,
  purple: 10,
  white: 12,
};

export function m32ColourToNeutral(code: string): ColourName {
  const base = code.replace(/i$/, "");
  return M32_TO_NEUTRAL[base] ?? "off";
}

export function neutralColourToM32(name: ColourName): string {
  return NEUTRAL_TO_M32[name] ?? "OFF";
}

export function wingColourToNeutral(index: number): ColourName {
  return WING_TO_NEUTRAL[index] ?? "off";
}

export function neutralColourToWing(name: ColourName): number {
  return NEUTRAL_TO_WING[name] ?? 0;
}
