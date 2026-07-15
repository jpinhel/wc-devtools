import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { WCNode } from '../../../../types/wc';

@customElement('wc-tab-slots')
export class WcTabSlots extends LitElement {
  @property({ attribute: false }) node!: WCNode;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  render() {
    const slots = this.node.slots;
    if (!slots || slots.length === 0) {
      return html`<div class="empty-state empty-state--small">No slots defined.</div>`;
    }
    return html`
      <div class="slots-list">
        ${repeat(
          slots,
          (s) => s.name || '(default)',
          (slot) => html`
            <div class="slot-row">
              <div class="slot-header">
                <span class="slot-name">${slot.name || '(default)'}</span>
                ${
                  slot.slottedRuleCount > 0
                    ? html`<span
                      class="slot-rules"
                      title=${`${slot.slottedRuleCount} ::slotted rule(s) target this shadow root`}
                    >
                      ${slot.slottedRuleCount} ::slotted
                    </span>`
                    : nothing
                }
              </div>
              ${
                slot.assignedNodes.length > 0
                  ? html`
                    <div class="slot-section">
                      <span class="slot-section-label">Assigned</span>
                      ${repeat(
                        slot.assignedNodes,
                        (tag, i) => `a-${i}-${tag}`,
                        (tag) => html`<span class="slot-tag">&lt;${tag}&gt;</span>`,
                      )}
                    </div>
                  `
                  : slot.fallbackNodes.length > 0
                    ? html`
                      <div class="slot-section slot-section--fallback">
                        <span class="slot-section-label">Fallback</span>
                        ${repeat(
                          slot.fallbackNodes,
                          (tag, i) => `f-${i}-${tag}`,
                          (tag) => html`<span class="slot-tag">&lt;${tag}&gt;</span>`,
                        )}
                      </div>
                    `
                    : html`<div class="slot-empty">Empty.</div>`
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
    'wc-tab-slots': WcTabSlots;
  }
}
