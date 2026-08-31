import type { Platform, ShowModel } from "../model/showModel";

/**
 * The inventory is the selectable tree shown in the UI. Every node has a stable
 * `id` (dotted path). Leaves and branches both carry a checkbox; a branch's
 * state is derived from its descendants.
 */
export interface InventoryNode {
  id: string;
  label: string;
  /** Extra detail shown dimmed after the label (source name, model, count). */
  detail?: string;
  /** Convertible cleanly? `false` => shown with a warning, unticked by default. */
  convertible: boolean;
  /** Why it can't convert cleanly, or a caveat if it can. */
  note?: string;
  /** Default ticked state (only meaningful for leaves). */
  defaultOn: boolean;
  children?: InventoryNode[];
}

export interface Inventory {
  source: Platform;
  target: Platform;
  kind: ShowModel["kind"];
  root: InventoryNode[];
}

/** Set of leaf node ids the user wants converted. */
export type Selection = Set<string>;

export type ReportSeverity = "ok" | "info" | "warn" | "drop";

export interface ReportEntry {
  severity: ReportSeverity;
  scope: string; // node id / area
  message: string;
}

export interface ConversionResult {
  filename: string;
  text: string;
  mime: string;
  report: ReportEntry[];
}

export function selectAllDefault(inv: Inventory): Selection {
  const sel: Selection = new Set();
  const walk = (n: InventoryNode) => {
    if (n.children?.length) n.children.forEach(walk);
    else if (n.defaultOn) sel.add(n.id);
  };
  inv.root.forEach(walk);
  return sel;
}
