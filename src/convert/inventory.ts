import type { Bus, Channel, Dca, FxSlot, Platform, ShowModel } from "../model/showModel";
import { m32SupportsKind } from "./fxMap";
import type { Inventory, InventoryNode } from "./types";

interface Limits {
  channels: number;
  aux: number;
  buses: number;
  matrices: number;
  mains: number;
  dcas: number;
  muteGroups: number;
  fx: number;
  eqBands: number;
}

const M32_LIMITS: Limits = {
  channels: 32, aux: 8, buses: 16, matrices: 6, mains: 2,
  dcas: 8, muteGroups: 6, fx: 8, eqBands: 4,
};
const WING_LIMITS: Limits = {
  channels: 40, aux: 8, buses: 16, matrices: 8, mains: 4,
  dcas: 16, muteGroups: 8, fx: 16, eqBands: 6,
};

/** Column order for the channel matrix; also the child-id suffixes. */
export const CHANNEL_BLOCKS = ["strip", "input", "eq", "gate", "comp", "sends"] as const;
export const BUS_BLOCKS = ["strip", "eq", "comp", "sends"] as const;
export const BLOCK_LABELS: Record<string, string> = {
  strip: "Strip", input: "In", eq: "EQ", gate: "Gate", comp: "Dyn", sends: "Sends",
};

export function buildInventory(model: ShowModel, target: Platform): Inventory {
  const lim = target === "m32" ? M32_LIMITS : WING_LIMITS;
  const root: InventoryNode[] = [];

  root.push(channelGroup("channels", "Input channels", model.channels, lim.channels, lim, false));
  if (model.auxIns.length)
    root.push(channelGroup("auxins", "Aux inputs", model.auxIns, lim.aux, lim, true));

  if (model.kind === "scene") {
    root.push(busGroup("buses", "Mix buses", model.buses, lim.buses));
    if (model.matrices.length)
      root.push(busGroup("matrices", "Matrices", model.matrices, lim.matrices));
    if (model.mains.length)
      root.push(busGroup("mains", "Main buses", model.mains, lim.mains));
    root.push(simpleGroup("dcas", "DCA groups", model.dcas, lim.dcas, dcaFacets));
    root.push(
      simpleGroup(
        "mutegroups",
        "Mute groups",
        model.muteGroups.map((g) => ({ index: g.index, name: g.name })),
        lim.muteGroups,
      ),
    );
    root.push(fxGroup(model.fx, target, lim.fx));
    root.push(routingGroup(model));
    root.push(configGroup(model));
  }

  return { source: model.source, target, kind: model.kind, root };
}

// --- channels ---------------------------------------------------------------

function channelGroup(
  id: string,
  label: string,
  channels: Channel[],
  cap: number,
  lim: Limits,
  isAux: boolean,
): InventoryNode {
  return {
    id,
    label,
    detail: `${channels.length}`,
    convertible: true,
    defaultOn: true,
    active: true,
    children: channels.map((c) => {
      const over = c.index > cap;
      const active = channelActive(c);
      return {
        id: `${id}.${c.index}`,
        label: c.name || "—",
        detail: c.input?.source && c.input.source !== "none" ? c.input.source : undefined,
        convertible: !over,
        active,
        defaultOn: !over && active,
        note: over ? `Target has ${cap} ${isAux ? "aux inputs" : "channels"} — dropped.` : undefined,
        facets: {
          colour: c.colour,
          fader: c.fader,
          source: c.input?.source && c.input.source !== "none" ? c.input.source : undefined,
          muted: c.mute,
          stereo: c.stereoLink,
        },
        children: over
          ? undefined
          : [
              block(`${id}.${c.index}`, "strip", true, "Name, colour, fader, pan, mute"),
              block(`${id}.${c.index}`, "input", true, "Input patch + preamp gain",
                c.input?.gain != null ? `${round(c.input.gain)} dB` : undefined),
              eqBlock(`${id}.${c.index}`, c.eq?.bands.length ?? 0, lim.eqBands, c.eq?.on ?? false),
              block(`${id}.${c.index}`, "gate", c.gate?.on ?? false, "Gate / expander",
                c.gate?.model, c.gate?.model ? `Model "${c.gate.model}" → generic gate.` : undefined),
              block(`${id}.${c.index}`, "comp", c.comp?.on ?? false, "Compressor",
                c.comp?.model, c.comp?.model ? `Model "${c.comp.model}" → generic compressor.` : undefined),
              block(`${id}.${c.index}`, "sends", sendsActive(c), "Bus sends",
                `${c.sends.filter((s) => s.on && Number.isFinite(s.level)).length} on`),
            ],
      };
    }),
  };
}

function channelActive(c: Channel): boolean {
  if (c.name.trim()) return true;
  if (Number.isFinite(c.fader) && c.fader > -90) return true;
  if (c.eq?.on || c.gate?.on || c.comp?.on) return true;
  if (sendsActive(c)) return true;
  return false;
}
function sendsActive(c: Channel): boolean {
  return c.sends.some((s) => s.on && Number.isFinite(s.level) && s.level > -90);
}

