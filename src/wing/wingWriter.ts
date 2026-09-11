import type {
  Bus,
  Channel,
  Compressor,
  Eq,
  Gate,
  ShowModel,
} from "../model/showModel";
import { neutralColourToWing } from "../model/colour";
import type { ClearSet, ReportEntry, Selection } from "../convert/types";
import wingSnapTemplate from "../templates/wing-default.snap?raw";
import wingChnTemplate from "../templates/wing-default.chn?raw";
import { WingDoc, isObj, numericKeys, type Json } from "./wingDoc";

const OFF_DB = -144;

export function writeWing(
  model: ShowModel,
  selection: Selection,
  cleared: ClearSet,
  report: ReportEntry[],
): string {
  if (model.kind === "channel-preset") {
    return writeWingPreset(model, selection, report);
  }
  const doc = WingDoc.parse(wingSnapTemplate);
  const on = (id: string) => selection.has(id);

  for (const ch of model.channels) {
    const b = `ae_data.ch.${ch.index}`;
    if (!isObj(doc.get(b))) break; // template only has 40
    if (cleared.has(`channels.${ch.index}`)) {
      clearWingStrip(doc, b, 16, "");
      continue;
    }
    if (on(`channels.${ch.index}.strip`)) writeStrip(doc, b, ch);
    if (on(`channels.${ch.index}.input`)) writeInput(doc, b, ch, model, report);
    if (on(`channels.${ch.index}.eq`) && ch.eq) writeChannelEq(doc, b, ch.eq);
    if (on(`channels.${ch.index}.gate`) && ch.gate) writeGate(doc, `${b}.gate`, ch.gate);
    if (on(`channels.${ch.index}.comp`) && ch.comp) writeComp(doc, `${b}.dyn`, ch.comp);
    if (on(`channels.${ch.index}.sends`)) writeSends(doc, b, ch.sends, 16);
    if (on(`channels.${ch.index}.strip`)) writeTags(doc, b, ch.dcaMask, ch.muteGroupMask);
  }

  for (const bus of model.buses) {
    const b = `ae_data.bus.${bus.index}`;
    if (!isObj(doc.get(b))) break;
    if (cleared.has(`buses.${bus.index}`)) {
      clearWingStrip(doc, b, 8, "MX");
      continue;
    }
    if (on(`buses.${bus.index}.strip`)) writeBusStrip(doc, b, bus);
    if (on(`buses.${bus.index}.eq`) && bus.eq) writeEq(doc, `${b}.eq`, bus.eq);
    if (on(`buses.${bus.index}.comp`) && bus.comp) writeComp(doc, `${b}.dyn`, bus.comp);
    if (on(`buses.${bus.index}.sends`)) writeSends(doc, b, bus.sends, 8, "MX");
  }

  for (const mtx of model.matrices) {
    const b = `ae_data.mtx.${mtx.index}`;
    if (!isObj(doc.get(b))) break;
    if (cleared.has(`matrices.${mtx.index}`)) {
      clearWingStrip(doc, b, 0, "");
      continue;
    }
    if (on(`matrices.${mtx.index}.strip`)) writeBusStrip(doc, b, mtx);
    if (on(`matrices.${mtx.index}.eq`) && mtx.eq) writeEq(doc, `${b}.eq`, mtx.eq);
  }

  for (const dca of model.dcas) {
    const b = `ae_data.dca.${dca.index}`;
    if (!on(`dcas.${dca.index}`) || !isObj(doc.get(b))) continue;
    doc.set(`${b}.name`, dca.name);
    doc.set(`${b}.col`, neutralColourToWing(dca.colour));
    doc.set(`${b}.mute`, dca.mute);
    doc.set(`${b}.fdr`, faderOut(dca.fader));
  }

  for (const fx of model.fx) {
    const b = `ae_data.fx.${fx.index}`;
    if (!on(`fx.${fx.index}`) || !isObj(doc.get(b))) continue;
    report.push({
      severity: "info",
      scope: `fx.${fx.index}`,
      message: `FX ${fx.index}: M32 "${fx.sourceModel}" → WING slot left on its template model (${fx.kind}); reassign the WING emulation to taste.`,
    });
  }

  return doc.serialize();
}

