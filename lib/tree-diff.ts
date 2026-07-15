import type { TreeLocation, TreePatch, WCNode } from '../types/wc';

interface NodeIndex {
  node: WCNode;
  parentId: string | null;
  location: TreeLocation;
  index: number;
}

function indexTree(roots: WCNode[]): Map<string, NodeIndex> {
  const out = new Map<string, NodeIndex>();
  function walk(nodes: WCNode[], parentId: string | null, location: TreeLocation): void {
    nodes.forEach((node, index) => {
      out.set(node.id, { node, parentId, location, index });
      walk(node.children, node.id, 'children');
      if (Array.isArray(node.shadowRoot)) walk(node.shadowRoot, node.id, 'shadow');
    });
  }
  walk(roots, null, 'root');
  return out;
}

const STRUCTURAL_FIELDS = new Set(['id', 'children', 'shadowRoot']);
const SCALAR_FIELDS: (keyof WCNode)[] = [
  'tagName',
  'depth',
  'framework',
  'attributes',
  'properties',
  'methods',
  'slots',
  'parts',
  'adoptedStyles',
  'cssVars',
  'customStates',
  'ariaRefs',
  'propMeta',
  // Stable per tag, but appears late when an element upgrades after injection
  'sourceRef',
  'droppedChildren',
  'droppedShadow',
];

function nodeFieldDiff(prev: WCNode, curr: WCNode): Partial<WCNode> | null {
  const changed: Partial<WCNode> = {};
  let any = false;
  for (const k of SCALAR_FIELDS) {
    if (STRUCTURAL_FIELDS.has(k as string)) continue;
    if (JSON.stringify(prev[k]) !== JSON.stringify(curr[k])) {
      (changed as Record<string, unknown>)[k] = curr[k];
      any = true;
    }
  }
  return any ? changed : null;
}

function shadowDiffersStructurally(
  prev: WCNode['shadowRoot'],
  curr: WCNode['shadowRoot'],
): boolean {
  if (prev === curr) return false;
  if (Array.isArray(prev) && Array.isArray(curr)) return false; // children handled separately
  return true;
}

/**
 * Collect ids that will be implicitly removed by a `set-shadow` patch — i.e.
 * descendants under a shadow that flips from an array to null/'closed'.
 * These should NOT also emit explicit `remove` patches.
 */
function collectImplicitRemoves(prev: WCNode[], curr: WCNode[]): Set<string> {
  const out = new Set<string>();
  const currMap = new Map<string, WCNode>();
  function indexCurr(nodes: WCNode[]): void {
    for (const node of nodes) {
      currMap.set(node.id, node);
      indexCurr(node.children);
      if (Array.isArray(node.shadowRoot)) indexCurr(node.shadowRoot);
    }
  }
  indexCurr(curr);

  function collectIds(nodes: WCNode[], into: Set<string>): void {
    for (const node of nodes) {
      into.add(node.id);
      collectIds(node.children, into);
      if (Array.isArray(node.shadowRoot)) collectIds(node.shadowRoot, into);
    }
  }

  function walk(nodes: WCNode[]): void {
    for (const prevNode of nodes) {
      const currNode = currMap.get(prevNode.id);
      if (currNode && Array.isArray(prevNode.shadowRoot) && !Array.isArray(currNode.shadowRoot)) {
        // The whole shadow subtree disappears via set-shadow — descendants implicit.
        collectIds(prevNode.shadowRoot, out);
      }
      walk(prevNode.children);
      if (Array.isArray(prevNode.shadowRoot)) walk(prevNode.shadowRoot);
    }
  }
  walk(prev);
  return out;
}

