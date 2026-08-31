import type { FxKind } from "../model/showModel";

/**
 * Effect model mapping. WING and M32 have different FX racks; this maps by
 * neutral `FxKind` and picks a nearest M32 `/fx/N` type token. Anything with
 * no sensible M32 equivalent maps to a plain reverb/delay/chorus and is
 * flagged in the conversion report.
 */

// WING model string -> neutral kind
const WING_FX_KIND: Array<[RegExp, FxKind]> = [
  [/DL|DLY|ECHO|TAPE/i, "delay"],
  [/HALL|ROOM|PLATE|CHAMBER|AMBI|REV|SPRING|VRM/i, "reverb"],
  [/CHOR|FLANG|PHAS|ROTA|TREM|MOD|DIMENS/i, "modulation"],
  [/GEQ|PEQ|EQ/i, "graphic-eq"],
  [/COMP|GATE|DYN|LIMIT|MAXI|EXCITE|ENHANC|DEESS/i, "dynamics"],
  [/PITCH|OCT|HARM|DETUNE/i, "pitch"],
  [/AMP|BASS|GUITAR|CAB|DRIVE|PRE/i, "amp-sim"],
];

// M32 /fx/N type token -> neutral kind (from the observed set)
const M32_FX_KIND: Record<string, FxKind> = {
  HALL: "reverb",
  AMBI: "reverb",
  RPLT: "reverb",
  PLAT: "reverb",
  RICH: "reverb",
  ROOM: "reverb",
  CHAM: "reverb",
  VRM: "reverb",
  GATE: "reverb",
  DLY: "delay",
  "3TAP": "delay",
  "4TAP": "delay",
  RTAP: "delay",
  CRS: "modulation",
  FLN: "modulation",
  PHA: "modulation",
  ROT: "modulation",
  DIM: "modulation",
  MODD: "modulation",
  CHRD: "modulation",
  GEQ: "graphic-eq",
  GEQ2: "graphic-eq",
  TEQ: "graphic-eq",
  TEQ2: "graphic-eq",
  DES: "dynamics",
  P1A: "dynamics",
  PIA: "dynamics",
  "P1A EQ": "dynamics",
  FAC: "dynamics",
  LEIS: "dynamics",
  ULC: "dynamics",
  ENH: "dynamics",
  EN2: "dynamics",
  EXC: "dynamics",
  PIT: "pitch",
  DUAL: "other",
};

// neutral kind -> preferred M32 type token
const KIND_TO_M32: Record<FxKind, string> = {
  reverb: "HALL",
  delay: "DLY",
  modulation: "CRS",
  "graphic-eq": "GEQ2",
  dynamics: "ENH",
  pitch: "PIT",
  "amp-sim": "CRS",
  other: "HALL",
};

export function classifyWingFx(model: string): FxKind {
  for (const [re, kind] of WING_FX_KIND) if (re.test(model)) return kind;
  return "other";
}

export function classifyM32Fx(type: string): FxKind {
  return M32_FX_KIND[type.toUpperCase()] ?? "other";
}

export function kindToM32Type(kind: FxKind): string {
  return KIND_TO_M32[kind] ?? "HALL";
}

/** True when the M32 target has a real equivalent for this kind. */
export function m32SupportsKind(kind: FxKind): boolean {
  return kind !== "amp-sim" && kind !== "other";
}
