import { html, LitElement, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { PropChange } from '../../../../lib/render-diff';
import type { SerializableValue, WCNode, WCPropMeta } from '../../../../types/wc';
import { icon } from '../../icons';
import '../wc-codemirror-view';
import '../wc-prop-value';

interface Baseline {
  properties: Record<string, SerializableValue>;
  attributes: Record<string, string>;
}

function isObjectValue(
  v: SerializableValue,
): v is Record<string, SerializableValue> | SerializableValue[] {
  return v !== null && typeof v === 'object';
}

function propKindTitle(meta: WCPropMeta): string {
  if (meta.kind === 'state') return 'Internal state (Lit @state). Not reflected unless declared.';
  if (meta.kind === 'prop') return 'Public reactive property.';
  return 'Observed attribute.';
}

@customElement('wc-tab-props')
export class WcTabProps extends LitElement {
  @property({ attribute: false }) node!: WCNode;
  @property({ attribute: false }) lastResult: {
    propName: string;
    success: boolean;
    error?: string;
  } | null = null;
  @property({ attribute: false }) lastChanges: Record<string, PropChange> = {};
  @property({ attribute: false }) baseline: Baseline | null = null;

  @state() private editingProp: string | null = null;
  @state() private editValue = '';

  private prevNodeId: string | null = null;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('node') && this.node?.id !== this.prevNodeId) {
      this.editingProp = null;
      this.editValue = '';
      this.prevNodeId = this.node?.id ?? null;
    }
  }

  private emit(name: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private async startEdit(propName: string, current: SerializableValue): Promise<void> {
    if (typeof current === 'boolean') {
      this.emit('set-prop', { nodeId: this.node.id, propName, value: !current });
      return;
    }
    this.editingProp = propName;
    this.editValue = isObjectValue(current)
      ? JSON.stringify(current, null, 2)
      : typeof current === 'string'
        ? current
        : JSON.stringify(current);
    await this.updateComplete;
    this.querySelector<HTMLElement>('.prop-edit-input')?.focus();
  }

  private cancelEdit(): void {
    this.editingProp = null;
    this.editValue = '';
  }

  private commitEdit(propName: string): void {
    // Enter commits, then the re-render removes the input, which fires a blur
    // that would commit AGAIN with the already-cleared editValue ('') and
    // overwrite the value just set. Only the active editor may commit.
    if (this.editingProp !== propName) return;
    let value: SerializableValue;
    try {
      value = JSON.parse(this.editValue) as SerializableValue;
    } catch {
      value = this.editValue;
    }
    this.emit('set-prop', { nodeId: this.node.id, propName, value });
    this.editingProp = null;
    this.editValue = '';
  }

  private handleKeydown(e: KeyboardEvent, propName: string): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commitEdit(propName);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelEdit();
    }
  }

  private rowClass(name: string): string {
    const cls = ['prop-row'];
    if (this.lastResult?.propName === name && this.lastResult?.success) cls.push('edit-ok');
    if (this.lastResult?.propName === name && !this.lastResult?.success) cls.push('edit-err');
    if (name in this.lastChanges) cls.push('prop-row--changed');
    return cls.join(' ');
  }

  render() {
    const entries = Object.entries(this.node.properties);
    if (entries.length === 0) {
      return html`<div class="empty-state empty-state--small">No properties exposed.</div>`;
    }
    return html`
      <table class="prop-table">
        <thead>
          <tr>
            <th>Property</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          ${repeat(
            entries,
            ([name]) => name,
            ([name, value]) => this.renderRow(name, value),
          )}
        </tbody>
      </table>
    `;
  }

  private renderRow(name: string, value: SerializableValue) {
    const meta = this.node.propMeta?.[name];
    const change = this.lastChanges[name];
    const showReset =
      this.baseline &&
      name in this.baseline.properties &&
      JSON.stringify(this.baseline.properties[name]) !== JSON.stringify(value);
    return html`
      <tr class=${this.rowClass(name)}>
        <td
          class="prop-name"
          title=${change ? `${name} — was: ${JSON.stringify(change.from)}` : name}
        >
          <span class="prop-name-text">${name}</span>
          ${
            name in this.lastChanges
              ? html`<span class="prop-changed-marker" title="Changed since last snapshot">●</span>`
              : nothing
          }
          ${
            meta
              ? html`<span class="prop-kind prop-kind--${meta.kind}" title=${propKindTitle(meta)}>
                ${meta.kind}
              </span>`
              : nothing
          }
          ${
            meta?.reflects
              ? html`<span class="prop-reflect" title="Reflects to an HTML attribute">↔</span>`
              : nothing
          }
        </td>
        <td class="prop-value">
          ${
            this.editingProp === name && isObjectValue(value)
              ? html`
                <wc-codemirror-view
                  .value=${this.editValue}
                  language="json"
                  .maxHeight=${240}
                  @update=${(e: CustomEvent<{ value: string }>) => {
                    this.editValue = e.detail.value;
                  }}
                ></wc-codemirror-view>
                <div class="prop-edit-actions">
                  <button
                    class="prop-edit-apply"
                    @mousedown=${(e: Event) => {
                      e.preventDefault();
                      this.commitEdit(name);
                    }}
                  >
                    Apply
                  </button>
                  <button
                    class="prop-edit-cancel"
                    @mousedown=${(e: Event) => {
                      e.preventDefault();
                      this.cancelEdit();
                    }}
                  >
                    Cancel
                  </button>
                  <span class="prop-edit-hint">↵ apply · Esc cancel</span>
                </div>
              `
              : this.editingProp === name
                ? html`<input
                  .value=${this.editValue}
                  class="prop-edit-input"
                  @input=${(e: Event) => {
                    this.editValue = (e.target as HTMLInputElement).value;
                  }}
                  @keydown=${(e: KeyboardEvent) => this.handleKeydown(e, name)}
                  @blur=${() => this.commitEdit(name)}
                />`
                : html`
                  <div class="prop-value-row">
                    <span
                      class="pv-edit-wrap"
                      @click=${(e: Event) => {
                        if (e.target === e.currentTarget) this.startEdit(name, value);
                      }}
                    >
                      <wc-prop-value .value=${value}></wc-prop-value>
                    </span>
                    <div class="prop-value-actions">
                      <button
                        class="pv-edit-btn icon-btn"
                        title="Edit value"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this.startEdit(name, value);
                        }}
                      >
                        ${unsafeHTML(icon('pencil', { size: 11 }))}
                      </button>
                      ${
                        showReset
                          ? html`<button
                            class="prop-reset-btn icon-btn"
                            title=${`Reset to initial: ${JSON.stringify(this.baseline?.properties[name])}`}
                            @click=${() =>
                              this.emit('set-prop', {
                                nodeId: this.node.id,
                                propName: name,
                                value: this.baseline?.properties[name] ?? null,
                              })}
                          >
                            ${unsafeHTML(icon('rotate-ccw', { size: 11 }))}
                          </button>`
                          : nothing
                      }
                      ${
                        this.lastResult?.propName === name && !this.lastResult?.success
                          ? html`<span
                            class="edit-error-msg"
                            title=${this.lastResult?.error ?? ''}
                          >
                            ${unsafeHTML(icon('x-circle', { size: 11 }))}
                          </span>`
                          : nothing
                      }
                    </div>
                  </div>
                `
          }
        </td>
      </tr>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-tab-props': WcTabProps;
  }
}
