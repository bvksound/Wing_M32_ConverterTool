# Show file formats

Reverse-engineered from the files in `Examples/`. Not official documentation —
corrections welcome as more sample files come in.

---

## M32 / X32 scene — `.scn`

Line-based ASCII text. Behringer/Midas X32 and M32 share this format (the M32
is the same DSP platform as the X32). Produced by the console `Save` and by
X32-Edit / M32-Edit.

### Header

```
#4.0# "M32R Backup" "" %000000000 1
```

`#<version># "<name>" "<notes>" %<9-bit scope mask> <fx-on?>`

### Body

One parameter per line:

```
/path/segment ARG ARG ARG ...
```

* **Paths** mirror the console OSC tree: `/ch/01/...`, `/bus/01/...`,
  `/mtx/01/...`, `/dca/1`, `/fx/1/...`, `/config/...`, `/headamp/000`,
  `/outputs/main/01`, `/auxin/01/...`, `/fxrtn/01/...`, `/main/st/...`,
  `/main/m/...`.
* Channel-like indices are **zero-padded to 2 digits** (`/ch/01`), DCA and FX
  are not (`/dca/1`, `/fx/1`).
* Args are whitespace-separated. The console writes column-padded output
  (multiple spaces); import tolerates single-space. This tool writes
  single-space and only rewrites lines it changes, leaving the rest of the
  template verbatim.

### Object counts

| Object   | Count | Path            |
|----------|-------|-----------------|
| Channels | 32    | `/ch/01`–`/ch/32` |
| Aux in   | 8     | `/auxin/01`–`08` |
| FX return| 8     | `/fxrtn/01`–`08` |
| Mix bus  | 16    | `/bus/01`–`/bus/16` |
| Matrix   | 6     | `/mtx/01`–`/mtx/06` |
| DCA      | 8     | `/dca/1`–`/dca/8` |
| FX slots | 8     | `/fx/1`–`/fx/8` |
| Main     | LR + Mono/Centre | `/main/st`, `/main/m` |

### Channel strip lines (example `/ch/01`)

```
/ch/01/config "Kick" 1 YE 1          name, icon#, colour, source-index
/ch/01/delay OFF 0.3                 on/off, ms
/ch/01/preamp -2.0 OFF OFF 24 55     trim dB, invert, ..., (hi-pass etc.)
/ch/01/gate OFF GATE -42.5 60.0 10 50.2 162 0
/ch/01/gate/filter OFF 3.0 990.9
/ch/01/dyn ON COMP PEAK LOG -32.0 3.0 1 0.00 10 10.0 151 POST 0 100 OFF
/ch/01/dyn/filter OFF 3.0 990.9
/ch/01/insert OFF POST OFF
/ch/01/eq ON
/ch/01/eq/1 PEQ 158.9 -9.00 1.5      type, freq, gain dB, Q   (4 bands: eq/1..eq/4)
/ch/01/eq/2 PEQ 570.2 +7.00 1.5
/ch/01/eq/3 PEQ 3k94 -6.00 1.5
/ch/01/eq/4 HShv 20k00 +0.00 7.4
/ch/01/mix ON -oo ON +0 OFF -oo      main: on, fader dB, LR-assign, pan, mono-assign, mono-level
/ch/01/mix/01 ON -4.5 +0 EQ-> 0      send 1: on, level dB, pan, tap, (panFollow)
/ch/01/mix/02 ON -32.0               (mono bus: on + level only)
...
/ch/01/grp %00000001 %000001         DCA mask (8), mute-group mask (6)
/ch/01/automix OFF +0.0
```

Bus EQ has **6 bands** (`/bus/01/eq/1..6`); channel EQ has 4.

### Value encodings

| Token        | Meaning |
|--------------|---------|
| `-oo`        | −∞ dB (fader/send off-level) |
| `+0`, `-4.5` | dB, always signed for gain/pan; level sometimes unsigned |
| `158.9`      | Hz |
| `3k94`       | 3940 Hz — `k` is the thousands separator / decimal point ×1000 |
| `20k00`      | 20000 Hz |
| `%00000001`  | bit mask, LSB = first item (DCA 1, mute group 1, …) |
| `YE`,`RD`,`GN`,`BL`,`WH`,`CY`,`MG`,`OFF` | strip colours + optional inverted variants |
| `"..."`      | quoted string (names, notes) |

### EQ band types

`LCut LShv PEQ VEQ HShv HCut` — M32 uses `PEQ` (bell), `LShv`/`HShv` (shelf),
`LCut`/`HCut` (pass).

---

## Wing snapshot — `.snap` / channel preset — `.chn`

JSON. Firmware 3.x (`creator_fw: "3.1..."`). Produced by WING console and
WING-Edit.

### Top level

```jsonc
{
  "type": "snapshot.11",          // or "chpreset.11"
  "creator_fw": "3.1-0-...:release",
  "creator_model": "wing-compact",
  "created": "2026-04-05 17:24:05",
  "active_show": "", "active_scene": "...",
  "ae_data": { ... },             // audio-engine state (the part we convert)
  "ce_data": { ... },             // control-surface state (layers, user keys)
  "ae_globals": { ... }, "ce_globals": { ... }
}
```

