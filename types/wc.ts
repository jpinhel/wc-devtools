/**
 * Core types for the Web Components DevTools extension.
 *
 * ASCII — Message flow across contexts:
 *
 *   PAGE CONTEXT (world: MAIN)
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  wc-inspector.ts                                                 │
 *   │  buildWCTree() ──▶ WCNode[]                                      │
 *   │  window.postMessage({ type: 'tree-snapshot' | 'tree-patches' }) ▶│
 *   └──────────────────────────────────────────────────────────────────┘
 *         PageMessage (postMessage)
 *   CONTENT SCRIPT (isolated world)
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  content.ts                                                      │
 *   │  window.addEventListener('message') ◀────────────────────────── │
 *   │  chrome.runtime.sendMessage(ExtensionMessage) ──────────────▶   │
 *   └──────────────────────────────────────────────────────────────────┘
 *         ExtensionMessage (chrome runtime)
 *   BACKGROUND SERVICE WORKER
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  background.ts                                                   │
 *   │  port.postMessage(ExtensionMessage) ──────────────────────────▶ │
 *   └──────────────────────────────────────────────────────────────────┘
 *         ExtensionMessage (chrome port)
 *   DEVTOOLS PANEL
 */

// ─── Serializable values ───────────────────────────────────────────────────────

/**
 * A value that can be safely passed through postMessage / JSON serialization.
 * Used for WC property values in the inspector.
 */
export type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue };

// ─── WC Node ──────────────────────────────────────────────────────────────────

/** Heuristic framework detection for a custom element. */
export type WCFramework = 'lit' | 'fast' | 'stencil' | 'vanilla';

/** A slot inside the host's shadow root and the nodes assigned to it. */
export interface SlotInfo {
  /** Empty string for default slot, otherwise the slot name. */
  name: string;
  /** Tag name of each assigned node. */
  assignedNodes: string[];
  /** Tag names of the fallback content (used when no nodes are assigned). */
  fallbackNodes: string[];
  /** Number of CSS rules in the document or shadow root that match `::slotted(...)` for this slot. */
  slottedRuleCount: number;
}

/** A `part="..."` attribute exposed inside the host's shadow tree. */
export interface PartInfo {
  /** The part name (one entry per name even when the same name appears on several elements). */
  name: string;
  /** Tag name of the element inside the shadow tree that carries the part="..." attribute. */
  elementTag: string;
  /** Number of CSS rules in any stylesheet that match `::part(name)` for this part. */
  ruleCount: number;
}

/** A constructible CSSStyleSheet adopted by a shadow root or the document. */
export interface AdoptedStyleSheetInfo {
  /** Truncated text of the stylesheet (max 500 chars). */
  cssText: string;
  /** Number of rules in the sheet. */
  ruleCount: number;
}

/** A CSS custom property either declared on the host or inherited at the host. */
export interface CssVarInfo {
  /** The CSS variable name (always starts with `--`). */
  name: string;
  /** Computed value at the host. */
  computedValue: string;
  /** True when the variable is declared on the host's own inline style or :host rule, false when only inherited. */
  declaredOnHost: boolean;
}

/** An ARIA idref relationship from a source element to a target. */
export interface AriaRefInfo {
  /** Attribute name driving the relationship (e.g. 'aria-controls'). */
  attribute: string;
  /** Target id values referenced by the attribute (space-separated in the original attribute value). */
  ids: string[];
  /**
   * Heuristic flag — true when at least one target id resolves to a different root than the source.
   * Best-effort: includes browser-resolved cases (e.g. light-DOM source pointing into the source's
   * own shadow root) that the ARIA spec does not formally cover.
   */
  crossRoot: boolean;
}

/**
 * Metadata describing the reactive nature and reflection behavior of a named property.
 * Phase 2A — used by the panel to badge state vs prop in the Properties tab.
 *
 * Keys in `WCNode.propMeta` mirror the keys in `WCNode.properties` (JS property names,
 * not attribute names). For vanilla custom elements where only `observedAttributes`
 * exists, the JS property name is the attribute name verbatim (no camelCase conversion).
 */
