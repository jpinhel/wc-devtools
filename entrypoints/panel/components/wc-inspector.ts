import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { PropChange } from '../../../lib/render-diff';
import type { CemElement, EventLogEntry, SerializableValue, WCNode } from '../../../types/wc';
import { icon } from '../icons';
import { fwBadge } from '../utils';
import './wc-breadcrumb';
import './tabs/wc-tab-a11y';
import './tabs/wc-tab-attrs';
import './tabs/wc-tab-cem';
import './tabs/wc-tab-events';
import './tabs/wc-tab-methods';
import './tabs/wc-tab-props';
import './tabs/wc-tab-signals';
import './tabs/wc-tab-slots';
import './tabs/wc-tab-styles';

interface Baseline {
  properties: Record<string, SerializableValue>;
  attributes: Record<string, string>;
}

type TabKey =
  | 'props'
  | 'attrs'
  | 'methods'
  | 'events'
  | 'slots'
  | 'styles'
  | 'a11y'
  | 'cem'
  | 'signals';

@customElement('wc-inspector')
export class WcInspector extends LitElement {
  @property({ attribute: false }) node: WCNode | null = null;
  @property({ attribute: false }) lastResult: {
    propName: string;
    success: boolean;
    error?: string;
  } | null = null;
  @property({ attribute: false }) lastAttrResult: {
    attrName: string;
    success: boolean;
    error?: string;
  } | null = null;
  @property({ attribute: false }) lastInvokeResult: {
    methodName: string;
    success: boolean;
    result?: SerializableValue;
    error?: string;
  } | null = null;
  @property({ attribute: false }) eventLog: EventLogEntry[] = [];
  @property({ attribute: false }) path: WCNode[] = [];
  @property({ attribute: false }) selectedId: string | null = null;
  @property({ attribute: false }) lastChanges: Record<string, PropChange> = {};
  @property({ attribute: false }) baseline: Baseline | null = null;
  @property({ attribute: false }) cem: CemElement | null = null;
  /** Tag of the previously selected component that was removed from the page. */
  @property({ attribute: false }) removedTag: string | null = null;

  @state() private activeTab: TabKey = 'props';

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  private get badge() {
    return this.node ? fwBadge(this.node.framework) : null;
  }

  private get nodeEventCount(): number {
    return this.node ? this.eventLog.filter((e) => e.nodeId === this.node?.id).length : 0;
  }

  private copyJSON(): void {
    if (!this.node) return;
    const data = {
      tagName: this.node.tagName,
      framework: this.node.framework,
      attributes: this.node.attributes,
      properties: this.node.properties,
      methods: this.node.methods,
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).catch(() => {});
  }