`.chn` presets wrap a single strip in `ch_data` plus `scopes_*` strings and
`source_channel` / `info_text`.

### `ae_data` structure

| Key            | Count | Notes |
|----------------|-------|-------|
| `ae_data.ch`   | 40    | input channels |
| `ae_data.aux`  | 8     | aux (line) inputs |
| `ae_data.bus`  | 16    | mix buses |
| `ae_data.main` | 4     | main buses (stereo-capable) |
| `ae_data.mtx`  | 8     | matrices |
| `ae_data.dca`  | 16    | DCAs |
| `ae_data.mgrp` | 8     | mute groups |
| `ae_data.fx`   | 16    | effects slots |
| `ae_data.io`   | —     | `io.in.LCL`, `io.in.A`, … source patch: gain, phantom, name per physical input |
| `ae_data.cfg`  | —     | monitor, solo, talkback, RTA, automix |

### Channel object (`ae_data.ch.N`)

```jsonc
{
  "in":  { "set": { "inv": false, "trim": 0, "dly": 0.1, "dlyon": false },
           "conn": { "grp": "A", "in": 1, "altgrp": "LCL", "altin": 1 } },
  "flt": { "lc": true, "lcf": 100.2, "lcs": "24", "hc": false, "hcf": 10018, "hcs": "12", "mdl": "TILT", "tilt": 0 },
  "name": "Kick", "col": 9, "icon": 0, "mute": false,
  "fdr": -144, "pan": 0, "wid": 100, "clink": false,   // clink = stereo link
  "peq":  { "on": false, "1g":0,"1f":99.7,"1q":1.0, ... },   // pre-EQ, 3-band
  "gate": { "on": false, "mdl": "GATE", "thr": -40, "range": 40, "att": 10, "hld": 10, "rel": 200, "ratio": "1:3" },
  "eq":   { "on": false, "mdl": "STD", "mix": 100,
            "lg":0,"lf":80,"lq":1.0,"leq":"SHV",           // low band
            "1g":0,"1f":200,"1q":1.0, ... "4g":0,"4f":3990,"4q":1.0,  // 4 mid bands
            "hg":0,"hf":12000,"hq":1.0,"heq":"SHV" },      // high band  -> 6 bands total
  "dyn":  { "on": false, "mdl": "COMP", "thr": -10, "ratio": 3, "knee": 3, "att": 50, "hld": 20, "rel": 150, "auto": true },
  "main": { "1": { "on": true, "lvl": 0, "pre": false }, "2": {...}, "3": {...}, "4": {...} },
  "send": { "1": { "on": false, "lvl": -144, "mode": "PRE", "pan": 0 }, ... "16": {...},
            "MX1": {...}, ... "MX8": {...} }
}
```

### Value encodings

* Levels/gains: **dB as float** already (`-5.68`, `-144` = off).
* Frequencies: **Hz as float** (`99.685`).
* Q: float (`0.998`).
* Pan: `-100..+100`; width `wid`: `-100..+100` (0 for mono buses).
* Colours: `col` integer 1..15 (WING palette), separate from M32 colour codes.
* Model strings name emulations: EQ `STD`/`PRO`/`SUSB`…, comp `COMP`/`B560`/`FAIR`…,
  gate `GATE`/`DS902`…, FX `TAP-DL`/`HALL`/`VRM`/`CRS`…

---

## Conversion notes (Wing ⇄ M32)

| Aspect        | Wing        | M32   | On convert |
|---------------|-------------|-------|------------|
| Channels      | 40          | 32    | Wing 33–40 dropped W→M; M gets 32 |
| Mix buses     | 16          | 16    | 1:1 |
| Matrices      | 8           | 6     | Wing 7–8 dropped W→M |
| DCAs          | 16          | 8     | Wing 9–16 dropped W→M |
| Mute groups   | 8           | 6     | Wing 7–8 dropped W→M |
| FX slots      | 16          | 8     | Wing 9–16 dropped; models remapped via table |
| Channel EQ    | 6 band + models | 4 band PEQ/shelf | fold: keep LF/HF shelf + 2 most-active mids |
| Channel LPF   | dedicated `flt.hc` | none — only an EQ `HCut` band | W→M: high-cut becomes EQ band 4 `HCut` (costs a band). M→W: an `LCut`/`HCut` EQ band becomes the WING `flt.lc`/`flt.hc`. |
| Channel HPF   | dedicated `flt.lc` | dedicated (`/ch/*/preamp` hpon/hpf) | 1:1 |
| Gate/Comp     | named models| generic | model → nearest M32 algo; core params (thr/ratio/att/rel) carried |
| Preamp gain   | `io.in.*`   | `/headamp/NNN` | mapped by resolved physical input |
| Level curve   | dB          | dB / `-oo` | direct; ≤ −90 dB → `-oo` |

All lossy steps are listed per-object in the conversion report and are opt-in
via the selection tree.
