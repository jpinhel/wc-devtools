import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { WCNode } from '../../../../types/wc';

@customElement('wc-tab-a11y')
export class WcTabA11y extends LitElement {
  @property({ attribute: false }) node!: WCNode;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  render() {
    const refs = this.node.ariaRefs;
    if (!refs || refs.length === 0) {
      return html`<div class="empty-state empty-state--small">
        No aria-* idref attributes on this element.
      </div>`;
    }
    return html`
      <div class="aria-list">
        ${repeat(
          refs,
          (r) => r.attribute,
          (ref) => html`
            <div class="aria-row">
              <span class="aria-attr">${ref.attribute}</span>
              ${repeat(
                ref.ids,
                (id) => id,
                (id) => html`<span class="aria-id">#${id}</span>`,
              )}
              ${
                ref.crossRoot
                  ? html`<span class="aria-cross" title="Target lives in a different (shadow) root">cross-root</span>`
                  : ''
              }
            </div>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-tab-a11y': WcTabA11y;
  }
}
