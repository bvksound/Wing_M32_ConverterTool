import {
  emptyModel,
  type Bus,
  type Channel,
  type Compressor,
  type Dca,
  type Eq,
  type EqBand,
  type FxSlot,
  type Gate,
  type MuteGroup,
  type Send,
  type ShowModel,
} from "../model/showModel";
import { m32ColourToNeutral } from "../model/colour";
import { classifyM32Fx } from "../convert/fxMap";
import { ScnDocument } from "./scnDocument";
import { decodeFreq, decodeLevel, decodeMask, unquote } from "./tokens";

const CH_COUNT = 32;
const BUS_COUNT = 16;
const MTX_COUNT = 6;
const DCA_COUNT = 8;
const FX_COUNT = 8;
const AUX_COUNT = 8;

export function readM32(text: string): ShowModel {
  const doc = ScnDocument.parse(text);
  const m = emptyModel("m32", "scene");
  m.meta = { name: doc.header.name, notes: doc.header.notes || undefined };

  for (let i = 1; i <= CH_COUNT; i++) {
    m.channels.push(readStrip(doc, `/ch/${p2(i)}`, i, 4));
  }
  for (let i = 1; i <= AUX_COUNT; i++) {
    m.auxIns.push(readStrip(doc, `/auxin/${p2(i)}`, i, 4));
  }
  for (let i = 1; i <= BUS_COUNT; i++) {
    m.buses.push(readBus(doc, `/bus/${p2(i)}`, i));
  }
  for (let i = 1; i <= MTX_COUNT; i++) {
    m.matrices.push(readBus(doc, `/mtx/${p2(i)}`, i));
  }
  m.mains.push(readBus(doc, "/main/st", 1));
  if (doc.has("/main/m/config")) m.mains.push(readBus(doc, "/main/m", 2));

  for (let i = 1; i <= DCA_COUNT; i++) {
    m.dcas.push(readDca(doc, i));
  }
  for (let i = 1; i <= 6; i++) {
    m.muteGroups.push({ index: i, name: `MG ${i}`, muted: false });
  }
  for (let i = 1; i <= FX_COUNT; i++) {
    const fx = readFx(doc, i);
    if (fx) m.fx.push(fx);
  }

  readRouting(doc, m);
  m.config.mainMode = doc.get("/config/mono")?.[0];
  m.config.raw = collectPrefix(doc, "/config/");
  return m;
}

function readStrip(
  doc: ScnDocument,
  base: string,
  index: number,
  eqBands: number,
): Channel {
  const cfg = doc.get(`${base}/config`) ?? [];
  const preamp = doc.get(`${base}/preamp`) ?? [];
  const mix = doc.get(`${base}/mix`) ?? [];
  const grp = doc.get(`${base}/grp`) ?? [];
  const sourceIdx = Number(cfg[3] ?? 0);
  const headamp = sourceIdx > 0 ? doc.get(`/headamp/${p3(sourceIdx - 1)}`) : undefined;

  return {
    index,
    name: unquote(cfg[0] ?? '""'),
    colour: m32ColourToNeutral(cfg[2] ?? "OFF"),
    icon: Number(cfg[1] ?? 0),
    mute: false, // M32 channel mute lives in /mute state, not the strip; MG handled via mask
    fader: decodeLevel(mix[1] ?? "-oo"),
    pan: signed(mix[3]),
    width: 0,
    stereoLink: false,
    input: {
      source: sourceIdx ? `IN ${sourceIdx}` : "none",
      gain: headamp ? Number(headamp[0]) : undefined,
      phantom: headamp ? headamp[1] === "ON" : undefined,
      invert: preamp[1] === "ON",
      trim: numOr(preamp[0], 0),
      delayMs: numOr(doc.get(`${base}/delay`)?.[1], 0),
      delayOn: doc.get(`${base}/delay`)?.[0] === "ON",
    },
    highpass: {
      // /ch/NN/preamp <trim> <invert> <hpon> <hpslope> <hpf>
      on: preamp[2] === "ON",
      freq: decodeFreq(preamp[4] ?? "100"),
      slope: numOr(preamp[3], 12),
    },
    gate: readGate(doc, base),
    eq: readEq(doc, base, eqBands),
    comp: readComp(doc, base),
    sends: readSends(doc, base, BUS_COUNT),
    mainSends: [
      {
        to: 1,
        on: mix[2] === "ON",
        level: 0,
        pan: signed(mix[3]),
        tap: "post-fader",
      },
    ],
    dcaMask: decodeMask(grp[0] ?? "%00000000"),
    muteGroupMask: decodeMask(grp[1] ?? "%000000"),
  };
}

function readBus(doc: ScnDocument, base: string, index: number): Bus {
  const cfg = doc.get(`${base}/config`) ?? [];
  const mix = doc.get(`${base}/mix`) ?? [];
  const grp = doc.get(`${base}/grp`) ?? [];
  const eqBands = base.startsWith("/bus") || base.startsWith("/main") ? 6 : 6;
  return {
    index,
    name: unquote(cfg[0] ?? '""'),
    colour: m32ColourToNeutral(cfg[2] ?? cfg[1] ?? "OFF"),
    icon: Number(cfg[1] ?? 0),
    mono: false,
    mute: false,
    fader: decodeLevel(mix[1] ?? "-oo"),
    pan: signed(mix[3]),
    width: 0,
    eq: readEq(doc, base, eqBands),
    comp: readComp(doc, base),
    sends: readSends(doc, base, MTX_COUNT),
    mainSends: [
      { to: 1, on: mix[2] === "ON", level: 0, pan: signed(mix[3]), tap: "post-fader" },
    ],
    dcaMask: decodeMask(grp[0] ?? "%00000000"),
    muteGroupMask: decodeMask(grp[1] ?? "%000000"),
  };
}

