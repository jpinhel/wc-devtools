import { html, LitElement, nothing, type PropertyValues } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { parseCem } from '../../lib/cem-loader';
import { createProfilingState, type ProfilingState, recordPatches } from '../../lib/profiling';
import { diffNodeProps, type PropChange } from '../../lib/render-diff';
import { applyPatches } from '../../lib/tree-diff';
import {
  type CemIndex,
  type EventLogEntry,
  type ExtensionMessage,
  MESSAGE_VERSION,
  type SerializableValue,
  type SourceRef,
  type WCNode,
} from '../../types/wc';
import './components/wc-inspector';
import './components/wc-profiling-panel';
import './components/wc-registry';
import './components/wc-tree-virtual';
import type { WcTreeVirtual } from './components/wc-tree-virtual';
import { BaselineController } from './controllers/baseline-controller';
import { icon } from './icons';
import {
  countNodes,
  findNode,
  mergeFrameRegistries,
  mergeFrameTrees,
  pathToNode,
  pruneTree,
  type SearchQuery,
} from './utils';

type Theme = 'system' | 'dark' | 'light';
type Status = 'connecting' | 'active' | 'navigating' | 'injection-failed' | 'error';
type LeftTab = 'tree' | 'registry' | 'profiling';

const THEME_KEY = 'wc-devtools-theme';

