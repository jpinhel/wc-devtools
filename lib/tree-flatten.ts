import type { WCNode } from '../types/wc';

export type FlatRowKind = 'node' | 'shadow-header' | 'hidden';

export interface FlatRow {
  /** Stable key for v-for (id for nodes, `${id}#shadow` for headers). */
  key: string;
  kind: FlatRowKind;
  /** The WCNode for `node`; the host node for `shadow-header` and `hidden`. */
  node: WCNode;
  depth: number;
  hasChildren: boolean;
  /** Only for kind 'hidden': number of WC dropped by the capacity cap. */
  hiddenCount?: number;
}

function nodeHasVisibleChildren(node: WCNode): boolean {
  if (node.children.length > 0) return true;
  if (Array.isArray(node.shadowRoot) && node.shadowRoot.length > 0) return true;
  return false;
}

export function flattenTree(roots: WCNode[], expanded: Set<string>): FlatRow[] {
  const out: FlatRow[] = [];
  function walk(node: WCNode, depth: number): void {
    out.push({
      key: node.id,
      kind: 'node',
      node,
      depth,
      hasChildren: nodeHasVisibleChildren(node),
    });
    if (!expanded.has(node.id)) return;
    if (Array.isArray(node.shadowRoot) && node.shadowRoot.length > 0) {
      out.push({
        key: `${node.id}#shadow`,
        kind: 'shadow-header',
        node,
        depth: depth + 1,
        hasChildren: false,
      });
      for (const child of node.shadowRoot) walk(child, depth + 1);
      if (node.droppedShadow) {
        out.push({
          key: `${node.id}#shadow-hidden`,
          kind: 'hidden',
          node,
          depth: depth + 1,
          hasChildren: false,
          hiddenCount: node.droppedShadow,
        });
      }
    }
    for (const child of node.children) walk(child, depth + 1);
    if (node.droppedChildren) {
      out.push({
        key: `${node.id}#hidden`,
        kind: 'hidden',
        node,
        depth: depth + 1,
        hasChildren: false,
        hiddenCount: node.droppedChildren,
      });
    }
  }
  for (const root of roots) walk(root, 0);
  return out;
}