function readSends(doc: ScnDocument, base: string, count: number): Send[] {
  const sends: Send[] = [];
  for (let i = 1; i <= count; i++) {
    const a = doc.get(`${base}/mix/${p2(i)}`);
    if (!a) continue;
    sends.push({
      to: i,
      on: a[0] === "ON",
      level: decodeLevel(a[1] ?? "-oo"),
      pan: a[2] !== undefined ? signed(a[2]) : 0,
      tap: m32Tap(a[3]),
    });
  }
  return sends;
}

function readEq(doc: ScnDocument, base: string, bands: number): Eq {
  const on = doc.get(`${base}/eq`)?.[0] === "ON";
  const out: EqBand[] = [];
  for (let i = 1; i <= bands; i++) {
    const a = doc.get(`${base}/eq/${i}`);
    if (!a) continue;
    out.push({
      type: m32BandType(a[0]),
      freq: decodeFreq(a[1] ?? "1k00"),
      gain: numOr(a[2], 0),
      q: numOr(a[3], 2),
    });
  }
  return { on, bands: out };
}

function readGate(doc: ScnDocument, base: string): Gate {
  const a = doc.get(`${base}/gate`) ?? [];
  return {
    on: a[0] === "ON",
    mode: a[1] === "EXP" ? "expander" : "gate",
    threshold: numOr(a[2], -40),
    range: numOr(a[3], 60),
    attackMs: numOr(a[4], 10),
    holdMs: numOr(a[5], 50),
    releaseMs: numOr(a[6], 200),
  };
}

function readComp(doc: ScnDocument, base: string): Compressor {
  const a = doc.get(`${base}/dyn`) ?? [];
  return {
    on: a[0] === "ON",
    mode: a[1] === "EXP" ? "expander" : "comp",
    detection: a[2] === "PEAK" ? "peak" : "rms",
    threshold: numOr(a[4], -20),
    ratio: numOr(a[5], 3),
    knee: numOr(a[6], 3),
    attackMs: numOr(a[8], 20),
    holdMs: numOr(a[9], 10),
    releaseMs: numOr(a[10], 150),
    gain: numOr(a[7], 0),
    mix: numOr(a[13], 100),
    auto: a[a.length - 1] === "ON",
  };
}

function readDca(doc: ScnDocument, i: number): Dca {
  const cfg = doc.get(`/dca/${i}/config`) ?? [];
  const state = doc.get(`/dca/${i}`) ?? [];
  return {
    index: i,
    name: unquote(cfg[0] ?? '""'),
    colour: m32ColourToNeutral(cfg[2] ?? "OFF"),
    mute: state[0] === "OFF",
    fader: decodeLevel(state[1] ?? "-oo"),
  };
}

function readFx(doc: ScnDocument, i: number): FxSlot | null {
  const type = doc.get(`/fx/${i}`)?.[0];
  if (!type) return null;
  const par = doc.get(`/fx/${i}/par`) ?? [];
  const src = doc.get(`/fx/${i}/source`) ?? [];
  const params: Record<string, number | string> = {};
  par.forEach((v, idx) => {
    const n = Number(v);
    params[`p${idx + 1}`] = Number.isNaN(n) ? v : n;
  });
  return {
    index: i,
    kind: classifyM32Fx(type),
    sourceModel: type,
    params,
    inputs: src.filter((s) => s && s !== "OFF"),
  };
}

function readRouting(doc: ScnDocument, m: ShowModel): void {
  for (const path of doc.paths("/config/routing/")) {
    m.routing.inputPatch.push({
      slot: path.replace("/config/routing/", ""),
      value: (doc.get(path) ?? []).join(" "),
    });
  }
  const userIn = doc.get("/config/userrout/in");
  if (userIn) m.routing.raw = { userIn: userIn.join(" ") };
}

// --- helpers -----------------------------------------------------------------

function m32Tap(token: string | undefined): Send["tap"] {
  switch (token) {
    case "IN":
      return "pre-eq";
    case "EQ->":
    case "PRE":
      return "pre-fader";
    case "POST":
      return "post-fader";
    case "GRP":
      return "group";
    default:
      return "post-fader";
  }
}

function m32BandType(token: string | undefined): EqBand["type"] {
  switch (token) {
    case "LShv":
      return "low-shelf";
    case "HShv":
      return "high-shelf";
    case "LCut":
      return "low-cut";
    case "HCut":
      return "high-cut";
    default:
      return "bell"; // PEQ, VEQ
  }
}

function collectPrefix(doc: ScnDocument, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of doc.paths(prefix)) out[path] = (doc.get(path) ?? []).join(" ");
  return out;
}

function p2(n: number): string {
  return String(n).padStart(2, "0");
}
function p3(n: number): string {
  return String(n).padStart(3, "0");
}
function numOr(token: string | undefined, fallback: number): number {
  if (token === undefined) return fallback;
  const n = Number(token);
  return Number.isNaN(n) ? fallback : n;
}
function signed(token: string | undefined): number {
  return numOr(token, 0);
}
