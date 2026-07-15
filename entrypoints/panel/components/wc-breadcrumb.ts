import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { WCNode } from '../../../types/wc';
import { icon } from '../icons';

@customElement('wc-breadcrumb')
export class WcBreadcrumb extends LitElement {
  @property({ attribute: false }) path: WCNode[] = [];
  @property({ attribute: false }) selectedId: string | null = null;

  // Light DOM so the global panel stylesheet applies without changes.
  protected createRenderRoot(): HTMLElement {
    return this;
  }

  private onSegmentClick(nodeId: string): void {
    this.dispatchEvent(
      // Not 'select' — inputs fire a native bubbling 'select' event (text
      // selection) with no detail, which would collide at the app listener.
      new CustomEvent('breadcrumb-select', { detail: { nodeId }, bubbles: true, composed: true }),
    );
  }

  render() {
    if (this.path.length === 0) return nothing;
    const last = this.path.length - 1;
    const activeId = this.selectedId;
    return html`
      <nav class="breadcrumb">
        ${repeat(
          this.path,
          (n) => n.id,
          (node, i) => html`
          <button
            class="breadcrumb-segment ${node.id === activeId ? 'breadcrumb-segment--active' : ''} ${i === last ? 'breadcrumb-segment--last' : ''}"
            title=${node.tagName}
            @click=${() => this.onSegmentClick(node.id)}
          >&lt;${node.tagName}&gt;</button>
          ${i < last ? html`<span class="breadcrumb-sep">${unsafeHTML(icon('chevron-right', { size: 10 }))}</span>` : nothing}
        `,
        )}
      </nav>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-breadcrumb': WcBreadcrumb;
  }
}
