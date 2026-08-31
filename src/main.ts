import "./theme.css";
import { convert, loadShowFile, type LoadedFile } from "./convert/convert";
import type { ConversionResult, InventoryNode, Selection } from "./convert/types";

const dropzone = must<HTMLDivElement>("#drop");
const fileInput = must<HTMLInputElement>("#file");
const workspace = must<HTMLDivElement>("#workspace");

let loaded: LoadedFile | null = null;
let selection: Selection = new Set();
let lastResult: ConversionResult | null = null;

// --- file intake -------------------------------------------------------------

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
    renderWorkspace();
    recompute();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

// --- selection --------------------------------------------------------------

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

function nodeState(node: InventoryNode): "on" | "off" | "mixed" {
  const leaves = leavesOf(node).filter((l) => l.convertible);
  if (!leaves.length) return "off";
  const on = leaves.filter((l) => selection.has(l.id)).length;
  if (on === 0) return "off";
  if (on === leaves.length) return "on";
  return "mixed";
}

function setSubtree(node: InventoryNode, on: boolean): void {
  for (const leaf of leavesOf(node)) {
    if (!leaf.convertible) continue;
    if (on) selection.add(leaf.id);
    else selection.delete(leaf.id);
  }
}

// --- rendering --------------------------------------------------------------

function renderWorkspace(): void {
  if (!loaded) return;
  workspace.hidden = false;
  dropzone.querySelector(".dz-inner strong")!.textContent = "Drop another file to start over";

  const src = loaded.source.toUpperCase();
  const tgt = loaded.target.toUpperCase();
  const kindLabel =
    loaded.model.kind === "channel-preset" ? "Channel preset" : "Scene / snapshot";

  workspace.innerHTML = `
    <div class="summary-card">
      <div class="flow">
        <span>${src}</span><span class="arrow">→</span><span>${tgt}</span>
      </div>
      <span class="pill">${kindLabel}</span>
      <span class="pill" title="${escapeHtml(loaded.model.meta.firmware ?? "")}">
        ${escapeHtml(loaded.model.meta.model ?? loaded.filename)}
      </span>
      <span class="grow"></span>
      <button class="btn btn-primary" id="download">Convert &amp; download .${
        loaded.target === "m32" ? "scn" : loaded.model.kind === "channel-preset" ? "chn" : "snap"
      }</button>
    </div>

    <div class="cols">
      <div class="card">
        <header>
          <h2>What to convert</h2>
          <div class="card-actions">
            <button class="link-btn" id="sel-all">All</button>
            <button class="link-btn" id="sel-none">None</button>
            <button class="link-btn" id="sel-default">Default</button>
          </div>
        </header>
        <div class="tree" id="tree"></div>
      </div>
      <div class="card">
        <header><h2>Conversion report</h2></header>
        <div class="report" id="report"></div>
      </div>
    </div>
  `;

  must<HTMLButtonElement>("#download").addEventListener("click", download);
  must<HTMLButtonElement>("#sel-all").addEventListener("click", () => {
    loaded!.inventory.root.forEach((n) => setSubtree(n, true));
    renderTree();
    recompute();
  });
  must<HTMLButtonElement>("#sel-none").addEventListener("click", () => {
    selection.clear();
    renderTree();
    recompute();
  });
  must<HTMLButtonElement>("#sel-default").addEventListener("click", () => {
    selection = defaultSelection(loaded!.inventory.root);
    renderTree();
    recompute();
  });

  renderTree();
}

function renderTree(): void {
  const host = must<HTMLDivElement>("#tree");
  host.innerHTML = "";
  loaded!.inventory.root.forEach((n) => host.appendChild(renderNode(n, 0)));
}

function renderNode(node: InventoryNode, depth: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "node";
  el.style.setProperty("--indent", `${depth * 18}px`);

  const isBranch = !!node.children?.length;
  const row = document.createElement("div");
  row.className = "node-row" + (!node.convertible ? " warn" : "");

  const twist = document.createElement("button");
  twist.className = "twist" + (isBranch ? "" : " leaf");
  twist.textContent = "▼";
  row.appendChild(twist);

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.disabled = !node.convertible && !isBranch;
  row.appendChild(cb);

  const label = document.createElement("span");
  label.className = "node-label";
  label.textContent = node.label;
  row.appendChild(label);

  if (node.detail) {
    const d = document.createElement("span");
    d.className = "node-detail";
    d.textContent = node.detail;
    row.appendChild(d);
  }
  if (node.note) {
    const w = document.createElement("span");
    w.className = "warn-badge";
    w.textContent = node.convertible ? "ⓘ" : "⚠";
    w.title = node.note;
    row.appendChild(w);
  }
  el.appendChild(row);

  let childBox: HTMLDivElement | null = null;
  if (isBranch) {
    childBox = document.createElement("div");
    childBox.className = "children";
    node.children!.forEach((c) => childBox!.appendChild(renderNode(c, depth + 1)));
    el.appendChild(childBox);
    twist.addEventListener("click", () => {
      childBox!.hidden = !childBox!.hidden;
      twist.textContent = childBox!.hidden ? "▶" : "▼";
    });
  }

  const sync = () => {
    if (isBranch) {
      const st = nodeState(node);
      cb.checked = st === "on";
      cb.indeterminate = st === "mixed";
    } else {
      cb.checked = selection.has(node.id);
    }
  };
  sync();

  cb.addEventListener("change", () => {
    if (isBranch) {
      setSubtree(node, cb.checked);
    } else if (cb.checked) {
      selection.add(node.id);
    } else {
      selection.delete(node.id);
    }
    renderTree();
    recompute();
  });

  return el;
}

function recompute(): void {
  if (!loaded) return;
  lastResult = convert(loaded, selection);
  renderReport(lastResult);
  const btn = document.querySelector<HTMLButtonElement>("#download");
  if (btn) btn.disabled = selection.size === 0;
}

function renderReport(result: ConversionResult): void {
  const host = must<HTMLDivElement>("#report");
  if (!result.report.length) {
    host.innerHTML = `<div class="empty">Nothing selected yet.</div>`;
    return;
  }
  const ico: Record<string, string> = { ok: "✓", info: "·", warn: "⚠", drop: "✕" };
  host.innerHTML = result.report
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
  const blob = new Blob([lastResult.text], { type: lastResult.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = lastResult.filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- utils -----------------------------------------------------------------

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
