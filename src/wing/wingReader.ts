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
import { wingColourToNeutral } from "../model/colour";
import { classifyWingFx } from "../convert/fxMap";
import { WingDoc, isObj, numericKeys, type Json } from "./wingDoc";

const OFF_DB = -144;

export function readWing(text: string): ShowModel {
  const doc = WingDoc.parse(text);
  if (doc.isChannelPreset) return readWingPreset(doc);
  return readWingSnapshot(doc);
}

function readWingSnapshot(doc: WingDoc): ShowModel {
  const m = emptyModel("wing", "scene");
  m.meta = {
    name: str(doc.root.active_scene) || "WING snapshot",
    firmware: str(doc.root.creator_fw),
    model: str(doc.root.creator_model),
    createdBy: str(doc.root.creator_name),
    createdAt: str(doc.root.created),
  };

  const ae = doc.ae;
  const io = isObj(ae.io) ? ae.io : {};

  for (const key of numericKeys(ae.ch)) {
    m.channels.push(readChannel(Number(key), obj(ae.ch, key), io));
  }
  for (const key of numericKeys(ae.aux)) {
    m.auxIns.push(readChannel(Number(key), obj(ae.aux, key), io));
  }
  for (const key of numericKeys(ae.bus)) {
    m.buses.push(readBus(Number(key), obj(ae.bus, key)));
  }
  for (const key of numericKeys(ae.mtx)) {
    m.matrices.push(readBus(Number(key), obj(ae.mtx, key)));
  }
  for (const key of numericKeys(ae.main)) {
    m.mains.push(readBus(Number(key), obj(ae.main, key)));
  }
  for (const key of numericKeys(ae.dca)) {
    m.dcas.push(readDca(Number(key), obj(ae.dca, key)));
  }
  for (const key of numericKeys(ae.mgrp)) {
    m.muteGroups.push(readMuteGroup(Number(key), obj(ae.mgrp, key)));
  }
  for (const key of numericKeys(ae.fx)) {
    const fx = readFx(Number(key), obj(ae.fx, key));
    if (fx) m.fx.push(fx);
  }

  m.routing.raw = { io };
  m.config.raw = isObj(ae.cfg) ? ae.cfg : undefined;
  return m;
}

function readWingPreset(doc: WingDoc): ShowModel {
  const m = emptyModel("wing", "channel-preset");
  m.meta = {
    name: str(doc.root.info_text) || "WING channel preset",
    firmware: str(doc.root.creator_fw),
    model: str(doc.root.creator_model),
  };
  const chData = isObj(doc.root.ch_data) ? doc.root.ch_data : {};
  const src = num(doc.root.source_channel) ?? 1;
  m.channels.push(readChannel(src, chData, {}));
  return m;
}

function readChannel(
  index: number,
  c: Record<string, Json>,
  io: Record<string, Json>,
): Channel {
  const sends: Send[] = [];
  const sendObj = isObj(c.send) ? c.send : {};
  for (const k of Object.keys(sendObj)) {
    if (!/^\d+$/.test(k)) continue; // bus sends 1..16; MX* handled as matrix sends elsewhere
    const s = obj(sendObj, k);
    sends.push({
      to: Number(k),
      on: bool(s.on),
      level: db(num(s.lvl)),
      pan: num(s.pan) ?? 0,
      tap: wingSendTap(str(s.mode)),
    });
  }
  const matrixSends: Send[] = [];
  for (const k of Object.keys(sendObj)) {
    const mx = /^MX(\d+)$/.exec(k);
    if (!mx) continue;
    const s = obj(sendObj, k);
    matrixSends.push({
      to: Number(mx[1]),
      on: bool(s.on),
      level: db(num(s.lvl)),
      pan: num(s.pan) ?? 0,
      tap: wingSendTap(str(s.mode)),
    });
  }

  const mainSends: Send[] = [];
  const mainObj = isObj(c.main) ? c.main : {};
  for (const k of numericKeys(mainObj)) {
    const s = obj(mainObj, k);
    mainSends.push({
      to: Number(k),
      on: bool(s.on),
      level: db(num(s.lvl)),
      pan: 0,
      tap: bool(s.pre) ? "pre-fader" : "post-fader",
    });
  }

  const tags = str(c.tags) ?? "";
  const conn = isObj(c.in) && isObj(c.in.set) ? c.in : {};
  const inSet = isObj((conn as Record<string, Json>).set)
    ? obj(conn as Record<string, Json>, "set")
    : {};
  const inConn = isObj(c.in) && isObj((c.in as Record<string, Json>).conn)
    ? obj(c.in as Record<string, Json>, "conn")
    : {};

  const input = readInput(inSet, inConn, io);
  // On the WING the strip name is usually blank — operators name the physical
  // source instead, and the console shows that. Fall back to it.
  const name = (str(c.name) ?? "").trim() || input?.sourceName || "";

  return {
    index,
    name,
    colour: wingColourToNeutral(num(c.col) ?? 0),
    icon: num(c.icon),
    mute: bool(c.mute),
    fader: db(num(c.fdr)),
    pan: num(c.pan) ?? 0,
    width: num(c.wid) ?? 0,
    stereoLink: bool(c.clink),
    input,
    highpass: readFilter(c.flt, "lc"),
    lowpass: readFilter(c.flt, "hc"),
    gate: readGate(c.gate),
    eq: readEq(c.eq),
    comp: readComp(c.dyn),
    sends,
    mainSends,
    dcaMask: tagMask(tags, "D"),
    muteGroupMask: tagMask(tags, "M"),
    raw: { matrixSends, proc: c.proc, ptap: c.ptap, peq: c.peq },
  };
}