export interface WCPropMeta {
  /**
   * - 'state'     → declared as Lit `@state` (state: true) or Stencil `@State`
   * - 'prop'      → public reactive property (Lit `@property`, Stencil `@Prop`)
   * - 'attribute' → derived from `observedAttributes` only (vanilla);
   *                 the attribute is the primary surface, and `reflects` is always `true`
   */
  kind: 'state' | 'prop' | 'attribute';
  /**
   * True when the JS property reflects to an HTML attribute (Lit `reflect: true`,
   * Stencil `@Prop({reflect: true})`).
   *
   * Invariant: always `true` when `kind === 'attribute'` (the attribute IS the
   * observable surface, so reflection is trivially in place).
   */
  reflects: boolean;
}

// ─── Lit Labs (signals / context / task) ──────────────────────────────────────

/** A Lit Labs `@lit-labs/signals` signal value attached to an element. */
export interface WCSignalInfo {
  /** Best-effort label: signal's host property name. */
  label: string;
  /** Current value, serialized. */
  value: SerializableValue;
  /** Number of subscribers reading this signal — best-effort. */
  subscriberCount?: number;
}

/** A `@lit/context` request observed via the dispatchEvent patch. */
export interface WCContextInfo {
  /** Context key — string when human-readable, otherwise a placeholder. */
  key: string;
  /** Tag of the ancestor element that supplied the value, when known. */
  providerTag?: string;
  /** Last received value, serialized. */
  value?: SerializableValue;
}

/** Lit `@lit/task` lifecycle states. */
export type TaskStatus = 'initial' | 'pending' | 'complete' | 'error';

/** A `@lit/task` instance attached to an element. */
export interface WCTaskInfo {
  /** Property name on the element that holds the task instance. */
  label: string;
  status: TaskStatus;
  /** Resolved value when status === 'complete'. */
  value?: SerializableValue;
  /** Error message when status === 'error'. */
  error?: string;
}

// ─── Custom Elements Manifest (CEM) ───────────────────────────────────────────

export interface CemAttribute {
  name: string;
  type?: string;
  default?: string;
  description?: string;
  fieldName?: string;
}

export interface CemEvent {
  name: string;
  type?: string;
  description?: string;
}

export interface CemSlot {
  name?: string;
  description?: string;
}

export interface CemCssPart {
  name: string;
  description?: string;
}

export interface CemCssProp {
  name: string;
  description?: string;
  default?: string;
}

export interface CemElement {
  tagName: string;
  description?: string;
  attributes?: CemAttribute[];
  events?: CemEvent[];
  slots?: CemSlot[];
  cssParts?: CemCssPart[];
  cssProperties?: CemCssProp[];
}

/** Index of CemElement keyed by tag name. */
export type CemIndex = Map<string, CemElement>;

// ─── Stencil hydration ────────────────────────────────────────────────────────

export type StencilHydrationState = 'ssr-only' | 'hydrated' | 'unknown';

// ─── Click-to-source ──────────────────────────────────────────────────────────

/**
 * Where a component class was registered — captured from the stack trace at
 * `customElements.define` time. 1-based line/column (stack trace convention);
 * the Sources panel applies source maps when opened via openResource.
 */
export interface SourceRef {
  url: string;
  line: number;
  column: number;
}

/**
 * A serialized Web Component node in the inspection tree.
 *
 * ASCII — tree structure:
 *
 *   WCNode (depth=0, tagName="my-app")
 *   ├── children[]           ← WC elements in light DOM
 *   │   └── WCNode (depth=1, tagName="my-button")
 *   └── shadowRoot[]         ← WC elements inside shadow DOM
 *       └── WCNode (depth=1, tagName="my-icon")
 *       | null               ← element has no shadow root
 *       | 'closed'           ← shadow root exists but is inaccessible
 */
