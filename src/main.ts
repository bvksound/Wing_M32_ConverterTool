import "./theme.css";
import logoUrl from "./assets/bvk-logo.png";
import { convert, loadShowFile, type LoadedFile } from "./convert/convert";
import { blankM32Scene } from "./m32/m32Writer";
import { blankWingSnapshot, writeWingChannelPreset } from "./wing/wingWriter";
import { makeZip } from "./util/zip";
import {
  BLOCK_LABELS,
  BUS_BLOCKS,
  CHANNEL_BLOCKS,
} from "./convert/inventory";
import type {
  ClearSet,
  ConversionResult,
  InventoryNode,
  ReportEntry,
  Selection,
} from "./convert/types";

const dropzone = must<HTMLDivElement>("#drop");
const fileInput = must<HTMLInputElement>("#file");
const workspace = must<HTMLDivElement>("#workspace");

// Logo is bundled (inlined as a data URI at build time) so the built
// dist/index.html is a single self-contained file.
const brandLogo = document.querySelector<HTMLImageElement>("#brand-logo");
if (brandLogo) brandLogo.src = logoUrl;
const favicon = document.querySelector<HTMLLinkElement>("#favicon");
if (favicon) favicon.href = logoUrl;

document.querySelector<HTMLButtonElement>("#blank-scn")?.addEventListener("click", () => {
  saveText("BLANK.scn", blankM32Scene("BLANK"), "text/plain");
});
document.querySelector<HTMLButtonElement>("#blank-snap")?.addEventListener("click", () => {
  saveText("BLANK.snap", blankWingSnapshot(), "application/json");
});

let loaded: LoadedFile | null = null;
let selection: Selection = new Set();
let cleared: ClearSet = new Set();
let lastResult: ConversionResult | null = null;
let activeSection = "channels";
let renderedSection: string | null = null;

// --- file intake -----------------------------------------------------------

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void intake(f);
});
["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
  }),
);
dropzone.addEventListener("drop", (e) => {
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) void intake(f);
});

