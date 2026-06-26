/**
 * Generic group-by roll-up tree — pure, UI-free.
 *
 * The same idea as the Aging Report's buildAgingTree, but generalised over an
 * arbitrary per-row metrics object so any report can offer the Aging-style
 * "Group by ⟨dimension⟩ → ⟨dimension⟩ → …" builder.
 *
 * Each input `Row` (e.g. a customer ledger) is grouped by an ordered list of
 * dimension keys into a nested tree. Every node carries the SUM of its rows'
 * metrics (`add` folds a row's metrics into the running node total), so parent
 * rows are true subtotals of their children. Leaf nodes are the buckets of the
 * last dimension; there is no per-row leaf unless a uniquely-keyed dimension
 * (e.g. "customer") is the final level — exactly like the Aging Report.
 */

export interface GroupNode<M> {
  /** Unique key within the whole tree (path of bucket values). */
  key: string;
  /** Display label for this node (e.g. the salesperson / customer / category). */
  label: string;
  /** Optional secondary label (e.g. "ACME · Mumbai" for a single ledger). */
  sub?: string;
  /** 0 for top-level rows, +1 per nesting level. */
  depth: number;
  /** Dimension path from root to this node. */
  path: { dim: string; value: string }[];
  /** Summed metrics for every row under this node. */
  metrics: M;
  /** Distinct backing row ids (for drill-down). */
  ids: string[];
  children: GroupNode<M>[];
}

export interface GroupTreeOptions<Row, M> {
  /** Bucket value + display label (+ optional sub-label) for a row on a dimension. */
  dimValue: (row: Row, dim: string) => { value: string; label: string; sub?: string };
  /** Stable id of a row (deduped into each node's `ids`). */
  idOf: (row: Row) => string;
  /** Per-row metrics to fold into its node totals. */
  metricsOf: (row: Row) => M;
  /** A fresh zero metrics accumulator. */
  empty: () => M;
  /** Fold a row's metrics into an accumulator (mutates `acc`). */
  add: (acc: M, m: M) => void;
  /** Optional comparator to order sibling nodes (applied at every level). */
  sort?: (a: GroupNode<M>, b: GroupNode<M>) => number;
}

export interface GroupTree<M> {
  roots: GroupNode<M>[];
  total: M;
  totalIds: string[];
}

export function buildGroupTree<Row, M>(
  rows: Row[],
  dims: string[],
  opts: GroupTreeOptions<Row, M>,
): GroupTree<M> {
  const total = opts.empty();
  const totalIds = new Set<string>();
  for (const r of rows) {
    opts.add(total, opts.metricsOf(r));
    totalIds.add(opts.idOf(r));
  }

  const effDims = dims.length > 0 ? dims : [];
  const roots = group(rows, effDims, 0, "", [], opts);
  return { roots, total, totalIds: [...totalIds] };
}

function group<Row, M>(
  rows: Row[],
  dims: string[],
  depth: number,
  prefix: string,
  parentPath: { dim: string; value: string }[],
  opts: GroupTreeOptions<Row, M>,
): GroupNode<M>[] {
  if (dims.length === 0) return [];
  const dim = dims[0];
  const rest = dims.slice(1);

  // Preserve first-seen order; sort comparator (if any) reorders at the end.
  const order: string[] = [];
  const buckets = new Map<string, { rows: Row[]; label: string; sub?: string }>();
  for (const r of rows) {
    const { value, label, sub } = opts.dimValue(r, dim);
    let b = buckets.get(value);
    if (!b) { b = { rows: [], label, sub }; buckets.set(value, b); order.push(value); }
    b.rows.push(r);
  }

  const nodes: GroupNode<M>[] = [];
  for (const value of order) {
    const b = buckets.get(value)!;
    const metrics = opts.empty();
    const ids = new Set<string>();
    for (const r of b.rows) {
      opts.add(metrics, opts.metricsOf(r));
      ids.add(opts.idOf(r));
    }
    const key = `${prefix}/${dim}:${value}`;
    const path = [...parentPath, { dim, value }];
    nodes.push({
      key,
      label: b.label,
      sub: b.sub,
      depth,
      path,
      metrics,
      ids: [...ids],
      children: group(b.rows, rest, depth + 1, key, path, opts),
    });
  }

  if (opts.sort) nodes.sort(opts.sort);
  return nodes;
}

/** Recursively re-sort an existing tree's nodes with a fresh comparator. */
export function sortTree<M>(
  nodes: GroupNode<M>[],
  cmp: (a: GroupNode<M>, b: GroupNode<M>) => number,
): GroupNode<M>[] {
  return [...nodes]
    .sort(cmp)
    .map((n) => (n.children.length ? { ...n, children: sortTree(n.children, cmp) } : n));
}
