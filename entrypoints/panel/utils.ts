import type { WCFramework, WCNode } from '../../types/wc';

/** Concatenates per-frame trees into one list, top frame (frameId 0) first. */
export function mergeFrameTrees(frames: Map<number, WCNode[]>): WCNode[] {
  return [...frames.entries()].sort(([a], [b]) => a - b).flatMap(([, tree]) => tree);
}

/** Union of per-frame registries, sorted. */
export function mergeFrameRegistries(frames: Map<number, string[]>): string[] {
  const names = new Set<string>();
  for (const registry of frames.values()) {
    for (const name of registry) names.add(name);
  }
  return [...names].sort();
}

export function findNode(nodes: WCNode[], id: string): WCNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const inChildren = findNode(node.children, id);
    if (inChildren) return inChildren;
    if (Array.isArray(node.shadowRoot)) {
      const inShadow = findNode(node.shadowRoot as WCNode[], id);
      if (inShadow) return inShadow;
    }
  }
  return undefined;
}

export function countNodes(nodes: WCNode[]): number {
  let n = 0;
  const stack = [...nodes];
  while (stack.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length guard ensures pop() is defined
    const node = stack.pop()!;
    n++;
    if (Array.isArray(node.children)) stack.push(...node.children);
    if (Array.isArray(node.shadowRoot)) stack.push(...(node.shadowRoot as WCNode[]));
  }
  return n;
}

// Only Lit detection is reliable enough to display. Stencil/FAST/vanilla
// markers are too fragile across build modes — return null so callers
// skip the badge entirely instead of guessing wrong.
export function fwBadge(fw: WCNode['framework']): { label: string; cls: string } | null {
  if (fw === 'lit') return { label: 'Lit', cls: 'fw-lit' };
  return null;
}

/** Returns the path from the tree root to the node with the given id, or [] if not found. */
export function pathToNode(tree: WCNode[], id: string): WCNode[] {
  for (const root of tree) {
    const path = pathFrom(root, id, []);
    if (path) return path;
  }
  return [];
}

function pathFrom(node: WCNode, id: string, acc: WCNode[]): WCNode[] | null {
  const next = [...acc, node];
  if (node.id === id) return next;
  for (const child of node.children) {
    const result = pathFrom(child, id, next);
    if (result) return result;
  }
  if (Array.isArray(node.shadowRoot)) {
    for (const child of node.shadowRoot) {
      const result = pathFrom(child, id, next);
      if (result) return result;
    }
  }
  return null;
}

export interface SearchQuery {
  text: string; // raw text or regex source
  isRegex: boolean;
  framework: 'all' | WCFramework;
}

/**
 * Returns a new tree containing only nodes that match the query, plus their ancestors.
 * Empty query (text === '' && framework === 'all') returns the tree as-is.
 */
export function pruneTree(tree: WCNode[], query: SearchQuery): WCNode[] {
  const isEmpty = !query.text && query.framework === 'all';
  if (isEmpty) return tree;

  let textMatcher: (s: string) => boolean;
  if (query.isRegex) {
    try {
      const re = new RegExp(query.text, 'i');
      textMatcher = (s) => re.test(s);
    } catch {
      // Invalid regex — fall back to literal match so the user sees something.
      textMatcher = (s) => s.toLowerCase().includes(query.text.toLowerCase());
    }
  } else {
    const needle = query.text.toLowerCase();
    textMatcher = (s) => needle === '' || s.toLowerCase().includes(needle);
  }

  function matches(node: WCNode): boolean {
    if (query.framework !== 'all' && node.framework !== query.framework) return false;
    if (!textMatcher(node.tagName)) return false;
    return true;
  }

  function walk(node: WCNode): WCNode | null {
    const childMatches = node.children.map(walk).filter((n): n is WCNode => n !== null);
    const shadowMatches = Array.isArray(node.shadowRoot)
      ? node.shadowRoot.map(walk).filter((n): n is WCNode => n !== null)
      : node.shadowRoot;
    const selfMatches = matches(node);
    const hasMatchingDescendant =
      childMatches.length > 0 || (Array.isArray(shadowMatches) && shadowMatches.length > 0);
    if (!selfMatches && !hasMatchingDescendant) return null;
    return {
      ...node,
      children: childMatches,
      shadowRoot: shadowMatches,
    };
  }

  return tree.map(walk).filter((n): n is WCNode => n !== null);
}