function writeWingPreset(
  model: ShowModel,
  selection: Selection,
  report: ReportEntry[],
): string {
  const doc = WingDoc.parse(wingChnTemplate);
  const ch = model.channels[0];
  if (!ch) return doc.serialize();
  const b = "ch_data";
  if (selection.has("channels.1.strip")) writeStrip(doc, b, ch);
  if (selection.has("channels.1.eq") && ch.eq) writeChannelEq(doc, b, ch.eq);
  if (selection.has("channels.1.gate") && ch.gate) writeGate(doc, `${b}.gate`, ch.gate);
  if (selection.has("channels.1.comp") && ch.comp) writeComp(doc, `${b}.dyn`, ch.comp);
  if (selection.has("channels.1.sends")) writeSends(doc, b, ch.sends, 16);
  doc.set("info_text", ch.name || "Converted preset");
  report.push({
    severity: "info",
    scope: "channels.1",
    message: "Channel preset converted; load onto the target WING channel and check the input source.",
  });
  return doc.serialize();
}

/**
 * A standalone WING channel preset (`.chn`) built from one channel of the
 * neutral model — works whether that channel came from a WING snapshot or an
 * M32 scene. Used by "export channel presets": one file per channel, unlike
 * `writeWing`/`writeWingPreset` this always includes the full strip (EQ, gate,
 * compressor, sends), independent of the scene-conversion selection.
 *
 * WING itself never stores a channel name inside a preset — every preset
 * WING-Edit exports has `ch_data.name` blank; only the preset's own
 * `info_text` (the library label) carries a name, and *that* isn't applied to
 * the channel on recall either. Loading a preset changes processing, not the
 * channel's identity — so this matches that and leaves `ch_data.name` empty.
 */
export function writeWingChannelPreset(ch: Channel): string {
  const doc = WingDoc.parse(wingChnTemplate);
  const b = "ch_data";
  doc.set("source_channel", ch.index);
  doc.set("info_text", ch.name || `Channel ${ch.index}`);
  writeStrip(doc, b, ch);
  doc.set(`${b}.name`, ""); // presets don't carry the channel name — see above
  if (ch.eq) writeChannelEq(doc, b, ch.eq);
  if (ch.gate) writeGate(doc, `${b}.gate`, ch.gate);
  if (ch.comp) writeComp(doc, `${b}.dyn`, ch.comp);
  writeSends(doc, b, ch.sends, 16);
  return doc.serialize();
}

/**
 * A WING snapshot that resets every mix strip to neutral: names/colours
 * cleared, every fader (channels, aux, buses, matrices, mains, DCAs) off, all
 * EQ / gate / dynamics / pre-EQ bypassed, filters off, every send off, all
 * DCA / mute-group tags removed.
 *
 * Input connections and the source labels under `io` are left intact — this
 * clears the mix, it does not re-patch the console.
 */
export function blankWingSnapshot(): string {
  const doc = WingDoc.parse(wingSnapTemplate);
  const ae = "ae_data";

  for (let i = 1; i <= 40; i++) clearWingStrip(doc, `${ae}.ch.${i}`, 16, "");
  for (let i = 1; i <= 8; i++) clearWingStrip(doc, `${ae}.aux.${i}`, 16, "");
  for (let i = 1; i <= 16; i++) clearWingStrip(doc, `${ae}.bus.${i}`, 8, "MX");
  for (let i = 1; i <= 8; i++) clearWingStrip(doc, `${ae}.mtx.${i}`, 0, "");
  for (let i = 1; i <= 4; i++) clearWingStrip(doc, `${ae}.main.${i}`, 8, "MX");

  for (let i = 1; i <= 16; i++) {
    const b = `${ae}.dca.${i}`;
    if (!isObj(doc.get(b))) continue;
    doc.set(`${b}.name`, "");
    doc.set(`${b}.col`, 0);
    doc.set(`${b}.mute`, false);
    doc.set(`${b}.fdr`, 0); // DCAs sit at unity
  }
  for (let i = 1; i <= 8; i++) {
    const b = `${ae}.mgrp.${i}`;
    if (isObj(doc.get(b))) doc.set(`${b}.mute`, false);
  }

  doc.set("active_show", "");
  doc.set("active_scene", "");
  return doc.serialize();
}

