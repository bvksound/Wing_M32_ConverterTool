# Wing ⇄ M32 Converter

A browser tool that transfers mixer shows between the **Behringer WING** and the
**Midas / Behringer M32 (X32)** platform, in both directions.

Everything runs client-side — a show file dropped into the page never leaves the
browser. `npm run build` produces a single self-contained `dist/WingM32Converter.html` you
can open offline or host anywhere static.

## Run it in a browser

**Option A — dev server (for working on it):**

```bash
npm install
npm run dev
```

Open the URL it prints (http://localhost:5178). Edits reload live.

**Option B — build the standalone file (to use or share):**

```bash
npm install
npm run build
```

This writes a single self-contained `dist/WingM32Converter.html` (no other files, ~460 kB).
Double-click it, or open it in any browser — it works offline and over `file://`.
Nothing is uploaded; the show file is parsed in the page.

```bash
npm test           # run the vitest suite
```

Drop a file:

| File | Console | Converts to |
|------|---------|-------------|
| `.snap` | WING snapshot | M32 scene `.scn` |
| `.chn`  | WING channel preset | M32 channel strip `.scn` |
| `.scn`  | M32 / X32 scene | WING snapshot `.snap` |

Each section (Channels, Buses, FX, …) is a matrix: one row per strip, one cell
per processing block (Strip / In / EQ / Gate / Dyn / Sends). Click a cell to
toggle it, a column header to toggle that block for the whole section, or use
**Select all / Deselect all** per section. Everything that maps cleanly is
pre-ticked. Hit **Convert & download**; the **Report** panel lists everything
that was clamped, folded or dropped.

- **⌫ per row** blanks that strip on the output (name/EQ/dynamics/sends reset
  to neutral) instead of leaving it selected or falling back to the target
  template's values.
- **Export presets ↓** next to Convert & download zips every selected
  channel/aux strip into individual WING `.chn` presets — handy for
  rebuilding a preset library (like `Examples/Wing/2_PRESETS`) from a
  converted show, whether the source was WING or M32. Like every preset
  WING-Edit itself
  exports, the channel name is *not* stored in the preset (only in its
  library label) — recalling a preset changes processing, not the channel's
  identity, so loading one won't rename the channel. That's WING's own
  behaviour, not a converter bug.
- **Blank templates** on the landing page hand you a fully-cleared `.scn` /
  `.snap` with no file loaded at all.

## How it works

```
source file ──parse──▶ ShowModel (neutral: dB, Hz, ms) ──write──▶ target file
                          ▲                                  │
                      inventory tree                  template + patch
```

- **`src/model/`** — the console-neutral `ShowModel`.
- **`src/m32/`** — `.scn` tokeniser + `ScnDocument` (ordered line tree), reader,
  writer.
- **`src/wing/`** — WING JSON `WingDoc`, reader, writer.
- **`src/convert/`** — inventory tree, EQ band-folding, FX model map, the
  `convert()` orchestrator and the report.
- **Template + patch:** each writer starts from a known-good file of the target
  format (`src/templates/`) and overwrites only the parameters your selection
  produced. Untouched lines come back byte-for-byte, so the output always loads
  on the console. The flip side: blocks you *don't* select keep the template's
  values, not neutral defaults.

See [FORMATS.md](FORMATS.md) for the reverse-engineered file formats.

## Status / caveats

First working version. The pipeline round-trips the sample files in `Examples/`
and produces parseable output both ways, but parameter mapping has **not yet
been verified against a physical console**. Known rough edges:

- Compressor/gate model-specific params (WING `B560`, `DS902`, …) collapse to the
  generic M32 algorithm; ratio/knee arg positions in `/ch/*/dyn` need a console
  check.
- FX conversion transfers the *slot type* only — parameters reset to type
  defaults.
- Routing and console config are off by default; physical I/O differs between the
  desks and needs manual review after import.
- The bundled templates are real shows; a neutral/blank template per format is a
  TODO.

Always check a converted show on the desk before a gig.

Not affiliated with Music Tribe, Behringer or Midas.