export interface WCNode {
  /** Stable identifier assigned by wcInspector and stored in a WeakMap. */
  id: string;
  tagName: string;
  /** All HTML attributes (always accessible from outside). */
  attributes: Record<string, string>;
  /**
   * Serialized JS properties: observedAttributes union own prototype chain props
   * (filtered against the native HTMLElement/Element/Node/EventTarget prototype keys).
   */
  properties: Record<string, SerializableValue>;
  /** WC children inside this element's shadow DOM (null = none, 'closed' = inaccessible). */
  shadowRoot: WCNode[] | null | 'closed';
  /** WC descendants in this element's light DOM. */
  children: WCNode[];
  /** Depth from document root (0 = top-level WC). */
  depth: number;
  /** Heuristically detected framework. */
  framework: WCFramework;
  /** User-defined methods on the prototype chain (lifecycle methods excluded). */
  methods: string[];
  /** Named + default slots and their assigned nodes (Phase 1 — Slots tab). */
  slots?: SlotInfo[];
  /** part="..." attributes exposed inside the host's shadow tree (Phase 1 — Styles tab). */
  parts?: PartInfo[];
  /** Constructible CSSStyleSheets adopted by the host's shadow root (Phase 1 — Styles tab). */
  adoptedStyles?: AdoptedStyleSheetInfo[];
  /** CSS custom properties declared by or inherited on the host (Phase 1 — Styles tab). */
  cssVars?: CssVarInfo[];
  /** Active states from ElementInternals.states (Phase 1 — header chips + toggle). */
  customStates?: string[];
  /** ARIA idref relationships, including cross-root ones (Phase 1 — A11y tab). */
  ariaRefs?: AriaRefInfo[];
  /** Per-property metadata (Phase 2A — Properties tab state/prop badges). */
  propMeta?: Record<string, WCPropMeta>;
  /** Framework version string (Phase 3 — e.g., "3.3.2" for Lit 3, "2.x" for Lit 2). */
  frameworkVersion?: string;
  /** Lit Labs signals attached to this element (Phase 3). */
  signals?: WCSignalInfo[];
  /** `@lit/context` requests captured from this element (Phase 3). */
  contextRequests?: WCContextInfo[];
  /** Lit `@lit/task` instances attached to this element (Phase 3). */
  tasks?: WCTaskInfo[];
  /** Stencil hydration state — only set when framework === 'stencil' (Phase 3). */
  stencilHydration?: StencilHydrationState;
  /** Registration site captured at customElements.define — absent for pre-injection defines. */
  sourceRef?: SourceRef;
  /** WC excluded from `children` by the per-region capacity cap ("+N hidden"). */
  droppedChildren?: number;
  /** WC excluded from `shadowRoot` by the per-region capacity cap. */
  droppedShadow?: number;
}

// ─── Tree diff patches ────────────────────────────────────────────────────────

/** Where in a parent the node lives. */
export type TreeLocation = 'root' | 'children' | 'shadow';

/** A single mutation to apply to a tree on the panel side. */
export type TreePatch =
  | {
      op: 'add';
      /** Parent id, or null for tree roots. */
      parentId: string | null;
      location: TreeLocation;
      /** 0-based insertion index inside the parent's array. */
      index: number;
      /** Full subtree being added. */
      node: WCNode;
    }
  | {
      op: 'remove';
      id: string;
    }
  | {
      op: 'update';
      id: string;
      /** Only includes fields whose value changed. */
      fields: Partial<Omit<WCNode, 'id' | 'children' | 'shadowRoot'>>;
    }
  | {
      op: 'set-shadow';
      id: string;
      /** Same shape as `WCNode.shadowRoot`. Used when shadow becomes available/closed/null. */
      shadowRoot: WCNode[] | null | 'closed';
    };

/** A CustomEvent dispatched by a WC element, captured live by the inspector. */
export interface EventLogEntry {
  nodeId: string;
  eventType: string;
  detail: SerializableValue;
  bubbles: boolean;
  timestamp: number;
}

// ─── Message protocol ─────────────────────────────────────────────────────────

export const MESSAGE_VERSION = 2 as const;

/** Result message sent back after a set-prop command. */
export interface SetPropResultMessage {
  source: 'wc-devtools-injected';
  version: typeof MESSAGE_VERSION;
  type: 'set-prop-result';
  nodeId: string;
  propName: string;
  success: boolean;
  error?: string;
}

/** A CustomEvent dispatched from a tracked WC element. */
export interface EventLogMessage {
  source: 'wc-devtools-injected';
  version: typeof MESSAGE_VERSION;
  type: 'event-log';
  nodeId: string;
  eventType: string;
  detail: SerializableValue;
  bubbles: boolean;
  timestamp: number;
}

