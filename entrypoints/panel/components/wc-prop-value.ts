import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { SerializableValue } from '../../../types/wc';

const MAX_DEPTH = 5;

function isObj(v: SerializableValue): v is Record<string, SerializableValue> | SerializableValue[] {
  return v !== null && typeof v === 'object';
}

function entries(v: SerializableValue): [string, SerializableValue][] {
  if (Array.isArray(v)) return v.map((x, i) => [String(i), x]);
  if (v !== null && typeof v === 'object')
    return Object.entries(v as Record<string, SerializableValue>);
  return [];
}

function typeLabel(v: SerializableValue): string {
  return Array.isArray(v) ? `Array(${(v as unknown[]).length})` : 'Object';
}

function shortVal(v: SerializableValue): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v.length > 20 ? `${v.slice(0, 20)}…` : v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[…]';
  return '{…}';
}

function preview(v: SerializableValue): string {
  const list = entries(v).slice(0, 3);
  const more = entries(v).length > 3 ? ', …' : '';
  const parts = list.map(([k, val]) =>
    Array.isArray(v) ? shortVal(val) : `${k}: ${shortVal(val)}`,
  );
  return Array.isArray(v) ? `[${parts.join(', ')}${more}]` : `{${parts.join(', ')}${more}}`;
}

function valCls(v: SerializableValue): string {
  if (v === null) return 'val-null';
  if (typeof v === 'string') return 'val-string';
  if (typeof v === 'number') return 'val-number';
  if (typeof v === 'boolean') return 'val-boolean';
  return 'val-object';
}

function fmt(v: SerializableValue): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v.length > 80 ? `${v.slice(0, 80)}…` : v}"`;
  return String(v as string | number | boolean);
}

@customElement('wc-prop-value')
export class WcPropValue extends LitElement {
  @property({ attribute: false }) value: SerializableValue = null;
  @property({ type: Number }) depth = 0;
  @state() private expanded = false;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  render() {
    const v = this.value;
    if (!isObj(v)) {
      return html`<span class="pv-prim ${valCls(v)}">${fmt(v)}</span>`;
    }
    const ents = entries(v);
    return html`
      <span class="pv-obj">
        <button
          class="pv-toggle"
          @click=${(e: Event) => {
            e.stopPropagation();
            this.expanded = !this.expanded;
          }}
          @dblclick=${(e: Event) => e.stopPropagation()}
        >${this.expanded ? '▼' : '▶'}</button>
        <span class="pv-type val-object">${typeLabel(v)}&thinsp;</span>
        <span
          class="pv-preview"
          @click=${(e: Event) => {
            e.stopPropagation();
            this.expanded = !this.expanded;
          }}
          @dblclick=${(e: Event) => e.stopPropagation()}
        >${preview(v)}</span>
        ${
          this.expanded
            ? html`
          <div class="pv-tree">
            ${
              this.depth < MAX_DEPTH
                ? html`
              ${repeat(
                ents,
                ([k]) => k,
                ([k, child]) => html`
                <div class="pv-entry">
                  <span class="pv-key">${k}:&thinsp;</span>
                  <wc-prop-value .value=${child} .depth=${this.depth + 1}></wc-prop-value>
                </div>
              `,
              )}
              ${ents.length === 0 ? html`<div class="pv-empty">empty</div>` : nothing}
            `
                : html`<span class="val-object pv-depth-limit">[…]</span>`
            }
          </div>
        `
            : nothing
        }
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-prop-value': WcPropValue;
  }
}