/**
 * Blank a strip on the WING: name/colour cleared, fader off, all processing
 * bypassed, every send off, DCA/mute-group tags stripped. The input connection
 * is left untouched.
 */
function clearWingStrip(
  doc: WingDoc,
  b: string,
  sendCount: number,
  sendPrefix: string,
): void {
  doc.set(`${b}.name`, "");
  doc.set(`${b}.col`, 0);
  doc.set(`${b}.mute`, false);
  doc.set(`${b}.fdr`, OFF_DB);
  doc.set(`${b}.pan`, 0);
  doc.set(`${b}.flt.lc`, false);
  doc.set(`${b}.flt.hc`, false);
  doc.set(`${b}.eq.on`, false);
  doc.set(`${b}.gate.on`, false);
  doc.set(`${b}.dyn.on`, false);
  doc.set(`${b}.peq.on`, false);
  for (let i = 1; i <= sendCount; i++) {
    const key = sendPrefix ? `${sendPrefix}${i}` : String(i);
    const base = `${b}.send.${key}`;
    if (!isObj(doc.get(base))) continue;
    doc.set(`${base}.on`, false);
    doc.set(`${base}.lvl`, OFF_DB);
  }
  if (isObj(doc.get(`${b}.send`))) {
    for (const k of Object.keys(doc.get(`${b}.send`) as object)) {
      doc.set(`${b}.send.${k}.on`, false);
      doc.set(`${b}.send.${k}.lvl`, OFF_DB);
    }
  }
  const existing = doc.getStr(`${b}.tags`) ?? "";
  const kept = existing
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !/^#[DM]\d+$/.test(t));
  doc.set(`${b}.tags`, kept.join(","));
}

function writeStrip(doc: WingDoc, b: string, ch: Channel): void {
  doc.set(`${b}.name`, ch.name);
  doc.set(`${b}.col`, neutralColourToWing(ch.colour));
  doc.set(`${b}.mute`, ch.mute);
  doc.set(`${b}.fdr`, faderOut(ch.fader));
  doc.set(`${b}.pan`, clamp(ch.pan, -100, 100));
  doc.set(`${b}.wid`, clamp(ch.width, -100, 100));
}

function writeBusStrip(doc: WingDoc, b: string, bus: Bus): void {
  doc.set(`${b}.name`, bus.name);
  doc.set(`${b}.col`, neutralColourToWing(bus.colour));
  doc.set(`${b}.mute`, bus.mute);
  doc.set(`${b}.fdr`, faderOut(bus.fader));
  doc.set(`${b}.pan`, clamp(bus.pan, -100, 100));
}

function writeInput(
  doc: WingDoc,
  b: string,
  ch: Channel,
  _model: ShowModel,
  report: ReportEntry[],
): void {
  if (ch.input?.invert != null) doc.set(`${b}.in.set.inv`, ch.input.invert);
  if (ch.input?.trim != null) doc.set(`${b}.in.set.trim`, ch.input.trim);
  if (ch.highpass) {
    doc.set(`${b}.flt.lc`, ch.highpass.on);
    doc.set(`${b}.flt.lcf`, ch.highpass.freq);
  }
  if (ch.input?.gain != null) {
    // Resolve which WING source group/number this channel is connected to.
    const grp = doc.getStr(`${b}.in.conn.grp`);
    const inNo = doc.getNum(`${b}.in.conn.in`);
    if (grp && grp !== "OFF" && inNo != null) {
      const set = doc.set(`ae_data.io.in.${grp}.${inNo}.g`, ch.input.gain);
      if (!set && Math.abs(ch.input.gain) > 0.5) {
        report.push({
          severity: "info",
          scope: `channels.${ch.index}.input`,
          message: `Channel ${ch.index}: preamp gain ${ch.input.gain} dB not written (source ${grp} ${inNo} absent from template I/O).`,
        });
      }
      if (ch.input.phantom != null)
        doc.set(`ae_data.io.in.${grp}.${inNo}.vph`, ch.input.phantom);
    }
  }
}

/**
 * Channel EQ. A low-cut / high-cut band (the M32 puts channel HPF/LPF in EQ
 * bands 1 and 4) is routed to the WING's dedicated `flt` low-cut / high-cut,
 * which is the natural home for it; the rest go to the parametric EQ.
 */