export type PageOutboundMessage =
  | SetPropResultMessage
  | EventLogMessage
  | {
      source: 'wc-devtools-injected';
      version: typeof MESSAGE_VERSION;
      type: 'pick-result';
      nodeId: string;
    }
  | {
      source: 'wc-devtools-injected';
      version: typeof MESSAGE_VERSION;
      type: 'tree-snapshot';
      tree: WCNode[];
      registry: string[];
      /** WC dropped from the root region by the capacity cap ("+N hidden"). */
      truncated?: number;
    }
  | {
      source: 'wc-devtools-injected';
      version: typeof MESSAGE_VERSION;
      type: 'tree-patches';
      patches: TreePatch[];
      registry: string[];
      truncated?: number;
    }
  | {
      source: 'wc-devtools-injected';
      version: typeof MESSAGE_VERSION;
      type: 'set-state-result';
      nodeId: string;
      state: string;
      enabled: boolean;
      success: boolean;
      error?: string;
    }
  | {
      source: 'wc-devtools-injected';
      version: typeof MESSAGE_VERSION;
      type: 'set-attr-result';
      nodeId: string;
      attrName: string;
      success: boolean;
      error?: string;
    }
  | {
      source: 'wc-devtools-injected';
      version: typeof MESSAGE_VERSION;
      type: 'invoke-method-result';
      nodeId: string;
      methodName: string;
      success: boolean;
      result?: SerializableValue;
      error?: string;
    }
  | {
      source: 'wc-devtools-injected';
      version: typeof MESSAGE_VERSION;
      type: 'cem-loaded';
      cem: unknown;
    };

/** Commands sent from content script to wcInspector via postMessage. */
export type PageCommandMessage =
  | { source: 'wc-devtools-command'; type: 'highlight-node'; nodeId: string | null }
  | {
      source: 'wc-devtools-command';
      type: 'set-prop';
      nodeId: string;
      propName: string;
      value: SerializableValue;
    }
  | { source: 'wc-devtools-command'; type: 'refresh' }
  | { source: 'wc-devtools-command'; type: 'enter-pick-mode' }
  | { source: 'wc-devtools-command'; type: 'exit-pick-mode' }
  | { source: 'wc-devtools-command'; type: 'scroll-into-view'; nodeId: string }
  | {
      source: 'wc-devtools-command';
      type: 'toggle-state';
      nodeId: string;
      state: string;
      enabled: boolean;
    }
  | {
      source: 'wc-devtools-command';
      type: 'set-attr';
      nodeId: string;
      attrName: string;
      value: string;
    }
  | {
      source: 'wc-devtools-command';
      type: 'remove-attr';
      nodeId: string;
      attrName: string;
    }
  | {
      source: 'wc-devtools-command';
      type: 'set-css-var';
      nodeId: string;
      name: string;
      /** null clears the inline override (style.removeProperty). */
      value: string | null;
    }
  | { source: 'wc-devtools-command'; type: 'trace-updates'; enabled: boolean }
  | {
      source: 'wc-devtools-command';
      type: 'invoke-method';
      nodeId: string;
      methodName: string;
      args: SerializableValue[];
    }
  | {
      source: 'wc-devtools-command';
      type: 'dispatch-event';
      nodeId: string;
      eventType: string;
      detail: SerializableValue;
    };

/**
 * Messages travelling through the extension bus
 * (content ↔ background ↔ devtools panel).
 */
