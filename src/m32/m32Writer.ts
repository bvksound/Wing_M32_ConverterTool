import type {
  Bus,
  Channel,
  Compressor,
  Eq,
  Gate,
  ShowModel,
} from "../model/showModel";
import { neutralColourToM32 } from "../model/colour";
import { foldEq, m32BandToken } from "../convert/eqFold";
import { kindToM32Type } from "../convert/fxMap";
import type { ClearSet, ReportEntry, Selection } from "../convert/types";
import m32Template from "../templates/m32-default.scn?raw";
import { ScnDocument, formatHeader } from "./scnDocument";
import {
  encodeBool,
  encodeFreq,
  encodeLevel,
  encodeMask,
  encodeSigned,
  quote,
} from "./tokens";

const CH_EQ_BANDS = 4;
const BUS_EQ_BANDS = 6;
const MTX_COUNT = 6;
const BUS_COUNT = 16;

export function writeM32(
  model: ShowModel,
  selection: Selection,
  cleared: ClearSet,
  report: ReportEntry[],
): string {
  const doc = ScnDocument.parse(m32Template);

  if (model.meta.name) {
    // M32 scene-name field; the console scribble shows ~16 chars.
    doc.header.name = model.meta.name.replace(/["\r\n]/g, "").slice(0, 16);
    doc.header.raw = formatHeader(doc.header);
  }

  const on = (id: string) => selection.has(id);

  for (const ch of model.channels) {
    if (ch.index > 32) continue;
    const base = `/ch/${p2(ch.index)}`;
    if (cleared.has(`channels.${ch.index}`)) {
      clearM32Strip(doc, base, CH_EQ_BANDS, BUS_COUNT, true);
      continue;
    }
    if (on(`channels.${ch.index}.strip`)) writeStrip(doc, base, ch, report);
    if (on(`channels.${ch.index}.input`)) writeInput(doc, base, ch, report);
    if (on(`channels.${ch.index}.eq`)) {
      writeChannelEq(doc, base, ch, `channels.${ch.index}.eq`, report);
    } else if (ch.lowpass?.on) {
      report.push({
        severity: "warn",
        scope: `channels.${ch.index}.eq`,
        message: `Channel ${ch.index} high-cut filter not transferred — the M32 has no channel low-pass; select the EQ block to place it in EQ band 4.`,
      });
    }
    if (on(`channels.${ch.index}.gate`) && ch.gate) writeGate(doc, base, ch.gate);
    if (on(`channels.${ch.index}.comp`) && ch.comp) writeComp(doc, base, ch.comp);
    if (on(`channels.${ch.index}.sends`)) writeSends(doc, base, ch, BUS_COUNT);
  }

  for (const aux of model.auxIns) {
    if (aux.index > 8) continue;
    const base = `/auxin/${p2(aux.index)}`;
    if (cleared.has(`auxins.${aux.index}`)) {
      clearM32Strip(doc, base, CH_EQ_BANDS, BUS_COUNT, false);
      continue;
    }
    if (on(`auxins.${aux.index}.strip`)) writeStrip(doc, base, aux, report);
    if (on(`auxins.${aux.index}.eq`) && aux.eq)
      writeEq(doc, base, aux.eq, CH_EQ_BANDS, `auxins.${aux.index}.eq`, report);
    if (on(`auxins.${aux.index}.sends`)) writeSends(doc, base, aux, BUS_COUNT);
  }

  for (const bus of model.buses) {
    if (bus.index > BUS_COUNT) continue;
    const base = `/bus/${p2(bus.index)}`;
    if (cleared.has(`buses.${bus.index}`)) {
      clearM32Strip(doc, base, BUS_EQ_BANDS, MTX_COUNT, false);
      continue;
    }
    if (on(`buses.${bus.index}.strip`)) writeBusStrip(doc, base, bus);
    if (on(`buses.${bus.index}.eq`) && bus.eq)
      writeEq(doc, base, bus.eq, BUS_EQ_BANDS, `buses.${bus.index}.eq`, report);
    if (on(`buses.${bus.index}.comp`) && bus.comp) writeComp(doc, base, bus.comp);
    if (on(`buses.${bus.index}.sends`)) writeSends(doc, base, bus, MTX_COUNT);
  }

  for (const mtx of model.matrices) {
    if (mtx.index > MTX_COUNT) continue;
    const base = `/mtx/${p2(mtx.index)}`;
    if (cleared.has(`matrices.${mtx.index}`)) {
      clearM32Strip(doc, base, BUS_EQ_BANDS, 0, false);
      continue;
    }
    if (on(`matrices.${mtx.index}.strip`)) writeBusStrip(doc, base, mtx);
    if (on(`matrices.${mtx.index}.eq`) && mtx.eq)
      writeEq(doc, base, mtx.eq, BUS_EQ_BANDS, `matrices.${mtx.index}.eq`, report);
  }

  for (const dca of model.dcas) {
    if (dca.index > 8) continue;
    if (!on(`dcas.${dca.index}`)) continue;
    if (doc.has(`/dca/${dca.index}/config`)) {
      doc.setArg(`/dca/${dca.index}/config`, 0, quote(dca.name.slice(0, 12)));
      doc.setArg(`/dca/${dca.index}/config`, 2, neutralColourToM32(dca.colour));
    }
    if (doc.has(`/dca/${dca.index}`)) {
      doc.setArg(`/dca/${dca.index}`, 0, encodeBool(!dca.mute));
      doc.setArg(`/dca/${dca.index}`, 1, encodeLevel(dca.fader));
    }
  }

  for (const fx of model.fx) {
    if (fx.index > 8) continue;
    if (!on(`fx.${fx.index}`)) continue;
    const type = fx.sourceModel && looksLikeM32Type(fx.sourceModel)
      ? fx.sourceModel
      : kindToM32Type(fx.kind);
    if (doc.has(`/fx/${fx.index}`)) {
      doc.set(`/fx/${fx.index}`, [type]);
      report.push({
        severity: fx.sourceModel === type ? "ok" : "warn",
        scope: `fx.${fx.index}`,
        message:
          fx.sourceModel === type
            ? `FX ${fx.index}: ${type} kept.`
            : `FX ${fx.index}: "${fx.sourceModel}" → M32 "${type}" (parameters reset to type defaults).`,
      });
    }
  }

  return doc.serialize();
}

/**
 * A scene that resets every mix strip to neutral: all names/colours cleared,
 * every fader (channels, buses, matrices, mains, DCAs) at -oo, all EQ / gate /
 * dynamics bypassed, every send off, all DCA / mute-group membership removed.
 *
 * Physical setup is left intact — input patch, head-amp gains, routing, user
 * layers, FX engine types. Recalling this mutes the console; it does not
 * repatch it.
 */
export function blankM32Scene(name = "BLANK"): string {
  const doc = ScnDocument.parse(m32Template);
  doc.header.name = name.replace(/["\r\n]/g, "").slice(0, 16);
  doc.header.notes = "cleared mix — faders down, processing bypassed";
  doc.header.raw = formatHeader(doc.header);

  for (let i = 1; i <= 32; i++) clearM32Strip(doc, `/ch/${p2(i)}`, CH_EQ_BANDS, BUS_COUNT, true);
  for (let i = 1; i <= 8; i++) clearM32Strip(doc, `/auxin/${p2(i)}`, CH_EQ_BANDS, BUS_COUNT, false);
  for (let i = 1; i <= 8; i++) clearM32Strip(doc, `/fxrtn/${p2(i)}`, CH_EQ_BANDS, BUS_COUNT, false);
  for (let i = 1; i <= BUS_COUNT; i++) clearM32Strip(doc, `/bus/${p2(i)}`, BUS_EQ_BANDS, MTX_COUNT, false);
  for (let i = 1; i <= MTX_COUNT; i++) clearM32Strip(doc, `/mtx/${p2(i)}`, BUS_EQ_BANDS, 0, false);
  clearM32Strip(doc, "/main/st", BUS_EQ_BANDS, MTX_COUNT, false);
  clearM32Strip(doc, "/main/m", BUS_EQ_BANDS, MTX_COUNT, false);

  for (let i = 1; i <= 8; i++) {
    if (doc.has(`/dca/${i}/config`)) {
      doc.setArg(`/dca/${i}/config`, 0, quote(""));
      doc.setArg(`/dca/${i}/config`, 2, "OFF");
    }
    if (doc.has(`/dca/${i}`)) {
      doc.setArg(`/dca/${i}`, 0, "ON");
      doc.setArg(`/dca/${i}`, 1, "-oo");
    }
  }

  // Console-wide: no channel mutes, oscillator off.
  if (doc.has("/config/mute")) doc.set("/config/mute", ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF"]);

  return doc.serialize();
}

/**
 * Blank a strip on the target: name cleared, colour off, fader -oo, all
 * processing bypassed, every send off, group memberships removed. Source-patch
 * (`/ch/NN/config` input index) and head-amp gain are left alone so the physical
 * routing still makes sense.
 */
function clearM32Strip(
  doc: ScnDocument,
  base: string,
  eqBands: number,
  sendCount: number,
  isChannel: boolean,
): void {
  if (doc.has(`${base}/config`)) {
    doc.setArg(`${base}/config`, 0, quote(""));
    const cfg = doc.get(`${base}/config`) ?? [];
    doc.setArg(`${base}/config`, isChannel ? 2 : cfg.length - 1, "OFF");
  }
  if (doc.has(`${base}/mix`)) {
    const mix = doc.get(`${base}/mix`) ?? [];
    doc.setArg(`${base}/mix`, 1, "-oo"); // fader
    if (mix.length > 3 && /^[+-]?\d/.test(mix[3] ?? "")) doc.setArg(`${base}/mix`, 3, "+0"); // pan
  }
  if (isChannel && doc.has(`${base}/preamp`)) {
    doc.setArg(`${base}/preamp`, 0, "+0.0");
    doc.setArg(`${base}/preamp`, 1, "OFF");
    doc.setArg(`${base}/preamp`, 2, "OFF");
  }
  if (isChannel && doc.has(`${base}/gate`)) doc.setArg(`${base}/gate`, 0, "OFF");
  if (doc.has(`${base}/dyn`)) doc.setArg(`${base}/dyn`, 0, "OFF");
  if (doc.has(`${base}/eq`)) doc.set(`${base}/eq`, ["OFF"]);
  for (let i = 1; i <= eqBands; i++) {
    const path = `${base}/eq/${i}`;
    if (!doc.has(path)) continue;
    doc.setArg(path, 2, "+0.00");
  }
  for (let i = 1; i <= sendCount; i++) {
    const path = `${base}/mix/${p2(i)}`;
    if (!doc.has(path)) continue;
    doc.setArg(path, 0, "OFF");
    doc.setArg(path, 1, "-oo");
  }
  if (doc.has(`${base}/grp`)) {
    doc.setArg(`${base}/grp`, 0, "%00000000");
    doc.setArg(`${base}/grp`, 1, "%000000");
  }
}

function writeStrip(
  doc: ScnDocument,
  base: string,
  ch: Channel,
  report: ReportEntry[],
): void {
  if (doc.has(`${base}/config`)) {
    doc.setArg(`${base}/config`, 0, quote(ch.name.slice(0, 12)));
    doc.setArg(`${base}/config`, 2, neutralColourToM32(ch.colour));
  }
  if (doc.has(`${base}/mix`)) {
    doc.setArg(`${base}/mix`, 1, encodeLevel(ch.fader));
    doc.setArg(`${base}/mix`, 3, encodeSigned(ch.pan));
    const lr = ch.mainSends.find((s) => s.to === 1);
    if (lr) doc.setArg(`${base}/mix`, 2, encodeBool(lr.on));
  }
  if (doc.has(`${base}/grp`)) {
    doc.setArg(`${base}/grp`, 0, encodeMask(ch.dcaMask & 0xff, 8));
    doc.setArg(`${base}/grp`, 1, encodeMask(ch.muteGroupMask & 0x3f, 6));
    if (ch.dcaMask >> 8) {
      report.push({
        severity: "warn",
        scope: `channels.${ch.index}.strip`,
        message: `Channel ${ch.index} is in a DCA above 8 — that membership is dropped.`,
      });
    }
  }
}

function writeInput(
  doc: ScnDocument,
  base: string,
  ch: Channel,
  report: ReportEntry[],
): void {
  if (doc.has(`${base}/preamp`)) {
    if (ch.input?.trim != null)
      doc.setArg(`${base}/preamp`, 0, signedFixed(ch.input.trim));
    doc.setArg(`${base}/preamp`, 1, encodeBool(ch.input?.invert ?? false));
    if (ch.highpass) {
      doc.setArg(`${base}/preamp`, 2, encodeBool(ch.highpass.on));
      doc.setArg(`${base}/preamp`, 3, String(Math.round(ch.highpass.slope ?? 12)));
      doc.setArg(`${base}/preamp`, 4, encodeFreq(ch.highpass.freq));
    }
  }
  const src = Number(doc.getArg(`${base}/config`, 3) ?? 0);
  if (src > 0 && ch.input?.gain != null && doc.has(`/headamp/${p3(src - 1)}`)) {
    doc.setArg(`/headamp/${p3(src - 1)}`, 0, signedFixed(ch.input.gain));
    if (ch.input.phantom != null)
      doc.setArg(`/headamp/${p3(src - 1)}`, 1, encodeBool(ch.input.phantom));
  } else if (ch.input?.gain != null && Math.abs(ch.input.gain) > 0.5) {
    report.push({
      severity: "info",
      scope: `channels.${ch.index}.input`,
      message: `Channel ${ch.index}: preamp gain ${ch.input.gain} dB not applied (no matching M32 head-amp for its source patch).`,
    });
  }
}

function writeEq(
  doc: ScnDocument,
  base: string,
  eq: Eq,
  targetBands: number,
  scope: string,
  report: ReportEntry[],
): void {
  writeEqBands(doc, base, eq, targetBands, scope, report);
}

/**
 * Channel EQ, with the WING dedicated high-cut filter (`flt.hc`) folded into
 * M32 EQ band 4 as an `HCut` — the M32 has no channel low-pass filter, so the
 * only place it can live is an EQ band. The WING low-cut goes to the preamp HPF
 * (see writeInput), not here.
 */
function writeChannelEq(
  doc: ScnDocument,
  base: string,
  ch: Channel,
  scope: string,
  report: ReportEntry[],
): void {
  const lp = ch.lowpass?.on ? ch.lowpass : undefined;
  const usable = lp ? CH_EQ_BANDS - 1 : CH_EQ_BANDS;
  const eq: Eq = ch.eq ?? { on: false, bands: [] };
  writeEqBands(doc, base, eq, usable, scope, report, lp != null || eq.on);

  if (lp) {
    const path = `${base}/eq/${CH_EQ_BANDS}`;
    if (doc.has(path)) {
      doc.set(path, ["HCut", encodeFreq(lp.freq), "+0.00", "2.0"]);
    }
    report.push({
      severity: "info",
      scope,
      message: `Channel high-cut (${Math.round(lp.freq)} Hz) placed in M32 EQ band ${CH_EQ_BANDS} as HCut; that band is no longer free for tone shaping.`,
    });
  }
}

function writeEqBands(
  doc: ScnDocument,
  base: string,
  eq: Eq,
  usableBands: number,
  scope: string,
  report: ReportEntry[],
  forceOn = false,
): void {
  if (doc.has(`${base}/eq`)) {
    doc.set(`${base}/eq`, [encodeBool(eq.on || forceOn)]);
  }
  const { bands, dropped } = foldEq(eq.bands, usableBands);
  bands.forEach((band, i) => {
    const path = `${base}/eq/${i + 1}`;
    if (!doc.has(path)) return;
    const pos = i === 0 ? "first" : i === bands.length - 1 ? "last" : "mid";
    doc.set(path, [
      m32BandToken(band, pos),
      encodeFreq(band.freq),
      signedFixed(band.gain, 2),
      band.q.toFixed(1),
    ]);
  });
  const audibleDropped = dropped.filter((b) => Math.abs(b.gain) >= 0.5);
  if (audibleDropped.length) {
    report.push({
      severity: "warn",
      scope,
      message: `EQ folded to ${usableBands} band(s); dropped active band(s) ${audibleDropped
        .map((b) => `${Math.round(b.freq)}Hz ${b.gain > 0 ? "+" : ""}${b.gain}dB`)
        .join(", ")}.`,
    });
  }
}

function writeGate(doc: ScnDocument, base: string, g: Gate): void {
  if (!doc.has(`${base}/gate`)) return;
  doc.setArg(`${base}/gate`, 0, encodeBool(g.on));
  doc.setArg(`${base}/gate`, 2, signedFixed(g.threshold));
  doc.setArg(`${base}/gate`, 3, g.range.toFixed(1));
  doc.setArg(`${base}/gate`, 4, String(Math.round(g.attackMs)));
  doc.setArg(`${base}/gate`, 5, g.holdMs.toFixed(1));
  doc.setArg(`${base}/gate`, 6, String(Math.round(g.releaseMs)));
}

function writeComp(doc: ScnDocument, base: string, c: Compressor): void {
  if (!doc.has(`${base}/dyn`)) return;
  doc.setArg(`${base}/dyn`, 0, encodeBool(c.on));
  doc.setArg(`${base}/dyn`, 4, signedFixed(c.threshold));
  doc.setArg(`${base}/dyn`, 5, c.ratio.toFixed(1));
  doc.setArg(`${base}/dyn`, 6, String(Math.round(c.knee)));
  doc.setArg(`${base}/dyn`, 7, signedFixed(c.gain, 2));
  doc.setArg(`${base}/dyn`, 8, String(Math.round(c.attackMs)));
  doc.setArg(`${base}/dyn`, 9, c.holdMs.toFixed(1));
  doc.setArg(`${base}/dyn`, 10, String(Math.round(c.releaseMs)));
}

function writeBusStrip(doc: ScnDocument, base: string, b: Bus): void {
  if (doc.has(`${base}/config`)) {
    doc.setArg(`${base}/config`, 0, quote(b.name.slice(0, 12)));
    const colArgs = doc.get(`${base}/config`) ?? [];
    doc.setArg(`${base}/config`, colArgs.length - 1, neutralColourToM32(b.colour));
  }
  if (doc.has(`${base}/mix`)) {
    doc.setArg(`${base}/mix`, 1, encodeLevel(b.fader));
    doc.setArg(`${base}/mix`, 3, encodeSigned(b.pan));
  }
}

function writeSends(
  doc: ScnDocument,
  base: string,
  strip: { sends: { to: number; on: boolean; level: number; pan: number }[] },
  count: number,
): void {
  for (const send of strip.sends) {
    if (send.to > count) continue;
    const path = `${base}/mix/${p2(send.to)}`;
    if (!doc.has(path)) continue;
    const args = doc.get(path) ?? [];
    doc.setArg(path, 0, encodeBool(send.on));
    doc.setArg(path, 1, encodeLevel(send.level));
    if (args.length >= 3) doc.setArg(path, 2, encodeSigned(send.pan));
  }
}

function looksLikeM32Type(s: string): boolean {
  return /^[A-Z0-9]{2,5}$/.test(s) && !s.includes("-");
}

function signedFixed(n: number, digits = 1): string {
  const body = Math.abs(n).toFixed(digits);
  return n < 0 ? `-${body}` : `+${body}`;
}
function p2(n: number): string {
  return String(n).padStart(2, "0");
}
function p3(n: number): string {
  return String(n).padStart(3, "0");
}
