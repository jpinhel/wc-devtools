import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { SerializableValue, WCNode } from '../../../../types/wc';
import { icon } from '../../icons';

@customElement('wc-tab-methods')
export class WcTabMethods extends LitElement {
  @property({ attribute: false }) node!: WCNode;
  @property({ attribute: false }) lastResult: {
    methodName: string;
    success: boolean;
    result?: SerializableValue;
    error?: string;
  } | null = null;

  /** Raw args text per method — kept so switching rows doesn't lose input. */
  @state() private argsByMethod: Record<string, string> = {};
  /** Local JSON parse error (never sent to the page). */
  @state() private parseError: { methodName: string; error: string } | null = null;
  /** Method whose args editor is open — one at a time keeps rows compact. */
  @state() private activeMethod: string | null = null;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  private async openArgs(methodName: string): Promise<void> {
    this.activeMethod = methodName;
    await this.updateComplete;
    this.querySelector<HTMLInputElement>('.method-args-input')?.focus();
  }

  private invoke(methodName: string): void {
    const raw = (this.argsByMethod[methodName] ?? '').trim();
    let args: SerializableValue[] = [];
    if (raw !== '') {
      try {
        args = JSON.parse(`[${raw}]`) as SerializableValue[];
      } catch {
        this.parseError = { methodName, error: `Invalid args — use JSON, e.g. 1, "a", {"b": 2}` };
        return;
      }
    }
    this.parseError = null;
    this.activeMethod = null;
    this.dispatchEvent(
      new CustomEvent('invoke-method', {
        detail: { nodeId: this.node.id, methodName, args },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderOutcome(methodName: string) {
    if (this.parseError?.methodName === methodName) {
      return html`<div class="method-result method-result--error">${this.parseError.error}</div>`;
    }
    if (this.lastResult?.methodName !== methodName) return nothing;
    const r = this.lastResult;
    return r.success
      ? html`<div class="method-result">→ ${
          r.result === '[undefined]' ? 'undefined' : JSON.stringify(r.result)
        }</div>`
      : html`<div class="method-result method-result--error">${r.error}</div>`;
  }

  render() {
    if (this.node.methods.length === 0) {
      return html`<div class="empty-state empty-state--small">No custom methods found.</div>`;
    }
    return html`
      <div class="methods-list">
        ${repeat(
          this.node.methods,
          (m) => m,
          (method) => {
            const isActive = this.activeMethod === method;
            const args = (this.argsByMethod[method] ?? '').trim();
            return html`
              <div class="method-row ${isActive ? 'method-row--active' : ''}">
                <span
                  class="method-name method-name--clickable"
                  title="Click to pass arguments"
                  @click=${() => (isActive ? this.invoke(method) : this.openArgs(method))}
                >${method}</span>
                <span class="method-sig">(</span>
                ${
                  isActive
                    ? html`<input
                      class="method-args-input"
                      type="text"
                      placeholder='1, "a", {"b": 2}'
                      spellcheck="false"
                      .value=${this.argsByMethod[method] ?? ''}
                      @input=${(e: Event) => {
                        this.argsByMethod = {
                          ...this.argsByMethod,
                          [method]: (e.target as HTMLInputElement).value,
                        };
                      }}
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === 'Enter') this.invoke(method);
                        else if (e.key === 'Escape') this.activeMethod = null;
                      }}
                    />`
                    : args
                      ? html`<span class="method-args-preview" title=${args}>${args}</span>`
                      : nothing
                }
                <span class="method-sig">)</span>
                <button
                  class="icon-btn method-run-btn"
                  title=${args ? `Invoke ${method}(${args})` : `Invoke ${method}()`}
                  @click=${() => this.invoke(method)}
                >
                  ${unsafeHTML(icon('play', { size: 11 }))}
                </button>
              </div>
              ${this.renderOutcome(method)}
            `;
          },
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-tab-methods': WcTabMethods;
  }
}
