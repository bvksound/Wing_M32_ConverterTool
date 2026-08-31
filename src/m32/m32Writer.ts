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
import type { ReportEntry, Selection } from "../convert/types";
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
  report: ReportEntry[],
): string {
  const doc = ScnDocument.parse(m32Template);

  if (model.meta.name) {
    doc.header.name = model.meta.name.slice(0, 12);
    doc.header.raw = formatHeader(doc.header);
  }

  const on = (id: string) => selection.has(id);

  for (const ch of model.channels) {
    if (ch.index > 32) continue;
    const base = `/ch/${p2(ch.index)}`;
    if (on(`channels.${ch.index}.strip`)) writeStrip(doc, base, ch, report);
    if (on(`channels.${ch.index}.input`)) writeInput(doc, base, ch, report);
    if (on(`channels.${ch.index}.eq`) && ch.eq)
      writeEq(doc, base, ch.eq, CH_EQ_BANDS, `channels.${ch.index}.eq`, report);
    if (on(`channels.${ch.index}.gate`) && ch.gate) writeGate(doc, base, ch.gate);
    if (on(`channels.${ch.index}.comp`) && ch.comp) writeComp(doc, base, ch.comp);
    if (on(`channels.${ch.index}.sends`)) writeSends(doc, base, ch, BUS_COUNT);
  }

  for (const aux of model.auxIns) {
    if (aux.index > 8) continue;
    const base = `/auxin/${p2(aux.index)}`;
    if (on(`auxins.${aux.index}.strip`)) writeStrip(doc, base, aux, report);
    if (on(`auxins.${aux.index}.eq`) && aux.eq)
      writeEq(doc, base, aux.eq, CH_EQ_BANDS, `auxins.${aux.index}.eq`, report);
    if (on(`auxins.${aux.index}.sends`)) writeSends(doc, base, aux, BUS_COUNT);
  }

  for (const bus of model.buses) {
    if (bus.index > BUS_COUNT) continue;
    const base = `/bus/${p2(bus.index)}`;
    if (on(`buses.${bus.index}.strip`)) writeBusStrip(doc, base, bus);
    if (on(`buses.${bus.index}.eq`) && bus.eq)
      writeEq(doc, base, bus.eq, BUS_EQ_BANDS, `buses.${bus.index}.eq`, report);
    if (on(`buses.${bus.index}.comp`) && bus.comp) writeComp(doc, base, bus.comp);
    if (on(`buses.${bus.index}.sends`)) writeSends(doc, base, bus, MTX_COUNT);
  }

  for (const mtx of model.matrices) {
    if (mtx.index > MTX_COUNT) continue;
    const base = `/mtx/${p2(mtx.index)}`;
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
  if (doc.has(`${base}/eq`)) doc.set(`${base}/eq`, [encodeBool(eq.on)]);
  const { bands, dropped } = foldEq(eq.bands, targetBands);
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
      message: `EQ folded to ${targetBands} bands; dropped active band(s) ${audibleDropped
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
