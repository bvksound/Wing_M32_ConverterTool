import type { Channel, Platform, ShowModel } from "../model/showModel";
import { m32SupportsKind } from "./fxMap";
import type { Inventory, InventoryNode } from "./types";

interface Limits {
  channels: number;
  buses: number;
  matrices: number;
  dcas: number;
  muteGroups: number;
  fx: number;
  eqBands: number;
}

const M32_LIMITS: Limits = {
  channels: 32,
  buses: 16,
  matrices: 6,
  dcas: 8,
  muteGroups: 6,
  fx: 8,
  eqBands: 4,
};

const WING_LIMITS: Limits = {
  channels: 40,
  buses: 16,
  matrices: 8,
  dcas: 16,
  muteGroups: 8,
  fx: 16,
  eqBands: 6,
};

export function buildInventory(model: ShowModel, target: Platform): Inventory {
  const lim = target === "m32" ? M32_LIMITS : WING_LIMITS;
  const root: InventoryNode[] = [];

  root.push(channelGroup("channels", "Input channels", model.channels, lim));
  if (model.auxIns.length) {
    root.push(channelGroup("auxins", "Aux inputs", model.auxIns, lim, true));
  }

  if (model.kind === "scene") {
    root.push(
      busGroup("buses", "Mix buses", model.buses, lim.buses, lim.eqBands >= 6 ? 6 : 6),
    );
    root.push(busGroup("matrices", "Matrices", model.matrices, lim.matrices, 6));
    if (model.mains.length) {
      root.push(busGroup("mains", "Main buses", model.mains, 4, 6));
    }
    root.push(dcaGroup(model, lim));
    root.push(muteGroupGroup(model, lim));
    root.push(fxGroup(model, target, lim));
    root.push(routingGroup(model));
    root.push(configGroup(model));
  }

  return { source: model.source, target, kind: model.kind, root };
}

function channelGroup(
  id: string,
  label: string,
  channels: Channel[],
  lim: Limits,
  isAux = false,
): InventoryNode {
  const cap = isAux ? 8 : lim.channels;
  return {
    id,
    label,
    detail: `${channels.length}`,
    convertible: true,
    defaultOn: true,
    children: channels.map((c) => {
      const over = c.index > cap;
      const used = channelUsed(c);
      const node: InventoryNode = {
        id: `${id}.${c.index}`,
        label: `${pad(c.index)} ${c.name || "—"}`,
        detail: c.input?.source && c.input.source !== "none" ? c.input.source : undefined,
        convertible: !over,
        defaultOn: !over && used,
        note: over
          ? `Target has only ${cap} ${isAux ? "aux inputs" : "channels"} — dropped.`
          : used
            ? undefined
            : "Empty / unused channel.",
        children: over
          ? undefined
          : [
              leaf(`${id}.${c.index}.strip`, "Name, colour, fader, pan, mute", true),
              leaf(`${id}.${c.index}.input`, "Input patch + preamp gain", true, {
                detail: c.input?.gain != null ? `${c.input.gain} dB` : undefined,
              }),
              eqLeaf(`${id}.${c.index}.eq`, c.eq?.bands.length ?? 0, lim.eqBands, c.eq?.on),
              leaf(`${id}.${c.index}.gate`, "Gate / expander", c.gate?.on ?? false, {
                note: c.gate?.model
                  ? `Model "${c.gate.model}" → generic gate.`
                  : undefined,
              }),
              leaf(`${id}.${c.index}.comp`, "Compressor", c.comp?.on ?? false, {
                note: c.comp?.model
                  ? `Model "${c.comp.model}" → generic compressor.`
                  : undefined,
              }),
              leaf(`${id}.${c.index}.sends`, "Bus sends", true),
            ],
      };
      return node;
    }),
  };
}

function channelUsed(c: Channel): boolean {
  if (c.name.trim()) return true;
  if (Number.isFinite(c.fader) && c.fader > -90) return true;
  if (c.eq?.on || c.gate?.on || c.comp?.on) return true;
  if (c.sends.some((s) => s.on && Number.isFinite(s.level))) return true;
  return false;
}

