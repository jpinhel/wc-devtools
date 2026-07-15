import '@lit-labs/virtualizer';
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { flattenTree } from '../../../lib/tree-flatten';
import type { WCNode } from '../../../types/wc';
import { icon } from '../icons';
import { fwBadge } from '../utils';

type FlatRow = ReturnType<typeof flattenTree>[number];

@customElement('wc-tree-virtual')
export class WcTreeVirtual extends LitElement {
  @property({ attribute: false }) nodes: WCNode[] = [];
  @property({ type: Boolean }) queryActive = false;
  @property({ attribute: false }) selectedId: string | null = null;

  @state() private expanded = new Set<string>();
  private seeded = false;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('nodes')) return;
    if (this.nodes.length === 0) {
      this.seeded = false;
      this.expanded = new Set();
      return;
    }
    if (this.seeded) return;
    const seed = new Set<string>();
    for (const root of this.nodes) seed.add(root.id);
    this.expanded = seed;
    this.seeded = true;
  }

  expandAncestors(ids: string[]): void {
    if (ids.length === 0) return;
    const next = new Set(this.expanded);
    for (const id of ids) next.add(id);
    this.expanded = next;
  }

  private toggle(id: string): void {
    const next = new Set(this.expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded = next;
  }

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private rowClass(row: FlatRow): string {
    const classes = ['tree-node', `tree-node--${row.node.framework}`];
    if (row.kind === 'node' && this.selectedId === row.node.id) classes.push('selected');
    if (row.kind === 'shadow-header') classes.push('tree-node--shadow-header');
    if (row.kind === 'hidden') classes.push('tree-node--hidden');
    return classes.join(' ');
  }

  private renderRow(row: FlatRow) {
    const padding = `padding-left: ${8 + row.depth * 14}px`;
    if (row.kind === 'shadow-header') {
      return html`<div class=${this.rowClass(row)} style=${padding}>
        <span class="shadow-label">shadow-root</span>
      </div>`;
    }
    if (row.kind === 'hidden') {
      return html`<div
        class=${this.rowClass(row)}
        style=${padding}
        title="Capacity cap reached in this region — these components exist but are not shown"
      >
        <span class="hidden-label">+${row.hiddenCount} hidden</span>
      </div>`;
    }
    const node = row.node;
    const badge = fwBadge(node.framework);
    return html`
      <div
        class=${this.rowClass(row)}
        style=${padding}
        @click=${(e: Event) => {
          e.stopPropagation();
          this.emit('node-select', { nodeId: node.id });
        }}
        @mouseenter=${(e: Event) => {
          e.stopPropagation();
          this.emit('node-hover', { nodeId: node.id });
        }}
        @mouseleave=${(e: Event) => {
          e.stopPropagation();
          this.emit('node-hover-end', null);
        }}
      >
        <span
          class="toggle ${row.hasChildren ? '' : 'toggle--hidden'}"
          @click=${(e: Event) => {
            e.stopPropagation();
            this.toggle(node.id);
          }}
        >
          ${this.expanded.has(node.id) ? '▼' : '▶'}
        </span>
        <span class="tag">&lt;${node.tagName}&gt;</span>
        ${
          Array.isArray(node.shadowRoot)
            ? html`<span class="shadow-badge" title="Has open shadow root">#shadow</span>`
            : ''
        }
        ${
          node.shadowRoot === 'closed'
            ? html`<span class="shadow-badge closed" title="Closed shadow root">#closed</span>`
            : ''
        }
        ${badge ? html`<span class="fw-badge ${badge.cls}">${badge.label}</span>` : ''}
        <div class="node-actions">
          <button
            class="node-action-btn"
            title="Scroll to element"
            @click=${(e: Event) => {
              e.stopPropagation();
              this.emit('node-scroll-to', { nodeId: node.id });
            }}
          >
            ${unsafeHTML(icon('external-link', { size: 11 }))}
          </button>
          <button
            class="node-action-btn"
            title="Inspect in Elements panel"
            @click=${(e: Event) => {
              e.stopPropagation();
              this.emit('node-inspect', { nodeId: node.id });
            }}
          >
            ${unsafeHTML(icon('code', { size: 11 }))}
          </button>
        </div>
      </div>
    `;
  }

  render() {
    if (this.nodes.length === 0) {
      return html`<div class="empty-state">
        ${this.queryActive ? 'No matching components.' : 'No Web Components detected on this page.'}
      </div>`;
    }
    const flat = flattenTree(this.nodes, this.expanded);
    return html`
      <lit-virtualizer
        class="tree-root tree-root--virtual"
        scroller
        .items=${flat}
        .keyFunction=${(item: FlatRow) => item.key}
        .renderItem=${(item: FlatRow) => this.renderRow(item)}
      ></lit-virtualizer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-tree-virtual': WcTreeVirtual;
  }
}