@customElement('wc-devtools-app')
export class WcDevtoolsApp extends LitElement {
  @state() private tree: WCNode[] = [];
  @state() private registry: string[] = [];
  @state() private selectedId: string | null = null;
  // Deepest node the user has navigated to. Lets the breadcrumb keep its full
  // chain visible when the user clicks an ancestor segment — clicking back up
  // the chain should not amputate the descendants from the trail.
  @state() private deepestSelectedId: string | null = null;
  @state() private leftTab: LeftTab = 'tree';
  @state() private status: Status = 'connecting';
  @state() private errorMsg = '';
  @state() private search: SearchQuery = {
    text: '',
    isRegex: false,
    framework: 'all',
  };
  @state() private lastPropResult: { propName: string; success: boolean; error?: string } | null =
    null;
  @state() private lastAttrResult: { attrName: string; success: boolean; error?: string } | null =
    null;
  @state() private lastChanges: Record<string, PropChange> = {};
  @state() private profiling: ProfilingState = createProfilingState();
  @state() private eventLog: EventLogEntry[] = [];
  @state() private cemIndex: CemIndex = new Map();
  @state() private isPicking = false;
  @state() private isTracing = false;
  // Tag of the last selected component that vanished from the tree — shown in
  // the inspector so a disappearance (e.g. sl-alert.toast() removes the node
  // after hide) doesn't read as a silent bug.
  @state() private selectionLostTag: string | null = null;
  @state() private lastInvokeResult: {
    methodName: string;
    success: boolean;
    result?: SerializableValue;
    error?: string;
  } | null = null;
  @state() private leftPaneWidth = 280;
  @state() private isDividerDragging = false;
  @state() private theme: Theme = (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'system';

  private baselines = new BaselineController(this);

  @query('wc-tree-virtual') private treeEl?: WcTreeVirtual;
  @query('.filter-input') private searchInput?: HTMLInputElement;

  // Per-frame state — `tree`/`registry` above are the merged views. frameUrls
  // lets inspectedWindow.eval target the frame that owns a node (top frame: 0).
  private frameTrees = new Map<number, WCNode[]>();
  private frameRegistries = new Map<number, string[]>();
  private frameUrls = new Map<number, string>();
  private frameTruncated = new Map<number, number>();
  @state() private hiddenCount = 0;

  /** CDN CEM urls already fetched (or in flight) — never retried within a page. */
  private attemptedCemSources = new Set<string>();

  private port!: chrome.runtime.Port;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private prevSelected: WCNode | null = null;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.applyTheme();
    this.connect();
    this.keepAliveTimer = setInterval(
      () => this.send({ version: MESSAGE_VERSION, type: 'keepalive' } as ExtensionMessage),
      20_000,
    );
    window.addEventListener('keydown', this.onGlobalKeydown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.keepAliveTimer !== null) clearInterval(this.keepAliveTimer);
    window.removeEventListener('keydown', this.onGlobalKeydown);
    document.removeEventListener('mousemove', this.onDividerMousemove);
    document.removeEventListener('mouseup', this.onDividerMouseup);
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has('theme' as keyof this)) this.applyTheme();
    if (changed.has('tree' as keyof this)) this.baselines.observe(this.tree);
    if (changed.has('tree' as keyof this) || changed.has('selectedId' as keyof this)) {
      const curr = this.selectedId ? (findNode(this.tree, this.selectedId) ?? null) : null;
      if (curr && this.prevSelected && curr.id === this.prevSelected.id) {
        this.lastChanges = diffNodeProps(this.prevSelected, curr);
      } else {
        this.lastChanges = {};
      }
      this.prevSelected = curr;
    }
  }

  private onGlobalKeydown = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.searchInput?.focus();
    }
  };

  // ── Theme ─────────────────────────────────────────────────────────────────────

  private applyTheme(): void {
    const root = document.documentElement;
    if (this.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', this.theme);
    localStorage.setItem(THEME_KEY, this.theme);
  }

  private cycleTheme = (): void => {
    const order: Theme[] = ['system', 'dark', 'light'];
    this.theme = order[(order.indexOf(this.theme) + 1) % order.length];
  };

  // ── Port ──────────────────────────────────────────────────────────────────────

  private send(msg: ExtensionMessage): void {
    try {
      this.port.postMessage(msg);
    } catch {
      /* port closed — reconnect in flight */
    }
  }

  private connect = (): void => {
    this.port = chrome.runtime.connect({ name: 'devtools' });
    this.port.postMessage({
      version: MESSAGE_VERSION,
      type: 'devtools-init',
      tabId: chrome.devtools.inspectedWindow.tabId,
    } satisfies ExtensionMessage);

    this.port.onMessage.addListener((msg: ExtensionMessage) => this.handleMessage(msg));
    this.port.onDisconnect.addListener(() => {
      this.status = 'connecting';
      setTimeout(this.connect, 300);
    });
  };

  private handleMessage(msg: ExtensionMessage): void {
    if (msg.version !== MESSAGE_VERSION) return;
    switch (msg.type) {
      case 'tree-snapshot': {
        this.setFrameState(msg.frameId ?? 0, msg.tree, msg.registry, msg.frameUrl, msg.truncated);
        this.status = 'active';
        this.dropVanishedSelection();
        break;
      }
      case 'tree-patches': {
        const frameId = msg.frameId ?? 0;
        const next = applyPatches(this.frameTrees.get(frameId) ?? [], msg.patches);
        this.setFrameState(frameId, next, msg.registry, msg.frameUrl, msg.truncated);
        this.status = 'active';
        this.profiling = recordPatches(this.profiling, msg.patches, Date.now());
        this.dropVanishedSelection();
        break;
      }
      case 'tab-navigated':
        this.status = 'navigating';
        this.frameTrees.clear();
        this.frameRegistries.clear();
        this.frameUrls.clear();
        this.frameTruncated.clear();
        this.hiddenCount = 0;
        this.tree = [];
        this.registry = [];
        this.selectedId = null;
        this.deepestSelectedId = null;
        this.selectionLostTag = null;
        this.lastPropResult = null;
        this.lastAttrResult = null;
        this.lastChanges = {};
        this.eventLog = [];
        this.profiling = createProfilingState();
        this.cemIndex = new Map();
        this.attemptedCemSources.clear();
        this.lastInvokeResult = null;
        this.baselines.reset();
        break;
      case 'injection-failed':
        this.status = 'injection-failed';
        this.errorMsg = msg.error;
        break;
      case 'set-prop-result':
        this.lastPropResult = { propName: msg.propName, success: msg.success, error: msg.error };
        setTimeout(() => {
          this.lastPropResult = null;
        }, 2000);
        break;
      case 'event-log': {
        const entry: EventLogEntry = {
          nodeId: msg.nodeId,
          eventType: msg.eventType,
          detail: msg.detail,
          bubbles: msg.bubbles,
          timestamp: msg.timestamp,
        };
        this.eventLog =
          this.eventLog.length >= 200
            ? [...this.eventLog.slice(1), entry]
            : [...this.eventLog, entry];
        break;
      }
      case 'pick-result': {
        if (this.isPicking) this.isPicking = false;
        if (findNode(this.tree, msg.nodeId)) {
          this.setSelection(msg.nodeId);
          this.publishWc0(msg.nodeId);
          this.lastPropResult = null;
          const ancestorIds = pathToNode(this.tree, msg.nodeId).map((n) => n.id);
          requestAnimationFrame(() => {
            this.treeEl?.expandAncestors(ancestorIds);
            this.querySelector('.pane--left .tree-node.selected')?.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
            });
          });
        }
        break;
      }
      case 'set-state-result':
        if (!msg.success) console.warn('[WC DevTools] toggle-state failed:', msg.error);
        break;
      case 'set-attr-result':
        this.lastAttrResult = { attrName: msg.attrName, success: msg.success, error: msg.error };
        setTimeout(() => {
          this.lastAttrResult = null;
        }, 2000);
        break;
      case 'invoke-method-result':
        this.lastInvokeResult = {
          methodName: msg.methodName,
          success: msg.success,
          result: msg.result,
          error: msg.error,
        };
        break;
      case 'cem-loaded':
        // Page-shipped manifest wins over CDN auto-fetched entries
        this.mergeCem(parseCem(msg.cem), false);
        break;
    }
  }

  /**
   * Clears the selection when the selected node left the tree — remembering
   * its tag so the inspector can say "removed from the page" instead of
   * silently going blank.
   */
  private dropVanishedSelection(): void {
    if (this.selectedId && !findNode(this.tree, this.selectedId)) {
      this.selectionLostTag = this.prevSelected?.tagName ?? null;
      this.selectedId = null;
    }
    if (this.deepestSelectedId && !findNode(this.tree, this.deepestSelectedId)) {
      this.deepestSelectedId = this.selectedId;
    }
  }

  /** Stores one frame's tree + registry and refreshes the merged views. */
  private setFrameState(
    frameId: number,
    tree: WCNode[],
    registry: string[],
    frameUrl?: string,
    truncated?: number,
  ): void {
    this.frameTrees.set(frameId, tree);
    this.frameRegistries.set(frameId, registry);
    if (frameUrl) this.frameUrls.set(frameId, frameUrl);
    this.frameTruncated.set(frameId, truncated ?? 0);
    this.hiddenCount = [...this.frameTruncated.values()].reduce((sum, n) => sum + n, 0);
    this.tree = mergeFrameTrees(this.frameTrees);
    this.registry = mergeFrameRegistries(this.frameRegistries);
    this.autoFetchCems();
  }

  // ── CEM auto-fetch ──────────────────────────────────────────────────────────
  //
  // Well-known design systems publish their Custom Elements Manifest on npm —
  // when their tag prefix shows up in the page registry, fetch docs from
  // jsdelivr. Runs in the panel (extension context), so the page's CSP cannot
  // block it. Every URL verified to resolve as of 2026-07.

  private static readonly KNOWN_CEM_SOURCES: ReadonlyArray<[prefix: string, url: string]> = [
    ['sl-', 'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/dist/custom-elements.json'],
    ['wa-', 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome/dist/custom-elements.json'],
    ['vaadin-', 'https://cdn.jsdelivr.net/npm/@vaadin/component-base/custom-elements.json'],
    ['ui5-', 'https://cdn.jsdelivr.net/npm/@ui5/webcomponents/dist/custom-elements.json'],
    ['lion-', 'https://cdn.jsdelivr.net/npm/@lion/ui/custom-elements.json'],
  ];

  private autoFetchCems(): void {
    for (const [prefix, url] of WcDevtoolsApp.KNOWN_CEM_SOURCES) {
      if (this.attemptedCemSources.has(url)) continue;
      if (!this.registry.some((tag) => tag.startsWith(prefix))) continue;
      this.attemptedCemSources.add(url);
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((cem) => {
          if (cem) this.mergeCem(parseCem(cem), true);
        })
        .catch(() => {});
    }
  }

  /** Merges a parsed CEM into the index. keepExisting: existing entries win (CDN case). */
  private mergeCem(incoming: CemIndex, keepExisting: boolean): void {
    if (incoming.size === 0) return;
    const next = new Map(this.cemIndex);
    for (const [tag, el] of incoming) {
      if (keepExisting && next.has(tag)) continue;
      next.set(tag, el);
    }
    this.cemIndex = next;
  }

  /** URL of the iframe owning the node, or undefined for the top frame. */
  private frameUrlForNode(nodeId: string): string | undefined {
    for (const [frameId, tree] of this.frameTrees) {
      if (frameId !== 0 && findNode(tree, nodeId)) return this.frameUrls.get(frameId);
    }
    return undefined;
  }

  // ── Pane resize ────────────────────────────────────────────────────────────────

  private onDividerMousedown = (e: MouseEvent): void => {
    e.preventDefault();
    this.isDividerDragging = true;
    this.resizeStartX = e.clientX;
    this.resizeStartWidth = this.leftPaneWidth;
    document.addEventListener('mousemove', this.onDividerMousemove);
    document.addEventListener('mouseup', this.onDividerMouseup);
  };

  private onDividerMousemove = (e: MouseEvent): void => {
    if (!this.isDividerDragging) return;
    const delta = e.clientX - this.resizeStartX;
    this.leftPaneWidth = Math.max(160, Math.min(600, this.resizeStartWidth + delta));
  };

  private onDividerMouseup = (): void => {
    this.isDividerDragging = false;
    document.removeEventListener('mousemove', this.onDividerMousemove);
    document.removeEventListener('mouseup', this.onDividerMouseup);
  };

  // ── Tree handlers ─────────────────────────────────────────────────────────────

  /** Eval targeting the frame that owns the node — top frame when no frameURL matches. */
  private evalForNode(nodeId: string, code: string, callback?: (err: unknown) => void): void {
    if (typeof chrome === 'undefined' || !chrome.devtools?.inspectedWindow) return;
    const frameURL = this.frameUrlForNode(nodeId);
    chrome.devtools.inspectedWindow.eval(
      code,
      frameURL ? { frameURL } : undefined,
      (_result: unknown, err: chrome.devtools.inspectedWindow.EvaluationExceptionInfo) =>
        callback?.(err),
    );
  }

  private publishWc0(nodeId: string): void {
    const code = `(() => {
      const w = window;
      if (typeof w.__wc_devtools_inspect !== 'function') return;
      const el = w.__wc_devtools_inspect(${JSON.stringify(nodeId)});
      if (!el) return;
      w.$wc4 = w.$wc3; w.$wc3 = w.$wc2; w.$wc2 = w.$wc1; w.$wc1 = w.$wc0;
      w.$wc0 = el; w.$wc = el;
    })();`;
    this.evalForNode(nodeId, code);
  }

  private handleNodeSelect = (nodeId: string): void => {
    this.setSelection(nodeId);
    this.lastPropResult = null;
    this.lastAttrResult = null;
    this.lastInvokeResult = null;
    this.send({ version: MESSAGE_VERSION, type: 'highlight-node', nodeId });
    this.publishWc0(nodeId);
    const ancestorIds = pathToNode(this.tree, nodeId).map((n) => n.id);
    this.treeEl?.expandAncestors(ancestorIds);
  };

  private onNodeHover = (nodeId: string): void => {
    this.send({ version: MESSAGE_VERSION, type: 'highlight-node', nodeId });
  };

  private onNodeHoverEnd = (): void => {
    this.send({ version: MESSAGE_VERSION, type: 'highlight-node', nodeId: null });
  };

  private onNodeScrollTo = (nodeId: string): void => {
    this.send({ version: MESSAGE_VERSION, type: 'scroll-into-view', nodeId } as ExtensionMessage);
  };

  // Click-to-source: the Sources panel applies source maps to the registration
  // site captured at customElements.define. Stack refs are 1-based, openResource
  // is 0-based. Firefox has no openResource — fall back to opening the raw URL.
  private onOpenSource = (ref: SourceRef): void => {
    const openResource = chrome.devtools?.panels?.openResource;
    if (typeof openResource === 'function') {
      openResource(ref.url, Math.max(0, ref.line - 1), Math.max(0, ref.column - 1), () => {});
    } else {
      window.open(ref.url, '_blank');
    }
  };

  private onNodeInspect = (nodeId: string): void => {
    this.evalForNode(
      nodeId,
      `inspect(window.__wc_devtools_inspect?.(${JSON.stringify(nodeId)}))`,
      (err) => {
        const e = err as { isException?: boolean; value?: string } | null;
        if (e?.isException) console.warn('[WC DevTools] inspect failed', e.value);
      },
    );
  };

  // ── Edit handlers ─────────────────────────────────────────────────────────────

  private handleSetProp = (nodeId: string, propName: string, value: SerializableValue): void => {
    this.send({ version: MESSAGE_VERSION, type: 'set-prop', nodeId, propName, value });
  };

  private handleSetAttr = (nodeId: string, attrName: string, value: string): void => {
    this.send({ version: MESSAGE_VERSION, type: 'set-attr', nodeId, attrName, value });
  };

  private handleRemoveAttr = (nodeId: string, attrName: string): void => {
    this.send({ version: MESSAGE_VERSION, type: 'remove-attr', nodeId, attrName });
  };

  private handleToggleState = (nodeId: string, state: string, enabled: boolean): void => {
    this.send({ version: MESSAGE_VERSION, type: 'toggle-state', nodeId, state, enabled });
  };

  private handleInvokeMethod = (
    nodeId: string,
    methodName: string,
    args: SerializableValue[],
  ): void => {
    this.lastInvokeResult = null;
    this.send({ version: MESSAGE_VERSION, type: 'invoke-method', nodeId, methodName, args });
  };

  private handleDispatchEvent = (
    nodeId: string,
    eventType: string,
    detail: SerializableValue,
  ): void => {
    this.send({ version: MESSAGE_VERSION, type: 'dispatch-event', nodeId, eventType, detail });
  };

  private handleSetCssVar = (nodeId: string, name: string, value: string | null): void => {
    this.send({ version: MESSAGE_VERSION, type: 'set-css-var', nodeId, name, value });
  };

  private handleTraceToggle = (): void => {
    this.isTracing = !this.isTracing;
    this.send({ version: MESSAGE_VERSION, type: 'trace-updates', enabled: this.isTracing });
  };

  private onSelectFromBreadcrumb = (nodeId: string): void => {
    this.setSelection(nodeId);
    this.lastPropResult = null;
    this.publishWc0(nodeId);
    this.send({ version: MESSAGE_VERSION, type: 'highlight-node', nodeId });
    const ancestorIds = pathToNode(this.tree, nodeId).map((n) => n.id);
    this.treeEl?.expandAncestors(ancestorIds);
  };

  private handleRefresh = (): void => {
    this.send({ version: MESSAGE_VERSION, type: 'refresh-request' });
  };

  private handlePick = (): void => {
    this.isPicking = !this.isPicking;
    this.send({
      version: MESSAGE_VERSION,
      type: this.isPicking ? 'enter-pick-mode' : 'exit-pick-mode',
    } as ExtensionMessage);
  };

  // Update selection. Keeps `deepestSelectedId` pointing at the leafmost node
  // the user has navigated to so the breadcrumb retains its full chain when
  // the user clicks an ancestor segment. Selecting a node outside that chain
  // resets the deepest pointer to the new selection.
  private setSelection(nodeId: string | null): void {
    this.selectedId = nodeId;
    this.selectionLostTag = null;
    if (nodeId === null) {
      this.deepestSelectedId = null;
      return;
    }
    if (this.deepestSelectedId && this.deepestSelectedId !== nodeId) {
      const onChain = pathToNode(this.tree, this.deepestSelectedId).some((n) => n.id === nodeId);
      if (onChain) return;
    }
    this.deepestSelectedId = nodeId;
  }

  // ── Computed ──────────────────────────────────────────────────────────────────

  private get selectedNode(): WCNode | null {
    return this.selectedId ? (findNode(this.tree, this.selectedId) ?? null) : null;
  }

  private get selectedPath(): WCNode[] {
    const id = this.deepestSelectedId ?? this.selectedId;
    return id ? pathToNode(this.tree, id) : [];
  }

  private get filteredTree(): WCNode[] {
    return pruneTree(this.tree, this.search);
  }

  private get queryActive(): boolean {
    return this.search.text !== '' || this.search.framework !== 'all';
  }

  private get wcCount(): number {
    return countNodes(this.tree);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  render() {
    return html`
      <div class="panel-root">
        ${this.renderHeader()}
        <div class="panel-body">
          ${this.renderLeftPane()}
          <div
            class="pane-divider ${this.isDividerDragging ? 'pane-divider--dragging' : ''}"
            @mousedown=${this.onDividerMousedown}
          ></div>
          <div class="pane pane--right">
            <wc-inspector
              .node=${this.selectedNode}
              .lastResult=${this.lastPropResult}
              .lastAttrResult=${this.lastAttrResult}
              .lastInvokeResult=${this.lastInvokeResult}
              .removedTag=${this.selectionLostTag}
              .eventLog=${this.eventLog}
              .path=${this.selectedPath}
              .selectedId=${this.selectedId}
              .lastChanges=${this.lastChanges}
              .baseline=${
                this.selectedNode
                  ? (this.baselines.baselines.get(this.selectedNode.id) ?? null)
                  : null
              }
              .cem=${
                this.selectedNode ? (this.cemIndex.get(this.selectedNode.tagName) ?? null) : null
              }
              @set-prop=${(e: CustomEvent) =>
                this.handleSetProp(e.detail.nodeId, e.detail.propName, e.detail.value)}
              @set-attr=${(e: CustomEvent) =>
                this.handleSetAttr(e.detail.nodeId, e.detail.attrName, e.detail.value)}
              @remove-attr=${(e: CustomEvent) =>
                this.handleRemoveAttr(e.detail.nodeId, e.detail.attrName)}
              @clear-events=${() => {
                this.eventLog = [];
              }}
              @toggle-state=${(e: CustomEvent) =>
                this.handleToggleState(e.detail.nodeId, e.detail.state, e.detail.enabled)}
              @invoke-method=${(e: CustomEvent) =>
                this.handleInvokeMethod(e.detail.nodeId, e.detail.methodName, e.detail.args)}
              @dispatch-event=${(e: CustomEvent) =>
                this.handleDispatchEvent(e.detail.nodeId, e.detail.eventType, e.detail.detail)}
              @set-css-var=${(e: CustomEvent) =>
                this.handleSetCssVar(e.detail.nodeId, e.detail.name, e.detail.value)}
              @breadcrumb-select=${(e: CustomEvent) => this.onSelectFromBreadcrumb(e.detail.nodeId)}
              @open-source=${(e: CustomEvent) => this.onOpenSource(e.detail.sourceRef)}
            ></wc-inspector>
          </div>
        </div>
        ${this.renderStatusBar()}
      </div>
    `;
  }

  private renderHeader() {
    const shadowMark = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="13" height="13" rx="2.5" stroke="currentColor" stroke-width="1.6"/>
        <rect x="8" y="8" width="13" height="13" rx="2.5" fill="currentColor" opacity="0.22"/>
        <rect x="8" y="8" width="13" height="13" rx="2.5" stroke="currentColor" stroke-width="1.6"/>
      </svg>`;
    return html`
      <header class="panel-header">
        <div class="panel-brand">
          <span class="panel-mark">${unsafeHTML(shadowMark)}</span>
          <span class="panel-brand-name">WC DEVTOOLS</span>
        </div>
        <div class="panel-search">
          <span class="panel-search-icon">${unsafeHTML(icon('search', { size: 12 }))}</span>
          <input
            .value=${this.search.text}
            class="filter-input"
            type="text"
            placeholder=${this.search.isRegex ? 'regex…' : 'Search components, properties, events…'}
            @input=${(e: Event) => {
              this.search = { ...this.search, text: (e.target as HTMLInputElement).value };
            }}
          />
          <span class="panel-kbd">⌘K</span>
        </div>
        <button
          class="icon-btn search-toggle ${this.search.isRegex ? 'search-toggle--active' : ''}"
          title="Toggle regex search"
          @click=${() => {
            this.search = { ...this.search, isRegex: !this.search.isRegex };
          }}
        >
          .*
        </button>
        <select
          .value=${this.search.framework}
          class="search-select"
          title="Framework filter"
          @change=${(e: Event) => {
            this.search = {
              ...this.search,
              framework: (e.target as HTMLSelectElement).value as SearchQuery['framework'],
            };
          }}
        >
          <option value="all">all</option>
          <option value="lit">Lit</option>
          <option value="fast">FAST</option>
          <option value="stencil">Stencil</option>
          <option value="vanilla">vanilla</option>
        </select>
        <span class="panel-divider"></span>
        <button
          class="icon-btn pick-btn ${this.isPicking ? 'pick-btn--active' : ''}"
          title="Pick a component from the page"
          @click=${this.handlePick}
        >
          ${unsafeHTML(icon('crosshair', { size: 14 }))}
        </button>
        <button
          class="icon-btn trace-btn ${this.isTracing ? 'trace-btn--active' : ''}"
          title="Trace updates — flash components on the page when they re-render"
          @click=${this.handleTraceToggle}
        >
          ${unsafeHTML(icon('activity', { size: 14 }))}
        </button>
        <button class="icon-btn refresh-btn" title="Refresh component tree" @click=${this.handleRefresh}>
          ${unsafeHTML(icon('rotate-cw', { size: 14 }))}
        </button>
        <span class="panel-divider"></span>
        <button
          class="icon-btn theme-btn"
          title=${`Theme: ${this.theme} (click to cycle)`}
          @click=${this.cycleTheme}
        >
          ${
            this.theme === 'dark'
              ? unsafeHTML(icon('moon', { size: 14 }))
              : this.theme === 'light'
                ? unsafeHTML(icon('sun', { size: 14 }))
                : unsafeHTML(icon('monitor', { size: 14 }))
          }
        </button>
      </header>
    `;
  }

  private renderLeftPane() {
    return html`
      <div class="pane pane--left" style=${`width: ${this.leftPaneWidth}px`}>
        <div class="tab-strip">
          <button
            class="tab ${this.leftTab === 'tree' ? 'active' : ''}"
            @click=${() => {
              this.leftTab = 'tree';
            }}
          >
            ${unsafeHTML(icon('network', { size: 11 }))} Tree
          </button>
          <button
            class="tab ${this.leftTab === 'registry' ? 'active' : ''}"
            @click=${() => {
              this.leftTab = 'registry';
            }}
          >
            ${unsafeHTML(icon('list', { size: 11 }))} Registry
            <span class="badge">${this.registry.length}</span>
          </button>
          <button
            class="tab ${this.leftTab === 'profiling' ? 'active' : ''}"
            @click=${() => {
              this.leftTab = 'profiling';
            }}
          >
            ${unsafeHTML(icon('activity', { size: 11 }))} Perf
          </button>
        </div>
        <div class="pane-content">
          ${
            this.leftTab === 'tree'
              ? html`<wc-tree-virtual
                .nodes=${this.filteredTree}
                .selectedId=${this.selectedId}
                .queryActive=${this.queryActive}
                @node-select=${(e: CustomEvent) => this.handleNodeSelect(e.detail.nodeId)}
                @node-hover=${(e: CustomEvent) => this.onNodeHover(e.detail.nodeId)}
                @node-hover-end=${() => this.onNodeHoverEnd()}
                @node-scroll-to=${(e: CustomEvent) => this.onNodeScrollTo(e.detail.nodeId)}
                @node-inspect=${(e: CustomEvent) => this.onNodeInspect(e.detail.nodeId)}
              ></wc-tree-virtual>`
              : this.leftTab === 'registry'
                ? html`<wc-registry .tags=${this.registry} .filter=${this.search.text}></wc-registry>`
                : html`<wc-profiling-panel
                  .state=${this.profiling}
                  .tree=${this.tree}
                  @select=${(e: CustomEvent) => this.handleNodeSelect(e.detail.id)}
                ></wc-profiling-panel>`
          }
        </div>
      </div>
    `;
  }

  private renderStatusBar() {
    const cls =
      this.status === 'connecting'
        ? 'status--connecting'
        : this.status === 'navigating'
          ? 'status--navigating'
          : this.status === 'active'
            ? 'status--active'
            : 'status--error';
    const label =
      this.status === 'connecting'
        ? 'Connecting…'
        : this.status === 'navigating'
          ? 'Navigating…'
          : this.status === 'injection-failed'
            ? `Injection failed: ${this.errorMsg}`
            : this.status === 'error'
              ? this.errorMsg
              : 'Connected';
    const showCounts = this.status === 'active';
    return html`<div class="status-bar ${cls}">
      <span class="status-dot"></span>
      <span class="status-label">${label}</span>
      ${
        showCounts
          ? html`<span class="status-sep"></span>
              <span class="mono">${this.wcCount}</span>
              <span>component${this.wcCount !== 1 ? 's' : ''}</span>
              <span class="status-sep"></span>
              <span class="mono">${this.registry.length}</span>
              <span>defined</span>
              ${
                this.hiddenCount > 0
                  ? html`<span class="status-sep"></span>
                    <span
                      class="mono status-hidden"
                      title="Components beyond the capacity cap — present on the page but not shown in the tree"
                      >+${this.hiddenCount} hidden</span
                    >`
                  : nothing
              }`
          : nothing
      }
      <span class="status-spacer"></span>
      <span class="status-version mono">wc-devtools</span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-devtools-app': WcDevtoolsApp;
  }
}