async function intake(file: File): Promise<void> {
  clearError();
  try {
    const text = await file.text();
    loaded = loadShowFile(file.name, text);
    selection = defaultSelection(loaded.inventory.root);
    cleared = new Set();
    activeSection = loaded.inventory.root[0]?.id ?? "channels";
    renderedSection = null;
    renderWorkspace();
    recompute();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

// --- selection engine -----------------------------------------------------

function defaultSelection(nodes: InventoryNode[]): Selection {
  const sel: Selection = new Set();
  const walk = (n: InventoryNode) => {
    if (n.children?.length) n.children.forEach(walk);
    else if (n.defaultOn) sel.add(n.id);
  };
  nodes.forEach(walk);
  return sel;
}
function leavesOf(node: InventoryNode): InventoryNode[] {
  if (!node.children?.length) return [node];
  return node.children.flatMap(leavesOf);
}
function convertibleLeaves(node: InventoryNode): InventoryNode[] {
  return leavesOf(node).filter((l) => l.convertible);
}
function nodeState(node: InventoryNode): "on" | "off" | "mixed" {
  const leaves = convertibleLeaves(node);
  if (!leaves.length) return "off";
  const on = leaves.filter((l) => selection.has(l.id)).length;
  return on === 0 ? "off" : on === leaves.length ? "on" : "mixed";
}
function setSubtree(node: InventoryNode, on: boolean): void {
  for (const leaf of convertibleLeaves(node)) {
    if (on) selection.add(leaf.id);
    else selection.delete(leaf.id);
  }
}
function findNode(id: string): InventoryNode | undefined {
  const stack = [...(loaded?.inventory.root ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    if (n.children) stack.push(...n.children);
  }
  return undefined;
}

// --- workspace shell -----------------------------------------------------

function renderWorkspace(): void {
  if (!loaded) return;
  workspace.hidden = false;
  const strong = dropzone.querySelector(".dz-inner strong");
  if (strong) strong.textContent = "Drop another file to start over";

  const { source, target, model, inventory } = loaded;
  const ext = target === "m32" ? "scn" : model.kind === "channel-preset" ? "chn" : "snap";

  const modelPill = model.meta.model
    ? `<span class="pill dim" title="${escapeHtml(model.meta.firmware ?? "")}">${escapeHtml(model.meta.model)}</span>`
    : "";

  workspace.innerHTML = `
    <div class="summary-card">
      <div class="sc-row">
        <div class="flow"><span>${source.toUpperCase()}</span><span class="arrow">→</span><span>${target.toUpperCase()}</span></div>
        <span class="pill">${escapeHtml(model.meta.name || loaded.filename)}</span>
        ${modelPill}
      </div>

      <div class="sc-row">
        <span class="sc-label">Overview</span>
        <div class="stat-strip" id="stats"></div>
      </div>

      <div class="sc-row">
        <span class="sc-label">Download</span>
        <div class="card-actions">
          <button class="btn btn-primary dl-btn" id="export-presets">↓ Export presets <code>.zip</code></button>
          <button class="btn btn-primary dl-btn" id="download">↓ Convert &amp; download <code>.${ext}</code></button>
        </div>
      </div>
    </div>

    <div class="toolbar">
      <span class="sc-label">Sections</span>
      <div class="section-nav" id="nav"></div>
      <span class="grow"></span>
      <span class="tool-hint">Select what transfers:</span>
      <button class="link-btn" id="sel-all">All</button>
      <button class="link-btn" id="sel-none">None</button>
      <button class="link-btn" id="sel-default">Reset</button>
    </div>

    <div class="cols">
      <div id="section-host"></div>
      <aside class="report-rail">
        <div class="card">
          <header><h2>Report</h2><span class="report-counts" id="report-counts"></span></header>
          <div class="report" id="report"></div>
        </div>
      </aside>
    </div>
  `;

  must<HTMLButtonElement>("#download").addEventListener("click", download);
  must<HTMLButtonElement>("#export-presets").addEventListener("click", exportAllChannelPresets);
  must<HTMLButtonElement>("#sel-all").addEventListener("click", () => {
    cleared.clear();
    inventory.root.forEach((n) => setSubtree(n, true));
    rerender();
  });
  must<HTMLButtonElement>("#sel-none").addEventListener("click", () => {
    selection.clear();
    cleared.clear();
    rerender();
  });
  must<HTMLButtonElement>("#sel-default").addEventListener("click", () => {
    selection = defaultSelection(inventory.root);
    cleared.clear();
    rerender();
  });

  renderNav();
  renderStats();
  renderSection();
}

function rerender(): void {
  renderNav();
  renderStats();
  renderSection();
  recompute();
}

function renderNav(): void {
  const nav = must<HTMLDivElement>("#nav");
  nav.innerHTML = "";
  for (const group of loaded!.inventory.root) {
    const st = nodeState(group);
    const btn = document.createElement("button");
    btn.className = "nav-pill" + (group.id === activeSection ? " active" : "");
    const count = group.children?.length ?? 0;
    btn.innerHTML = `${escapeHtml(group.label)}${count ? `<span class="nav-count">${count}</span>` : ""}${
      st === "off" ? `<span class="nav-dot off"></span>` : st === "mixed" ? `<span class="nav-dot mixed"></span>` : `<span class="nav-dot on"></span>`
    }`;
    btn.addEventListener("click", () => {
      activeSection = group.id;
      renderNav();
      renderSection();
    });
    nav.appendChild(btn);
  }
}

function renderStats(): void {
  const host = must<HTMLDivElement>("#stats");
  const inv = loaded!.inventory;
  const chips: string[] = [];
  for (const g of inv.root) {
    if (!g.children?.length) continue;
    const total = g.children.length;
    const droppable = g.children.filter((c) => !c.convertible).length;
    const sel = g.children.filter((c) => convertibleLeaves(c).some((l) => selection.has(l.id))).length;
    chips.push(
      `<span class="stat" title="${sel} selected of ${total}${droppable ? `, ${droppable} can't convert` : ""}">
        <span class="stat-k">${escapeHtml(g.label)}</span>
        <span class="stat-v">${sel}/${total}${droppable ? `<span class="stat-drop">−${droppable}</span>` : ""}</span>
      </span>`,
    );
  }
  host.innerHTML = chips.join("");
}

// --- sections ----------------------------------------------------------

function renderSection(): void {
  const host = must<HTMLDivElement>("#section-host");
  const group = loaded!.inventory.root.find((g) => g.id === activeSection);
  if (!group) {
    host.innerHTML = "";
    return;
  }
  // Preserve scroll position of the inner list across a re-render so toggling a
  // row doesn't jump the list back to the top — but only when we're re-rendering
  // the same section, not switching to a new one.
  const sameSection = renderedSection === group.id;
  const prevScroll = sameSection
    ? (host.querySelector<HTMLElement>(".matrix-body, .fx-body, .chip-body, .list-body")?.scrollTop ?? 0)
    : 0;
  host.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card";

  if (["channels", "auxins"].includes(group.id)) {
    card.style.setProperty("--nblocks", String(CHANNEL_BLOCKS.length));
    card.appendChild(matrixHeader(group, CHANNEL_BLOCKS));
    card.appendChild(matrixBody(group, CHANNEL_BLOCKS, true));
  } else if (["buses", "matrices", "mains"].includes(group.id)) {
    card.style.setProperty("--nblocks", String(BUS_BLOCKS.length));
    card.appendChild(matrixHeader(group, BUS_BLOCKS));
    card.appendChild(matrixBody(group, BUS_BLOCKS, false));
  } else if (group.id === "fx") {
    card.appendChild(plainHeader(group));
    card.appendChild(fxBody(group));
  } else if (["dcas", "mutegroups"].includes(group.id)) {
    card.appendChild(plainHeader(group));
    card.appendChild(chipBody(group));
  } else {
    card.appendChild(plainHeader(group));
    card.appendChild(listBody(group));
  }
  host.appendChild(card);
  if (prevScroll) {
    const scroller = host.querySelector<HTMLElement>(
      ".matrix-body, .fx-body, .chip-body, .list-body",
    );
    if (scroller) scroller.scrollTop = prevScroll;
  }
  renderedSection = group.id;
}

function plainHeader(group: InventoryNode): HTMLElement {
  const h = document.createElement("header");
  h.innerHTML = `<h2>${escapeHtml(group.label)}</h2>`;
  const box = document.createElement("label");
  box.className = "hdr-toggle";
  const cb = mkCheck(nodeState(group));
  cb.addEventListener("change", () => {
    setSubtree(group, cb.checked);
    rerender();
  });
  box.append(cb, document.createTextNode(" all"));
  h.appendChild(box);
  return h;
}

function matrixHeader(group: InventoryNode, blocks: readonly string[]): HTMLElement {
  const h = document.createElement("header");
  h.className = "matrix-header";
  const left = document.createElement("div");
  left.className = "mh-left";
  const cb = mkCheck(nodeState(group));
  cb.title = "Select the whole section";
  cb.addEventListener("change", () => {
    setSubtree(group, cb.checked);
    rerender();
  });
  left.append(cb);
  const t = document.createElement("h2");
  t.textContent = group.label;
  left.append(t);

  const spacer = document.createElement("span");
  spacer.className = "grow";
  left.append(spacer);

  // Whole-row selection — ticks/unticks every strip in this section entirely
  // (all of its blocks), distinct from the per-block toggles below.
  const rowNoun = group.label.toLowerCase();
  const selAll = document.createElement("button");
  selAll.className = "link-btn";
  selAll.textContent = `Select all ${rowNoun}`;
  selAll.title = `Tick every strip in ${rowNoun} completely`;
  selAll.addEventListener("click", () => {
    setSubtree(group, true);
    rerender();
  });
  const selNone = document.createElement("button");
  selNone.className = "link-btn";
  selNone.textContent = `Deselect all ${rowNoun}`;
  selNone.title = `Untick every strip in ${rowNoun} completely`;
  selNone.addEventListener("click", () => {
    setSubtree(group, false);
    rerender();
  });
  left.append(selAll, selNone);

  h.appendChild(left);

  const colsLabel = document.createElement("div");
  colsLabel.className = "mh-cols-label";
  colsLabel.textContent = "Toggle one option for every row:";
  h.appendChild(colsLabel);

  const cols = document.createElement("div");
  cols.className = "mh-cols";
  for (const b of blocks) {
    const btn = document.createElement("button");
    btn.className = "col-toggle " + colState(group, b);
    btn.textContent = BLOCK_LABELS[b] ?? b;
    btn.title = `Toggle ${BLOCK_LABELS[b] ?? b} for every channel`;
    btn.addEventListener("click", () => {
      const target = colState(group, b) !== "on";
      for (const child of group.children ?? []) {
        const leaf = child.children?.find((l) => l.id.endsWith(`.${b}`));
        if (leaf?.convertible) {
          if (target) selection.add(leaf.id);
          else selection.delete(leaf.id);
        }
      }
      rerender();
    });
    cols.appendChild(btn);
  }
  h.appendChild(cols);
  return h;
}

function colState(group: InventoryNode, block: string): "on" | "off" | "mixed" {
  const leaves = (group.children ?? [])
    .map((c) => c.children?.find((l) => l.id.endsWith(`.${block}`)))
    .filter((l): l is InventoryNode => !!l && l.convertible);
  if (!leaves.length) return "off";
  const on = leaves.filter((l) => selection.has(l.id)).length;
  return on === 0 ? "off" : on === leaves.length ? "on" : "mixed";
}

function matrixBody(
  group: InventoryNode,
  blocks: readonly string[],
  isChannel: boolean,
): HTMLElement {
  const body = document.createElement("div");
  body.className = "matrix-body";
  for (const child of group.children ?? []) {
    body.appendChild(matrixRow(child, blocks, isChannel));
  }
  return body;
}

function matrixRow(
  node: InventoryNode,
  blocks: readonly string[],
  isChannel: boolean,
): HTMLElement {
  const isCleared = cleared.has(node.id);
  const row = document.createElement("div");
  row.className = "mrow";
  if (!node.convertible) row.classList.add("dropped");
  else if (isCleared) row.classList.add("cleared");
  else if (!node.active) row.classList.add("inactive");
  row.style.setProperty("--col", colourVar(isCleared ? "off" : node.facets?.colour));

  const idx = node.id.split(".").pop()!;
  const rowLeaves = convertibleLeaves(node);
  const rowState =
    isCleared || rowLeaves.length === 0
      ? "off"
      : rowLeaves.every((l) => selection.has(l.id))
        ? "on"
        : rowLeaves.some((l) => selection.has(l.id))
          ? "mixed"
          : "off";

  const cb = mkCheck(node.convertible && !isCleared ? rowState : "off");
  cb.disabled = !node.convertible || isCleared;
  cb.addEventListener("change", () => {
    setSubtree(node, cb.checked);
    rerender();
  });

  const label = document.createElement("div");
  label.className = "mrow-id";
  label.innerHTML = `<span class="cbadge"></span><span class="num">${escapeHtml(idx)}</span>`;
  label.prepend(cb);

  const nameBox = document.createElement("div");
  nameBox.className = "mrow-name";
  const src = node.facets?.source;
  const showSrc = isChannel && src && src !== node.label && node.label !== "—";
  nameBox.innerHTML = `
    <span class="nm">${escapeHtml(node.label)}</span>
    ${showSrc ? `<span class="src">${escapeHtml(src)}</span>` : ""}
  `;

  const meta = document.createElement("div");
  meta.className = "mrow-meta";
  const f = node.facets?.fader;
  meta.innerHTML = `
    ${isCleared ? `<span class="blank-badge">BLANK</span>` : ""}
    ${node.facets?.muted && !isCleared ? `<span class="tag mute">M</span>` : ""}
    ${node.facets?.stereo && !isCleared ? `<span class="tag st">ST</span>` : ""}
    ${!isCleared && f != null && Number.isFinite(f) ? `<span class="db">${fmtDb(f)}</span>` : !isCleared && f != null ? `<span class="db">−∞</span>` : ""}
  `;

  const cells = document.createElement("div");
  cells.className = "mrow-cells";
  for (const b of blocks) {
    cells.appendChild(blockCell(node, b, isCleared));
  }

  const clearBtn = document.createElement("button");
  clearBtn.className = "clear-btn" + (isCleared ? " active" : "");
  clearBtn.disabled = !node.convertible;
  clearBtn.textContent = isCleared ? "↺" : "⌫";
  clearBtn.title = node.convertible
    ? isCleared
      ? "Undo — stop blanking this strip on the target"
      : "Blank this strip on the converted file (name, EQ, dynamics, sends all reset)"
    : "";
  clearBtn.addEventListener("click", () => {
    if (!node.convertible) return;
    if (cleared.has(node.id)) {
      cleared.delete(node.id);
    } else {
      cleared.add(node.id);
      setSubtree(node, false);
    }
    rerender();
  });

  row.append(label, nameBox, meta, cells, clearBtn);
  if (!node.convertible && node.note) {
    row.title = node.note;
    const drop = document.createElement("span");
    drop.className = "drop-badge";
    drop.textContent = "DROP";
    meta.prepend(drop);
  }
  return row;
}

function blockCell(node: InventoryNode, block: string, isCleared: boolean): HTMLElement {
  const leaf = node.children?.find((l) => l.id.endsWith(`.${block}`));
  const cell = document.createElement("button");
  cell.className = "cell";
  cell.textContent = BLOCK_LABELS[block] ?? block;

  if (!leaf || !node.convertible || isCleared) {
    cell.classList.add("na");
    cell.disabled = true;
    return cell;
  }
  const on = selection.has(leaf.id);
  cell.classList.add(leaf.active ? "has" : "empty", on ? "on" : "off");
  if (leaf.note) {
    cell.classList.add("noted");
    cell.title = leaf.note + (leaf.detail ? `  (${leaf.detail})` : "");
  } else if (leaf.detail) {
    cell.title = leaf.detail;
  }
  cell.addEventListener("click", () => {
    if (on) selection.delete(leaf.id);
    else selection.add(leaf.id);
    rerender();
  });
  return cell;
}

function fxBody(group: InventoryNode): HTMLElement {
  const body = document.createElement("div");
  body.className = "fx-body";
  for (const node of group.children ?? []) {
    const on = node.convertible && selection.has(node.id);
    const item = document.createElement("button");
    item.className = "fx-item" + (on ? " on" : "") + (node.convertible ? "" : " dropped");
    item.disabled = !node.convertible;
    item.innerHTML = `
      <span class="fx-check"></span>
      <span class="fx-slot">${escapeHtml(node.label)}</span>
      <span class="fx-model">${escapeHtml(node.detail ?? "")}</span>
      <span class="fx-kind">${escapeHtml(node.facets?.kind ?? "")}</span>
      ${node.note ? `<span class="fx-note">${escapeHtml(node.note)}</span>` : ""}
    `;
    item.addEventListener("click", () => {
      if (!node.convertible) return;
      if (selection.has(node.id)) selection.delete(node.id);
      else selection.add(node.id);
      rerender();
    });
    body.appendChild(item);
  }
  return body;
}

function chipBody(group: InventoryNode): HTMLElement {
  const body = document.createElement("div");
  body.className = "chip-body";
  for (const node of group.children ?? []) {
    const on = node.convertible && selection.has(node.id);
    const chip = document.createElement("button");
    chip.className = "chip" + (on ? " on" : "") + (node.convertible ? "" : " dropped");
    chip.disabled = !node.convertible;
    chip.style.setProperty("--col", colourVar(node.facets?.colour));
    chip.innerHTML = `<span class="cdot"></span>${escapeHtml(node.id.split(".").pop()!)} · ${escapeHtml(node.label)}`;
    if (node.note) chip.title = node.note;
    chip.addEventListener("click", () => {
      if (!node.convertible) return;
      if (selection.has(node.id)) selection.delete(node.id);
      else selection.add(node.id);
      rerender();
    });
    body.appendChild(chip);
  }
  return body;
}

function listBody(group: InventoryNode): HTMLElement {
  const body = document.createElement("div");
  body.className = "list-body";
  if (group.note) {
    const n = document.createElement("p");
    n.className = "list-note";
    n.textContent = group.note;
    body.appendChild(n);
  }
  for (const node of group.children ?? []) {
    const row = document.createElement("label");
    row.className = "list-row";
    const cb = mkCheck(selection.has(node.id) ? "on" : "off");
    cb.disabled = !node.convertible;
    cb.addEventListener("change", () => {
      if (cb.checked) selection.add(node.id);
      else selection.delete(node.id);
      rerender();
    });
    row.append(cb);
    const span = document.createElement("span");
    span.innerHTML = `${escapeHtml(node.label)} ${node.detail ? `<span class="dim">${escapeHtml(node.detail)}</span>` : ""}`;
    row.append(span);
    body.appendChild(row);
  }
  return body;
}

// --- report --------------------------------------------------------------

function recompute(): void {
  if (!loaded) return;
  lastResult = convert(loaded, selection, cleared);
  renderReport(lastResult.report);
  const btn = document.querySelector<HTMLButtonElement>("#download");
  if (btn) btn.disabled = selection.size === 0 && cleared.size === 0;
}

function renderReport(report: ReportEntry[]): void {
  const host = must<HTMLDivElement>("#report");
  const counts = must<HTMLSpanElement>("#report-counts");
  const drops = report.filter((r) => r.severity === "drop").length;
  const warns = report.filter((r) => r.severity === "warn").length;
  counts.innerHTML = `${drops ? `<span class="c drop">${drops} dropped</span>` : ""}${
    warns ? `<span class="c warn">${warns} caveats</span>` : ""
  }`;
  if (!report.length) {
    host.innerHTML = `<div class="empty">Nothing selected.</div>`;
    return;
  }
  const ico: Record<string, string> = { ok: "✓", info: "·", warn: "!", drop: "✕" };
  host.innerHTML = report
    .map(
      (r) => `
      <div class="report-item ${r.severity}">
        <span class="ico">${ico[r.severity] ?? "·"}</span>
        <span><span class="scope">${escapeHtml(r.scope)}</span>${escapeHtml(r.message)}</span>
      </div>`,
    )
    .join("");
}

function download(): void {
  if (!lastResult) return;
  saveText(lastResult.filename, lastResult.text, lastResult.mime);
}

function saveText(filename: string, text: string, mime: string): void {
  saveBlob(filename, new Blob([text], { type: mime }));
}

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download every currently-selected strip in a channel/aux section as its own
 * WING .chn preset, zipped into one file — e.g. to rebuild a preset library
 * (like Examples/Wing/2_PRESETS) from a converted show, regardless of whether
 * the source was WING or M32.
 */
/**
 * Every currently-selected input channel / aux strip, exported as individual
 * WING .chn presets and zipped into one download — sits next to "Convert &
 * download" since it's the other thing you can pull out of a loaded show.
 */
function exportAllChannelPresets(): void {
  if (!loaded) return;
  const groups = loaded.inventory.root.filter((g) => g.id === "channels" || g.id === "auxins");
  const entries = groups.flatMap((g) => collectPresetEntries(g));
  if (!entries.length) {
    window.alert("No channels selected — tick at least one strip first.");
    return;
  }
  const showName = (loaded.model.meta.name || "channels").replace(/[\\/:*?"<>|]/g, "_");
  saveBlob(`${showName} presets.zip`, makeZip(entries));
}

function collectPresetEntries(group: InventoryNode): { name: string; data: string }[] {
  if (!loaded) return [];
  const source = group.id === "auxins" ? loaded.model.auxIns : loaded.model.channels;
  const folder = group.id === "auxins" ? "Aux" : "Channels";
  const included = (group.children ?? []).filter((n) => {
    if (!n.convertible) return false;
    return convertibleLeaves(n).some((l) => selection.has(l.id));
  });
  return included.map((node) => {
    const index = Number(node.id.split(".").pop());
    const ch = source.find((c) => c.index === index)!;
    const safeName = (ch.name || `CH ${pad2(index)}`).replace(/[\\/:*?"<>|]/g, "_").trim();
    return { name: `${folder}/${pad2(index)}_${safeName}.chn`, data: writeWingChannelPreset(ch) };
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// --- utils --------------------------------------------------------------

function mkCheck(state: "on" | "off" | "mixed"): HTMLInputElement {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = state === "on";
  cb.indeterminate = state === "mixed";
  return cb;
}
function colourVar(name?: string): string {
  const map: Record<string, string> = {
    red: "#ef5a6f", green: "#35d07f", yellow: "#e8b64c", blue: "#4a90e2",
    magenta: "#d46fd4", cyan: "#3fd1c7", white: "#e8edf0", orange: "#e8934c",
    purple: "#9b6fd4", off: "#3a444d",
  };
  return map[name ?? "off"] ?? "#3a444d";
}
function fmtDb(db: number): string {
  if (!Number.isFinite(db)) return "−∞";
  return (db > 0 ? "+" : "") + db.toFixed(1);
}
function must<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}
function showError(msg: string): void {
  clearError();
  const p = document.createElement("p");
  p.className = "err";
  p.id = "err";
  p.textContent = `Could not read that file: ${msg}`;
  dropzone.after(p);
}
function clearError(): void {
  document.querySelector("#err")?.remove();
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