function writeChannelEq(doc: WingDoc, base: string, eq: Eq): void {
  const parametric: typeof eq.bands = [];
  for (const band of eq.bands) {
    if (band.type === "low-cut") {
      doc.set(`${base}.flt.lc`, true);
      doc.set(`${base}.flt.lcf`, band.freq);
    } else if (band.type === "high-cut") {
      doc.set(`${base}.flt.hc`, true);
      doc.set(`${base}.flt.hcf`, band.freq);
    } else {
      parametric.push(band);
    }
  }
  writeEq(doc, `${base}.eq`, { ...eq, bands: parametric });
}

function writeEq(doc: WingDoc, b: string, eq: Eq): void {
  doc.set(`${b}.on`, eq.on);
  const bands = [...eq.bands].sort((x, y) => x.freq - y.freq);
  const low = bands[0];
  const high = bands[bands.length - 1];
  const mids = bands.slice(1, -1).slice(0, 4);
  if (low) {
    doc.set(`${b}.lg`, low.gain);
    doc.set(`${b}.lf`, low.freq);
    doc.set(`${b}.lq`, low.q);
    doc.set(`${b}.leq`, low.type === "bell" ? "PEQ" : "SHV");
  }
  mids.forEach((band, i) => {
    const n = i + 1;
    doc.set(`${b}.${n}g`, band.gain);
    doc.set(`${b}.${n}f`, band.freq);
    doc.set(`${b}.${n}q`, band.q);
  });
  if (high && high !== low) {
    doc.set(`${b}.hg`, high.gain);
    doc.set(`${b}.hf`, high.freq);
    doc.set(`${b}.hq`, high.q);
    doc.set(`${b}.heq`, high.type === "bell" ? "PEQ" : "SHV");
  }
}

function writeGate(doc: WingDoc, b: string, g: Gate): void {
  doc.set(`${b}.on`, g.on);
  doc.set(`${b}.thr`, g.threshold);
  doc.set(`${b}.range`, g.range);
  doc.set(`${b}.att`, g.attackMs);
  doc.set(`${b}.hld`, g.holdMs);
  doc.set(`${b}.rel`, g.releaseMs);
}

function writeComp(doc: WingDoc, b: string, c: Compressor): void {
  doc.set(`${b}.on`, c.on);
  doc.set(`${b}.thr`, c.threshold);
  doc.set(`${b}.ratio`, c.ratio);
  doc.set(`${b}.knee`, c.knee);
  doc.set(`${b}.att`, c.attackMs);
  doc.set(`${b}.hld`, c.holdMs);
  doc.set(`${b}.rel`, c.releaseMs);
  doc.set(`${b}.gain`, c.gain);
  doc.set(`${b}.mix`, c.mix);
}

function writeSends(
  doc: WingDoc,
  b: string,
  sends: { to: number; on: boolean; level: number; pan: number; tap: string }[],
  count: number,
  prefix = "",
): void {
  for (const s of sends) {
    if (s.to > count) continue;
    const key = prefix ? `${prefix}${s.to}` : String(s.to);
    const base = `${b}.send.${key}`;
    if (!isObj(doc.get(base))) continue;
    doc.set(`${base}.on`, s.on);
    doc.set(`${base}.lvl`, faderOut(s.level));
    doc.set(`${base}.pan`, clamp(s.pan, -100, 100));
    doc.set(`${base}.mode`, s.tap === "pre-fader" ? "PRE" : s.tap === "group" ? "GRP" : "POST");
  }
}

function writeTags(doc: WingDoc, b: string, dcaMask: number, mgMask: number): void {
  const tags: string[] = [];
  for (let i = 0; i < 16; i++) if (dcaMask & (1 << i)) tags.push(`#D${i + 1}`);
  for (let i = 0; i < 8; i++) if (mgMask & (1 << i)) tags.push(`#M${i + 1}`);
  const existing = doc.getStr(`${b}.tags`) ?? "";
  const kept = existing
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !/^#[DM]\d+$/.test(t));
  doc.set(`${b}.tags`, [...kept, ...tags].join(","));
}

function faderOut(db: number): number {
  return Number.isFinite(db) ? db : OFF_DB;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
