/**
 * Console-neutral show model.
 *
 * Both the Wing and the M32 readers produce a `ShowModel`; both writers consume
 * one. All physical quantities are normalised here so the mappers never touch
 * console-specific encodings:
 *
 *   - levels / gains: decibels (number). `-Infinity` means "-oo" / off.
 *   - frequencies:     hertz (number)
 *   - Q:               number
 *   - pan / width:     -100..+100
 *   - times:           milliseconds
 *
 * Anything a given console has that the model doesn't yet represent is kept in
 * `raw` on the owning object so a same-format round-trip stays lossless.
 */

export type Platform = "wing" | "m32";

export interface ShowModel {
  source: Platform;
  /** Kind of file this model came from. */
  kind: "scene" | "channel-preset";
  meta: ShowMeta;
  channels: Channel[];
  auxIns: Channel[];
  buses: Bus[];
  matrices: Bus[];
  mains: Bus[];
  dcas: Dca[];
  muteGroups: MuteGroup[];
  fx: FxSlot[];
  routing: Routing;
  config: ConsoleConfig;
}

export interface ShowMeta {
  name: string;
  notes?: string;
  createdBy?: string;
  firmware?: string;
  model?: string;
  createdAt?: string;
}

export interface Channel {
  /** 1-based position within its pool (channel 1..N, aux 1..N). */
  index: number;
  name: string;
  /** Neutral colour name; see model/colour.ts for the palette. */
  colour: ColourName;
  icon?: number;
  mute: boolean;
  fader: number; // dB
  pan: number; // -100..100
  width: number; // -100..100 (stereo strips)
  stereoLink: boolean;
  input?: ChannelInput;
  highpass?: Filter;
  lowpass?: Filter;
  gate?: Gate;
  eq?: Eq;
  comp?: Compressor;
  /** Sends to mix buses, keyed by 1-based bus number. */
  sends: Send[];
  /** Assignment to main buses, keyed by 1-based main number. */
  mainSends: Send[];
  dcaMask: number; // bit i (0-based) => member of DCA i+1
  muteGroupMask: number;
  raw?: Record<string, unknown>;
}

export interface ChannelInput {
  /** Resolved physical source label, e.g. "LCL 1", "A 12", "CARD 3". */
  source: string;
  /** Preamp gain in dB, if the source is a local/stage-box preamp. */
  gain?: number;
  phantom?: boolean;
  invert: boolean;
  trim?: number; // dB
  delayMs?: number;
  delayOn?: boolean;
}

export interface Filter {
  on: boolean;
  freq: number; // Hz
  /** Slope in dB/oct where the console exposes it. */
  slope?: number;
}

export interface EqBand {
  type: "bell" | "low-shelf" | "high-shelf" | "low-cut" | "high-cut";
  freq: number; // Hz
  gain: number; // dB
  q: number;
}

export interface Eq {
  on: boolean;
  model?: string;
  bands: EqBand[];
}

export interface Gate {
  on: boolean;
  model?: string;
  mode?: "gate" | "expander" | "ducker";
  threshold: number; // dB
  range: number; // dB
  attackMs: number;
  holdMs: number;
  releaseMs: number;
  ratio?: number;
  sidechainFreq?: number;
  sidechainOn?: boolean;
}

export interface Compressor {
  on: boolean;
  model?: string;
  mode?: "comp" | "expander";
  detection?: "peak" | "rms";
  threshold: number; // dB
  ratio: number;
  knee: number;
  attackMs: number;
  holdMs: number;
  releaseMs: number;
  gain: number; // makeup dB
  mix: number; // %
  auto?: boolean;
  sidechainFreq?: number;
  sidechainOn?: boolean;
}

export interface Send {
  /** 1-based destination number within its pool. */
  to: number;
  on: boolean;
  level: number; // dB
  pan: number; // -100..100
  tap: SendTap;
}

export type SendTap =
  | "pre-eq"
  | "post-eq"
  | "pre-fader"
  | "post-fader"
  | "group";

export interface Bus {
  index: number;
  name: string;
  colour: ColourName;
  icon?: number;
  mono: boolean;
  mute: boolean;
  fader: number;
  pan: number;
  width: number;
  eq?: Eq;
  comp?: Compressor;
  /** Sends from this bus onward (bus->matrix, bus->main). */
  sends: Send[];
  mainSends: Send[];
  dcaMask: number;
  muteGroupMask: number;
  raw?: Record<string, unknown>;
}

export interface Dca {
  index: number;
  name: string;
  colour: ColourName;
  mute: boolean;
  fader: number;
}

export interface MuteGroup {
  index: number;
  name: string;
  muted: boolean;
}

export interface FxSlot {
  index: number;
  /** Neutral effect kind. */
  kind: FxKind;
  /** Original console model string, kept for the report + best-effort mapping. */
  sourceModel: string;
  /** Named parameters, normalised where understood. */
  params: Record<string, number | string>;
  inputs: string[];
  raw?: Record<string, unknown>;
}

export type FxKind =
  | "reverb"
  | "delay"
  | "modulation"
  | "graphic-eq"
  | "dynamics"
  | "pitch"
  | "amp-sim"
  | "other";

export interface Routing {
  /** One entry per input channel: which physical input feeds it. */
  inputPatch: PatchEntry[];
  /** One entry per physical output: what it carries. */
  outputPatch: PatchEntry[];
  /** Free-form blocks the model doesn't fully understand yet. */
  raw?: Record<string, unknown>;
}

export interface PatchEntry {
  slot: string; // e.g. "IN 1-8", "OUT 9-12", "AES50A 1-8"
  value: string;
}

export interface ConsoleConfig {
  mainMode?: string; // "LR+M", "LCR", ...
  talkback?: Record<string, unknown>;
  osc?: Record<string, unknown>;
  solo?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export type ColourName =
  | "off"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "orange"
  | "purple";

export function emptyModel(source: Platform, kind: ShowModel["kind"]): ShowModel {
  return {
    source,
    kind,
    meta: { name: "" },
    channels: [],
    auxIns: [],
    buses: [],
    matrices: [],
    mains: [],
    dcas: [],
    muteGroups: [],
    fx: [],
    routing: { inputPatch: [], outputPatch: [] },
    config: {},
  };
}