function readInput(
  set: Record<string, Json>,
  conn: Record<string, Json>,
  io: Record<string, Json>,
): Channel["input"] {
  const grp = str(conn.grp) ?? "OFF";
  const inNo = num(conn.in) ?? 0;
  const source = grp === "OFF" ? "none" : `${grp} ${inNo}`;
  let gain: number | undefined;
  let phantom: boolean | undefined;
  let sourceName: string | undefined;
  const grpObj = isObj(io.in) ? obj(io.in as Record<string, Json>, grp) : {};
  const srcObj = isObj(grpObj) ? obj(grpObj, String(inNo)) : {};
  if (isObj(srcObj) && Object.keys(srcObj).length) {
    gain = num(srcObj.g);
    phantom = bool(srcObj.vph);
    sourceName = (str(srcObj.name) ?? "").trim() || undefined;
  }
  return {
    source,
    sourceName,
    gain,
    phantom,
    invert: bool(set.inv),
    trim: num(set.trim),
    delayMs: num(set.dly),
    delayOn: bool(set.dlyon),
  };
}

function readFilter(flt: Json | undefined, prefix: "lc" | "hc"): Channel["highpass"] {
  if (!isObj(flt)) return undefined;
  return {
    on: bool(flt[prefix]),
    freq: num(flt[`${prefix}f`]) ?? (prefix === "lc" ? 100 : 10000),
    slope: numFromStr(flt[`${prefix}s`]),
  };
}

function readEq(eq: Json | undefined): Eq | undefined {
  if (!isObj(eq)) return undefined;
  const bands: EqBand[] = [];
  bands.push({
    type: str(eq.leq) === "PEQ" ? "bell" : "low-shelf",
    freq: num(eq.lf) ?? 80,
    gain: num(eq.lg) ?? 0,
    q: num(eq.lq) ?? 1,
  });
  for (let i = 1; i <= 4; i++) {
    if (eq[`${i}f`] === undefined) continue;
    bands.push({
      type: "bell",
      freq: num(eq[`${i}f`]) ?? 1000,
      gain: num(eq[`${i}g`]) ?? 0,
      q: num(eq[`${i}q`]) ?? 1,
    });
  }
  bands.push({
    type: str(eq.heq) === "PEQ" ? "bell" : "high-shelf",
    freq: num(eq.hf) ?? 12000,
    gain: num(eq.hg) ?? 0,
    q: num(eq.hq) ?? 1,
  });
  return { on: bool(eq.on), model: str(eq.mdl), bands };
}

function readGate(g: Json | undefined): Gate | undefined {
  if (!isObj(g)) return undefined;
  return {
    on: bool(g.on),
    model: str(g.mdl),
    threshold: num(g.thr) ?? -40,
    range: num(g.range) ?? 40,
    attackMs: num(g.att) ?? 10,
    holdMs: num(g.hld) ?? 10,
    releaseMs: num(g.rel) ?? 200,
    ratio: ratioFromStr(g.ratio),
    sidechainOn: false,
  };
}