export type ExtensionMessage =
  // Content ↔ Background ↔ Panel: data flow
  // frameId/frameUrl are stamped by the background from the message sender —
  // 0 / absent means the top frame; the panel keeps one tree per frame.
  | {
      version: typeof MESSAGE_VERSION;
      type: 'tree-snapshot';
      tree: WCNode[];
      registry: string[];
      frameId?: number;
      frameUrl?: string;
      /** WC dropped from the root region by the capacity cap ("+N hidden"). */
      truncated?: number;
    }
  | {
      version: typeof MESSAGE_VERSION;
      type: 'tree-patches';
      patches: TreePatch[];
      registry: string[];
      frameId?: number;
      frameUrl?: string;
      truncated?: number;
    }
  | {
      version: typeof MESSAGE_VERSION;
      type: 'set-prop-result';
      nodeId: string;
      propName: string;
      success: boolean;
      error?: string;
    }
  // Panel → Background: connection handshake
  | { version: typeof MESSAGE_VERSION; type: 'devtools-init'; tabId: number }
  // Panel → Background → Content → Inspector: commands
  | { version: typeof MESSAGE_VERSION; type: 'highlight-node'; nodeId: string | null }
  | {
      version: typeof MESSAGE_VERSION;
      type: 'set-prop';
      nodeId: string;
      propName: string;
      value: SerializableValue;
    }
  | { version: typeof MESSAGE_VERSION; type: 'refresh-request' }
  // Panel → Background → Content → Inspector: state toggle
  | {
      version: typeof MESSAGE_VERSION;
      type: 'toggle-state';
      nodeId: string;
      state: string;
      enabled: boolean;
    }
  | {
      version: typeof MESSAGE_VERSION;
      type: 'set-state-result';
      nodeId: string;
      state: string;
      enabled: boolean;
      success: boolean;
      error?: string;
    }
  // Panel → Background → Content: pick mode commands
  | { version: typeof MESSAGE_VERSION; type: 'enter-pick-mode' }
  | { version: typeof MESSAGE_VERSION; type: 'exit-pick-mode' }
  | { version: typeof MESSAGE_VERSION; type: 'scroll-into-view'; nodeId: string }
  // Inspector → Panel: element picked
  | { version: typeof MESSAGE_VERSION; type: 'pick-result'; nodeId: string }
  // Background → Panel: events
  | { version: typeof MESSAGE_VERSION; type: 'tab-navigated' }
  | { version: typeof MESSAGE_VERSION; type: 'injection-failed'; error: string }
  // Inspector → Panel: live event capture
  | {
      version: typeof MESSAGE_VERSION;
      type: 'event-log';
      nodeId: string;
      eventType: string;
      detail: SerializableValue;
      bubbles: boolean;
      timestamp: number;
    }
  // Content → Background: lifecycle
  | { version: typeof MESSAGE_VERSION; type: 'content-ready' }
  // Panel → Background: keepalive to prevent SW sleep
  | { version: typeof MESSAGE_VERSION; type: 'keepalive' }
  // Popup → Background: query current tab state
  | { version: typeof MESSAGE_VERSION; type: 'popup-query'; tabId: number }
  // Background → Popup: current tab state
  | {
      version: typeof MESSAGE_VERSION;
      type: 'popup-state';
      count: number;
      registry: string[];
      frameworks: Record<string, number>;
    }
  // Panel → Background → Content → Inspector: attribute commands
  | {
      version: typeof MESSAGE_VERSION;
      type: 'set-attr';
      nodeId: string;
      attrName: string;
      value: string;
    }
  | {
      version: typeof MESSAGE_VERSION;
      type: 'remove-attr';
      nodeId: string;
      attrName: string;
    }
  | {
      version: typeof MESSAGE_VERSION;
      type: 'set-attr-result';
      nodeId: string;
      attrName: string;
      success: boolean;
      error?: string;
    }
  // Panel → Background → Content → Inspector: tooling commands
  | {
      version: typeof MESSAGE_VERSION;
      type: 'set-css-var';
      nodeId: string;
      name: string;
      value: string | null;
    }
  | { version: typeof MESSAGE_VERSION; type: 'trace-updates'; enabled: boolean }
  | {
      version: typeof MESSAGE_VERSION;
      type: 'invoke-method';
      nodeId: string;
      methodName: string;
      args: SerializableValue[];
    }
  | {
      version: typeof MESSAGE_VERSION;
      type: 'invoke-method-result';
      nodeId: string;
      methodName: string;
      success: boolean;
      result?: SerializableValue;
      error?: string;
    }
  | {
      version: typeof MESSAGE_VERSION;
      type: 'dispatch-event';
      nodeId: string;
      eventType: string;
      detail: SerializableValue;
    }
  // Inspector → Panel: custom-elements.json fetched from page origin
  | { version: typeof MESSAGE_VERSION; type: 'cem-loaded'; cem: unknown };