// --- buses ------------------------------------------------------------------

function busGroup(id: string, label: string, buses: Bus[], cap: number): InventoryNode {
  return {
    id,
    label,
    detail: `${buses.length}`,
    convertible: true,
    defaultOn: true,
    active: true,
    children: buses.map((b) => {
      const over = b.index > cap;
      const active = Boolean(b.name.trim()) || (Number.isFinite(b.fader) && b.fader > -90);
      return {
        id: `${id}.${b.index}`,
        label: b.name || "—",
        convertible: !over,
        active,
        defaultOn: !over && active,
        note: over ? `Target has ${cap} — dropped.` : undefined,
        facets: { colour: b.colour, fader: b.fader, muted: b.mute, stereo: !b.mono },
        children: over
          ? undefined
          : [
              block(`${id}.${b.index}`, "strip", true, "Name, colour, fader, pan"),
              block(`${id}.${b.index}`, "eq", b.eq?.on ?? false, "EQ"),
              block(`${id}.${b.index}`, "comp", b.comp?.on ?? false, "Compressor", b.comp?.model),
              block(`${id}.${b.index}`, "sends", b.sends.some((s) => s.on), "Sends → matrix / main"),
            ],
      };
    }),
  };
}

// --- simple lists (DCA, mute groups) ---------------------------------------

function simpleGroup(
  id: string,
  label: string,
  items: { index: number; name: string }[],
  cap: number,
  facetFn?: (item: never) => InventoryNode["facets"],
): InventoryNode {
  return {
    id,
    label,
    detail: `${items.length}`,
    convertible: true,
    defaultOn: true,
    active: true,
    children: items.map((it) => {
      const over = it.index > cap;
      const active = Boolean(it.name.trim());
      return {
        id: `${id}.${it.index}`,
        label: it.name || "—",
        convertible: !over,
        active,
        defaultOn: !over && active,
        note: over ? `Target has ${cap} — dropped.` : undefined,
        facets: facetFn ? facetFn(it as never) : undefined,
      };
    }),
  };
}

const dcaFacets = (d: Dca): InventoryNode["facets"] => ({
  colour: d.colour,
  fader: d.fader,
  muted: d.mute,
});

// --- FX --------------------------------------------------------------------

function fxGroup(fx: FxSlot[], target: Platform, cap: number): InventoryNode {
  return {
    id: "fx",
    label: "Effects",
    detail: `${fx.length} in use`,
    convertible: true,
    defaultOn: true,
    active: true,
    children: fx.map((f) => {
      const over = f.index > cap;
      const noEquiv = target === "m32" && !m32SupportsKind(f.kind);
      return {
        id: `fx.${f.index}`,
        label: `FX ${f.index}`,
        detail: f.sourceModel,
        convertible: !over,
        active: true,
        defaultOn: !over && !noEquiv,
        facets: { kind: f.kind },
        note: over
          ? `Target has ${cap} FX slots — dropped.`
          : noEquiv
            ? `No close ${target.toUpperCase()} equivalent for "${f.sourceModel}" (${f.kind}).`
            : `"${f.sourceModel}" → nearest ${target.toUpperCase()} type; parameters reset to defaults.`,
      };
    }),
  };
}

// --- routing / config -----------------------------------------------------

function routingGroup(model: ShowModel): InventoryNode {
  return {
    id: "routing",
    label: "Routing",
    convertible: true,
    defaultOn: false,
    active: model.routing.inputPatch.length > 0,
    note: "Physical I/O differs between consoles — review after import.",
    children: [
      block("routing", "input", false, "Input patch", `${model.routing.inputPatch.length} slots`),
      block("routing", "output", false, "Output patch", `${model.routing.outputPatch.length} slots`),
    ],
  };
}

function configGroup(model: ShowModel): InventoryNode {
  return {
    id: "config",
    label: "Console config",
    convertible: true,
    defaultOn: false,
    active: false,
    children: [
      block("config", "main", false, "Main mode", model.config.mainMode),
      block("config", "talkback", false, "Talkback"),
      block("config", "osc", false, "Oscillator"),
    ],
  };
}

// --- helpers -------------------------------------------------------------

function block(
  parentId: string,
  suffix: string,
  active: boolean,
  label: string,
  detail?: string,
  note?: string,
): InventoryNode {
  return {
    id: `${parentId}.${suffix}`,
    label: BLOCK_LABELS[suffix] ?? label,
    detail,
    convertible: true,
    active,
    defaultOn: active,
    note,
  };
}

function eqBlock(
  parentId: string,
  bandCount: number,
  targetBands: number,
  on: boolean,
): InventoryNode {
  const fold = bandCount > targetBands;
  return {
    id: `${parentId}.eq`,
    label: "EQ",
    detail: `${bandCount}-band`,
    convertible: true,
    active: on,
    defaultOn: on,
    note: fold
      ? `${bandCount}-band → ${targetBands}-band: shelves + ${targetBands - 2} most-active mids kept.`
      : undefined,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