function readComp(d: Json | undefined): Compressor | undefined {
  if (!isObj(d)) return undefined;
  return {
    on: bool(d.on),
    model: str(d.mdl),
    detection: str(d.det) === "PEAK" ? "peak" : "rms",
    threshold: num(d.thr) ?? -20,
    ratio: typeof d.ratio === "number" ? d.ratio : ratioFromStr(d.ratio) ?? 3,
    knee: num(d.knee) ?? 3,
    attackMs: num(d.att) ?? 20,
    holdMs: num(d.hld) ?? 10,
    releaseMs: num(d.rel) ?? 150,
    gain: num(d.gain) ?? 0,
    mix: num(d.mix) ?? 100,
    auto: bool(d.auto),
    sidechainOn: false,
  };
}

function readBus(index: number, b: Record<string, Json>): Bus {
  const sends: Send[] = [];
  const matrixSends: Send[] = [];
  const sendObj = isObj(b.send) ? b.send : {};
  for (const k of Object.keys(sendObj)) {
    const mx = /^MX(\d+)$/.exec(k);
    const s = obj(sendObj, k);
    const entry: Send = {
      to: mx ? Number(mx[1]) : Number(k),
      on: bool(s.on),
      level: db(num(s.lvl)),
      pan: num(s.pan) ?? 0,
      tap: wingSendTap(str(s.mode)),
    };
    if (mx) matrixSends.push(entry);
    else if (/^\d+$/.test(k)) sends.push(entry);
  }
  const mainSends: Send[] = [];
  const mainObj = isObj(b.main) ? b.main : {};
  for (const k of numericKeys(mainObj)) {
    const s = obj(mainObj, k);
    mainSends.push({
      to: Number(k),
      on: bool(s.on),
      level: db(num(s.lvl)),
      pan: 0,
      tap: bool(s.pre) ? "pre-fader" : "post-fader",
    });
  }
  const tags = str(b.tags) ?? "";
  return {
    index,
    name: str(b.name) ?? "",
    colour: wingColourToNeutral(num(b.col) ?? 0),
    icon: num(b.icon),
    mono: bool(b.busmono),
    mute: bool(b.mute),
    fader: db(num(b.fdr)),
    pan: num(b.pan) ?? 0,
    width: num(b.wid) ?? 0,
    eq: readEq(b.eq),
    comp: readComp(b.dyn),
    sends,
    mainSends,
    dcaMask: tagMask(tags, "D"),
    muteGroupMask: tagMask(tags, "M"),
    raw: { matrixSends },
  };
}

function readDca(index: number, d: Record<string, Json>): Dca {
  return {
    index,
    name: str(d.name) ?? "",
    colour: wingColourToNeutral(num(d.col) ?? 0),
    mute: bool(d.mute),
    fader: db(num(d.fdr)),
  };
}

function readMuteGroup(index: number, g: Record<string, Json>): MuteGroup {
  return { index, name: str(g.name) ?? `MG ${index}`, muted: bool(g.mute) };
}

function readFx(index: number, f: Record<string, Json>): FxSlot | null {
  const model = str(f.mdl) ?? "NONE";
  if (model === "NONE" || model === "") return null;
  const params: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === "mdl") continue;
    if (typeof v === "number" || typeof v === "string") params[k] = v;
  }
  return {
    index,
    kind: classifyWingFx(model),
    sourceModel: model,
    params,
    inputs: [],
    raw: { ...f },
  };
}

// --- token helpers -------------------------------------------------------------

function wingSendTap(mode: string | undefined): Send["tap"] {
  switch (mode) {
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

function tagMask(tags: string, letter: "D" | "M"): number {
  let mask = 0;
  const re = new RegExp(`#${letter}(\\d+)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(tags))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 32) mask |= 1 << (n - 1);
  }
  return mask;
}

function db(v: number | undefined): number {
  if (v === undefined) return -Infinity;
  return v <= OFF_DB ? -Infinity : v;
}

function ratioFromStr(v: Json | undefined): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(v);
    if (m) return Number(m[2]) / Number(m[1]);
  }
  return undefined;
}

function numFromStr(v: Json | undefined): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function obj(parent: Json | undefined, key: string): Record<string, Json> {
  if (isObj(parent) && isObj(parent[key])) return parent[key] as Record<string, Json>;
  return {};
}
function num(v: Json | undefined): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function str(v: Json | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function bool(v: Json | undefined): boolean {
  return v === true;
}
