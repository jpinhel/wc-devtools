import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

@customElement('wc-registry')
export class WcRegistry extends LitElement {
  @property({ attribute: false }) tags: string[] = [];
  @property({ type: String }) filter = '';

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  private get filtered(): string[] {
    if (!this.filter) return this.tags;
    const needle = this.filter.toLowerCase();
    return this.tags.filter((t) => t.toLowerCase().includes(needle));
  }

  render() {
    const filtered = this.filtered;
    if (filtered.length === 0) {
      const msg =
        this.tags.length === 0
          ? 'No custom elements registered yet.'
          : `No matches for "${this.filter}".`;
      return html`<div class="empty-state">${msg}</div>`;
    }
    return html`
      <div class="registry-list">
        ${repeat(
          filtered,
          (t) => t,
          (tag) => html`
            <div class="registry-item">
              <span class="tag">&lt;${tag}&gt;</span>
            </div>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-registry': WcRegistry;
  }
}