  private forward(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  render() {
    const node = this.node;
    return html`
      <div class="inspector">
        <wc-breadcrumb
          .path=${this.path}
          .selectedId=${this.selectedId}
        ></wc-breadcrumb>

        ${node ? this.renderHeader(node) : nothing}

        ${
          node?.shadowRoot === 'closed'
            ? html`<div class="shadow-closed-notice">
              ${unsafeHTML(icon('alert-triangle', { size: 12 }))}
              This component has a <strong>closed</strong> shadow root — its internals are
              inaccessible by design. Properties and children shown above are from the host
              element only.
            </div>`
            : nothing
        }

        ${
          node?.customStates && node.customStates.length > 0
            ? html`<div class="states-row">
              <span class="states-label">States</span>
              ${node.customStates.map(
                (s) => html`<button
                  class="state-chip state-chip--active"
                  title=${`Click to remove ${s}`}
                  @click=${() =>
                    this.forward('toggle-state', { nodeId: node.id, state: s, enabled: false })}
                >
                  ${s} ×
                </button>`,
              )}
            </div>`
            : nothing
        }

        ${this.renderTabStrip(node)} ${this.renderTabContent(node)}
        ${
          this.activeTab === 'props' && node
            ? html`<div class="edit-hint">
              Click a value to edit · booleans toggle on click · Ctrl+Enter to apply object edits
            </div>`
            : nothing
        }
      </div>
    `;
  }

  private renderHeader(node: WCNode) {
    const badge = this.badge;
    const hasOpenShadow = Array.isArray(node.shadowRoot);
    return html`
      <div class="inspector-header">
        <span class="tag tag--large">&lt;${node.tagName}&gt;</span>
        ${
          hasOpenShadow
            ? html`<span class="shadow-badge" title="Has open shadow root">#shadow</span>`
            : nothing
        }
        ${
          node.shadowRoot === 'closed'
            ? html`<span class="shadow-badge closed" title="Closed shadow root">#closed</span>`
            : nothing
        }
        ${badge ? html`<span class="fw-badge ${badge.cls}">${badge.label}</span>` : nothing}
        ${
          node.stencilHydration === 'ssr-only'
            ? html`<span
              class="hydration-badge hydration-badge--ssr"
              title="SSR-rendered, not yet hydrated"
            >
              SSR
            </span>`
            : node.stencilHydration === 'hydrated'
              ? html`<span
                class="hydration-badge hydration-badge--hydrated"
                title="Client-hydrated"
              >
                HYD
              </span>`
              : nothing
        }
        ${
          node.sourceRef
            ? html`<button
              class="copy-btn icon-btn"
              title=${`Open source — ${node.sourceRef.url}:${node.sourceRef.line}`}
              @click=${() => this.forward('open-source', { sourceRef: node.sourceRef })}
            >
              ${unsafeHTML(icon('code', { size: 12 }))}
              <span>src</span>
            </button>`
            : nothing
        }
        <button class="copy-btn icon-btn" title="Copy as JSON" @click=${() => this.copyJSON()}>
          ${unsafeHTML(icon('copy', { size: 12 }))}
          <span>JSON</span>
        </button>
      </div>
    `;
  }

  private tabBtn(
    key: TabKey,
    label: string,
    iconName: Parameters<typeof icon>[0],
    badge?: unknown,
  ) {
    return html`<button
      class=${`tab ${this.activeTab === key ? 'active' : ''}`}
      @click=${() => {
        this.activeTab = key;
      }}
    >
      ${unsafeHTML(icon(iconName, { size: 11 }))} ${label}
      ${badge ? html`<span class="badge">${badge}</span>` : nothing}
    </button>`;
  }

  private renderTabStrip(node: WCNode | null) {
    return html`
      <div class="tab-strip">
        ${this.tabBtn('props', 'Properties', 'sliders-horizontal')}
        ${this.tabBtn('attrs', 'Attributes', 'tag')}
        ${this.tabBtn('methods', 'Methods', 'braces', node?.methods.length ? node.methods.length : null)}
        <button
          class=${`tab ${this.activeTab === 'events' ? 'active' : ''}`}
          @click=${() => {
            this.activeTab = 'events';
          }}
        >
          ${unsafeHTML(icon('zap', { size: 11 }))} Events
          ${
            this.nodeEventCount > 0
              ? html`<span class="badge event-badge">${this.nodeEventCount}</span>`
              : nothing
          }
        </button>
        ${this.tabBtn('slots', 'Slots', 'boxes', node?.slots?.length ? node.slots.length : null)}
        ${this.tabBtn('styles', 'Styles', 'palette')}
        ${this.tabBtn('a11y', 'A11y', 'accessibility', node?.ariaRefs?.length ? node.ariaRefs.length : null)}
        ${this.cem ? this.tabBtn('cem', 'CEM', 'book-open') : nothing}
        ${
          node?.signals?.length || node?.contextRequests?.length || node?.tasks?.length
            ? html`<button
              class=${`tab ${this.activeTab === 'signals' ? 'active' : ''}`}
              @click=${() => {
                this.activeTab = 'signals';
              }}
            >
              ${unsafeHTML(icon('radio', { size: 11 }))} Signals
              <span class="badge">
                ${
                  (node?.signals?.length ?? 0) +
                  (node?.contextRequests?.length ?? 0) +
                  (node?.tasks?.length ?? 0)
                }
              </span>
            </button>`
            : nothing
        }
      </div>
    `;
  }

  private renderTabContent(node: WCNode | null) {
    if (!node) {
      return html`<div class="tab-content">
        <div class="empty-state">
          ${
            this.removedTag
              ? html`<span class="tag">&lt;${this.removedTag}&gt;</span>${' was removed from the page.'}`
              : 'Select a component to inspect.'
          }
        </div>
      </div>`;
    }
    return html`<div class="tab-content">${this.renderActiveTab(node)}</div>`;
  }

  private renderActiveTab(node: WCNode) {
    switch (this.activeTab) {
      // Tab events (set-prop, set-attr, invoke-method, …) bubble composed
      // through this light-DOM host straight to the app — re-forwarding them
      // here would make every handler (and page command) fire twice.
      case 'props':
        return html`<wc-tab-props
          .node=${node}
          .lastResult=${this.lastResult}
          .lastChanges=${this.lastChanges}
          .baseline=${this.baseline}
        ></wc-tab-props>`;
      case 'attrs':
        return html`<wc-tab-attrs
          .node=${node}
          .lastResult=${this.lastAttrResult}
          .baseline=${this.baseline}
        ></wc-tab-attrs>`;
      case 'methods':
        return html`<wc-tab-methods
          .node=${node}
          .lastResult=${this.lastInvokeResult}
        ></wc-tab-methods>`;
      case 'events':
        return html`<wc-tab-events
          .node=${node}
          .eventLog=${this.eventLog}
        ></wc-tab-events>`;
      case 'slots':
        return html`<wc-tab-slots .node=${node}></wc-tab-slots>`;
      case 'styles':
        return html`<wc-tab-styles .node=${node}></wc-tab-styles>`;
      case 'a11y':
        return html`<wc-tab-a11y .node=${node}></wc-tab-a11y>`;
      case 'cem':
        return this.cem ? html`<wc-tab-cem .cem=${this.cem}></wc-tab-cem>` : nothing;
      case 'signals':
        return html`<wc-tab-signals .node=${node}></wc-tab-signals>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-inspector': WcInspector;
  }
}