export function diffTree(prev: WCNode[], curr: WCNode[]): TreePatch[] {
  const prevIdx = indexTree(prev);
  const currIdx = indexTree(curr);
  const patches: TreePatch[] = [];
  const implicit = collectImplicitRemoves(prev, curr);

  // Removes — gone from curr OR moved to a different parent/location.
  // Skip ids that will be implicitly cleared by a set-shadow patch.
  for (const [id, before] of prevIdx) {
    if (implicit.has(id)) continue;
    const after = currIdx.get(id);
    if (!after || after.parentId !== before.parentId || after.location !== before.location) {
      patches.push({ op: 'remove', id });
    }
  }

  // Adds + updates — walk curr in order so adds carry stable indexes.
  function walk(nodes: WCNode[], parentId: string | null, location: TreeLocation): void {
    nodes.forEach((node, index) => {
      const before = prevIdx.get(node.id);
      const moved = before && (before.parentId !== parentId || before.location !== location);
      if (!before || moved) {
        // Re-add full subtree. Skip recursion — the patch carries the subtree.
        patches.push({ op: 'add', parentId, location, index, node });
        return;
      }
      const fields = nodeFieldDiff(before.node, node);
      if (fields) patches.push({ op: 'update', id: node.id, fields });
      if (shadowDiffersStructurally(before.node.shadowRoot, node.shadowRoot)) {
        patches.push({ op: 'set-shadow', id: node.id, shadowRoot: node.shadowRoot });
      }
      walk(node.children, node.id, 'children');
      if (Array.isArray(node.shadowRoot)) walk(node.shadowRoot, node.id, 'shadow');
    });
  }
  walk(curr, null, 'root');

  return patches;
}

function cloneTree(roots: WCNode[]): WCNode[] {
  return roots.map((node) => ({
    ...node,
    children: cloneTree(node.children),
    shadowRoot: Array.isArray(node.shadowRoot) ? cloneTree(node.shadowRoot) : node.shadowRoot,
  }));
}

function findParentArray(
  roots: WCNode[],
  parentId: string | null,
  location: TreeLocation,
): WCNode[] | null {
  if (parentId === null) return roots;
  const stack: WCNode[] = [...roots];
  while (stack.length) {
    // biome-ignore lint/style/noNonNullAssertion: length-checked
    const node = stack.pop()!;
    if (node.id === parentId) {
      if (location === 'children') return node.children;
      if (location === 'shadow') {
        if (!Array.isArray(node.shadowRoot)) node.shadowRoot = [];
        return node.shadowRoot;
      }
      return null;
    }
    stack.push(...node.children);
    if (Array.isArray(node.shadowRoot)) stack.push(...node.shadowRoot);
  }
  return null;
}

function findNodeRef(roots: WCNode[], id: string): WCNode | null {
  const stack = [...roots];
  while (stack.length) {
    // biome-ignore lint/style/noNonNullAssertion: length-checked
    const node = stack.pop()!;
    if (node.id === id) return node;
    stack.push(...node.children);
    if (Array.isArray(node.shadowRoot)) stack.push(...node.shadowRoot);
  }
  return null;
}

function removeFromTree(roots: WCNode[], id: string): WCNode[] {
  return roots.filter((root) => {
    if (root.id === id) return false;
    root.children = removeFromTree(root.children, id);
    if (Array.isArray(root.shadowRoot)) {
      root.shadowRoot = removeFromTree(root.shadowRoot, id);
    }
    return true;
  });
}

export function applyPatches(prev: WCNode[], patches: TreePatch[]): WCNode[] {
  if (patches.length === 0) return prev;
  let next = cloneTree(prev);
  for (const patch of patches) {
    if (patch.op === 'remove') {
      next = removeFromTree(next, patch.id);
    } else if (patch.op === 'add') {
      const arr = findParentArray(next, patch.parentId, patch.location);
      if (!arr) continue;
      arr.splice(patch.index, 0, patch.node);
    } else if (patch.op === 'update') {
      const node = findNodeRef(next, patch.id);
      if (node) Object.assign(node, patch.fields);
    } else if (patch.op === 'set-shadow') {
      const node = findNodeRef(next, patch.id);
      if (node) node.shadowRoot = patch.shadowRoot;
    }
  }
  return next;
}