function busGroup(
  id: string,
  label: string,
  buses: { index: number; name: string }[],
  cap: number,
  _eqBands: number,
): InventoryNode {
  return {
    id,
    label,
    detail: `${buses.length}`,
    convertible: true,
    defaultOn: true,
    children: buses.map((b) => {
      const over = b.index > cap;
      return {
        id: `${id}.${b.index}`,
        label: `${pad(b.index)} ${b.name || "—"}`,
        convertible: !over,
        defaultOn: !over,
        note: over ? `Target has only ${cap} — dropped.` : undefined,
        children: over
          ? undefined
          : [
              leaf(`${id}.${b.index}.strip`, "Name, colour, fader, pan, mute", true),
              leaf(`${id}.${b.index}.eq`, "EQ", true),
              leaf(`${id}.${b.index}.comp`, "Compressor", false),
              leaf(`${id}.${b.index}.sends`, "Sends (→ matrix / main)", true),
            ],
      };
    }),
  };
}

function dcaGroup(model: ShowModel, lim: Limits): InventoryNode {
  return {
    id: "dcas",
    label: "DCA groups",
    detail: `${model.dcas.length}`,
    convertible: true,
    defaultOn: true,
    children: model.dcas.map((d) => {
      const over = d.index > lim.dcas;
      return leaf(`dcas.${d.index}`, `${pad(d.index)} ${d.name || "—"}`, !over, {
        convertible: !over,
        note: over ? `Target has only ${lim.dcas} DCAs — dropped.` : undefined,
      });
    }),
  };
}

function muteGroupGroup(model: ShowModel, lim: Limits): InventoryNode {
  return {
    id: "mutegroups",
    label: "Mute groups",
    detail: `${model.muteGroups.length}`,
    convertible: true,
    defaultOn: true,
    children: model.muteGroups.map((g) => {
      const over = g.index > lim.muteGroups;
      return leaf(`mutegroups.${g.index}`, `${pad(g.index)} ${g.name}`, !over, {
        convertible: !over,
        note: over ? `Target has only ${lim.muteGroups} mute groups — dropped.` : undefined,
      });
    }),
  };
}

function fxGroup(model: ShowModel, target: Platform, lim: Limits): InventoryNode {
  return {
    id: "fx",
    label: "Effects",
    detail: `${model.fx.length} in use`,
    convertible: true,
    defaultOn: true,
    children: model.fx.map((f) => {
      const over = f.index > lim.fx;
      const noEquiv = target === "m32" && !m32SupportsKind(f.kind);
      return leaf(
        `fx.${f.index}`,
        `FX ${f.index}  ${f.sourceModel}`,
        !over && !noEquiv,
        {
          detail: f.kind,
          convertible: !over,
          note: over
            ? `Target has only ${lim.fx} FX slots — dropped.`
            : noEquiv
              ? `No close M32 equivalent for "${f.sourceModel}" (${f.kind}); nearest match substituted.`
              : `"${f.sourceModel}" → nearest ${target.toUpperCase()} type.`,
        },
      );
    }),
  };
}

function routingGroup(model: ShowModel): InventoryNode {
  return {
    id: "routing",
    label: "Routing",
    convertible: true,
    defaultOn: false,
    note: "Physical I/O differs between consoles — review after import.",
    children: [
      leaf("routing.input", "Input patch", false, {
        detail: `${model.routing.inputPatch.length} slots`,
      }),
      leaf("routing.output", "Output patch", false, {
        detail: `${model.routing.outputPatch.length} slots`,
      }),
    ],
  };
}

function configGroup(model: ShowModel): InventoryNode {
  return {
    id: "config",
    label: "Console config",
    convertible: true,
    defaultOn: false,
    children: [
      leaf("config.main", "Main mode", false, { detail: model.config.mainMode }),
      leaf("config.talkback", "Talkback", false),
      leaf("config.osc", "Oscillator", false),
    ],
  };
}

// --- leaf helpers ------------------------------------------------------------

function leaf(
  id: string,
  label: string,
  defaultOn: boolean,
  opts: Partial<Pick<InventoryNode, "convertible" | "note" | "detail">> = {},
): InventoryNode {
  return {
    id,
    label,
    defaultOn: (opts.convertible ?? true) && defaultOn,
    convertible: opts.convertible ?? true,
    note: opts.note,
    detail: opts.detail,
  };
}

function eqLeaf(
  id: string,
  bandCount: number,
  targetBands: number,
  on: boolean | undefined,
): InventoryNode {
  const fold = bandCount > targetBands;
  return leaf(id, "EQ", on ?? false, {
    detail: `${bandCount} band`,
    note: fold
      ? `${bandCount}-band → ${targetBands}-band: shelves kept + ${targetBands - 2} most-active mids.`
      : undefined,
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
