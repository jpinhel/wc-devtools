import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { SerializableValue, WCNode } from '../../../../types/wc';
import { icon } from '../../icons';

interface Baseline {
  properties: Record<string, SerializableValue>;
  attributes: Record<string, string>;
}

@customElement('wc-tab-attrs')
export class WcTabAttrs extends LitElement {
  @property({ attribute: false }) node!: WCNode;
  @property({ attribute: false }) lastResult: {
    attrName: string;
    success: boolean;
    error?: string;
  } | null = null;
  @property({ attribute: false }) baseline: Baseline | null = null;

  @state() private editing: string | null = null;
  @state() private editValue = '';
  @state() private newName = '';
  @state() private newValue = '';

  private prevNodeId: string | null = null;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('node') && this.node?.id !== this.prevNodeId) {
      this.editing = null;
      this.editValue = '';
      this.prevNodeId = this.node?.id ?? null;
    }
  }

  private emit(name: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private startEdit(name: string, current: string): void {
    this.editing = name;
    this.editValue = current;
  }

  private cancelEdit(): void {
    this.editing = null;
    this.editValue = '';
  }

  private commit(name: string): void {
    if (this.editing === name) {
      this.emit('set-attr', { nodeId: this.node.id, attrName: name, value: this.editValue });
    }
    this.editing = null;
    this.editValue = '';
  }

  private add(): void {
    if (!this.newName) return;
    this.emit('set-attr', { nodeId: this.node.id, attrName: this.newName, value: this.newValue });
    this.newName = '';
    this.newValue = '';
  }

  private rowClass(name: string): string {
    const cls = ['prop-row'];
    if (this.lastResult?.attrName === name && this.lastResult?.success) cls.push('edit-ok');
    if (this.lastResult?.attrName === name && !this.lastResult?.success) cls.push('edit-err');
    return cls.join(' ');
  }

  render() {
    const entries = Object.entries(this.node.attributes);
    return html`
      <div class="attrs-pane">
        <table class="prop-table">
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
          ${repeat(
            entries,
            ([name]) => name,
            ([name, value]) => html`
              <tr class=${this.rowClass(name)}>
                <td class="prop-name" title=${name}>${name}</td>
                <td class="prop-value">
                  ${
                    this.editing === name
                      ? html`<input
                        .value=${this.editValue}
                        class="prop-edit-input"
                        @input=${(e: Event) => {
                          this.editValue = (e.target as HTMLInputElement).value;
                        }}
                        @keydown=${(e: KeyboardEvent) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            this.commit(name);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            this.cancelEdit();
                          }
                        }}
                        @blur=${() => this.commit(name)}
                      />`
                      : html`
                        <div class="prop-value-row">
                          <span class="pv-edit-wrap" @click=${() => this.startEdit(name, value)}>
                            <span class="prop-val val-string">"${value}"</span>
                          </span>
                          <div class="prop-value-actions">
                            <button
                              class="pv-edit-btn icon-btn"
                              title="Edit value"
                              @click=${() => this.startEdit(name, value)}
                            >
                              ${unsafeHTML(icon('pencil', { size: 11 }))}
                            </button>
                            ${
                              this.baseline &&
                              name in this.baseline.attributes &&
                              this.baseline.attributes[name] !== value
                                ? html`<button
                                  class="prop-reset-btn icon-btn"
                                  title=${`Reset to initial: ${this.baseline.attributes[name]}`}
                                  @click=${() =>
                                    this.emit('set-attr', {
                                      nodeId: this.node.id,
                                      attrName: name,
                                      value: this.baseline?.attributes[name] ?? '',
                                    })}
                                >
                                  ${unsafeHTML(icon('rotate-ccw', { size: 11 }))}
                                </button>`
                                : ''
                            }
                            <button
                              class="attr-remove icon-btn"
                              title=${`Remove ${name}`}
                              @click=${() =>
                                this.emit('remove-attr', { nodeId: this.node.id, attrName: name })}
                            >
                              ${unsafeHTML(icon('trash-2', { size: 11 }))}
                            </button>
                          </div>
                        </div>
                      `
                  }
                </td>
              </tr>
            `,
          )}
        </tbody>
        </table>
        <div class="attr-add-row">
          <input
            .value=${this.newName}
            placeholder="attr-name"
            class="prop-edit-input"
            @input=${(e: Event) => {
              this.newName = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') this.add();
            }}
          />
          <input
            .value=${this.newValue}
            placeholder="value"
            class="prop-edit-input"
            @input=${(e: Event) => {
              this.newValue = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') this.add();
            }}
          />
          <button
            class="attr-add-btn"
            ?disabled=${!this.newName}
            @click=${() => this.add()}
          >
            Add
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-tab-attrs': WcTabAttrs;
  }
}
