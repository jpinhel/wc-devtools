import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { WCNode } from '../../../../types/wc';
import '../wc-codemirror-view';

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// Anchored full-match: inspected-page values are interpolated into the panel's
// style attribute, so trailing content (e.g. `rgb(0,0,0) url(...)`) must not pass.
const COLOR_FN_RE = /^(rgb|rgba|hsl|hsla|oklch|color)\([^()]*\)$/i;

function colorSwatch(value: string): string | null {
  const v = value.trim();
  if (HEX_RE.test(v) || COLOR_FN_RE.test(v)) return v;
  return null;
}

@customElement('wc-tab-styles')
export class WcTabStyles extends LitElement {
  @property({ attribute: false }) node!: WCNode;

  @state() private editingVar: string | null = null;
  @state() private editValue = '';

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  private async startVarEdit(name: string, current: string): Promise<void> {
    this.editingVar = name;
    this.editValue = current === '—' ? '' : current;
    await this.updateComplete;
    this.querySelector<HTMLInputElement>('.cssvar-edit-input')?.focus();
  }

  private commitVarEdit(name: string): void {
    // Same double-commit guard as the props tab: Enter → re-render removes the
    // input → Chrome fires blur → would commit again with the cleared value.
    if (this.editingVar !== name) return;
    const value = this.editValue.trim();
    this.dispatchEvent(
      new CustomEvent('set-css-var', {
        // Empty input clears the inline override
        detail: { nodeId: this.node.id, name, value: value === '' ? null : value },
        bubbles: true,
        composed: true,
      }),
    );
    this.editingVar = null;
    this.editValue = '';
  }

  private cancelVarEdit(): void {
    this.editingVar = null;
    this.editValue = '';
  }

  render() {
    const n = this.node;
    const parts = n.parts ?? [];
    const sheets = n.adoptedStyles ?? [];
    const cssVars = n.cssVars ?? [];
    const partCount = parts.length;
    const sheetCount = sheets.length;
    const totalRules = sheets.reduce((sum, s) => sum + s.ruleCount, 0);
    const varCount = cssVars.length;
    return html`
      <div class="styles-content">
        <section class="styles-section">
          <header class="styles-heading-row">
            <h4 class="styles-heading">Parts</h4>
            <span class="styles-meta">
              ${
                partCount === 0
                  ? 'none in this shadow tree'
                  : `${partCount} part${partCount === 1 ? '' : 's'}`
              }
            </span>
          </header>
          ${
            partCount > 0
              ? html`
                <div class="parts-list">
                  ${repeat(
                    parts,
                    (p, i) => `${i}-${p.name}-${p.elementTag}`,
                    (p) => html`
                      <div class="part-row">
                        <span class="part-name">::part(${p.name})</span>
                        <span class="part-host">on &lt;${p.elementTag}&gt;</span>
                        <span class="part-rules ${p.ruleCount === 0 ? 'part-rules--zero' : ''}">
                          ${p.ruleCount} rule${p.ruleCount === 1 ? '' : 's'}
                        </span>
                      </div>
                    `,
                  )}
                </div>
              `
              : nothing
          }
        </section>

        <section class="styles-section">
          <header class="styles-heading-row">
            <h4 class="styles-heading">Adopted Stylesheets</h4>
            <span class="styles-meta">
              ${
                sheetCount === 0
                  ? 'none'
                  : `${sheetCount} sheet${sheetCount === 1 ? '' : 's'} · ${totalRules} rule${totalRules === 1 ? '' : 's'}`
              }
            </span>
          </header>
          ${
            sheetCount > 0
              ? html`
                <div class="adopted-list">
                  ${repeat(
                    sheets,
                    (_s, i) => i,
                    (s, i) => html`
                      <details class="adopted-row" ?open=${i === 0}>
                        <summary class="adopted-summary">
                          <span class="adopted-name">Sheet #${i + 1}</span>
                          <span class="adopted-summary-meta">
                            ${s.ruleCount} rule${s.ruleCount === 1 ? '' : 's'}
                          </span>
                        </summary>
                        <wc-codemirror-view
                          .value=${s.cssText}
                          language="css"
                          .readonly=${true}
                          .maxHeight=${240}
                        ></wc-codemirror-view>
                      </details>
                    `,
                  )}
                </div>
              `
              : nothing
          }
        </section>

        <section class="styles-section">
          <header class="styles-heading-row">
            <h4 class="styles-heading">CSS Custom Properties</h4>
            <span class="styles-meta">
              ${varCount === 0 ? 'none' : varCount}
            </span>
          </header>
          ${
            varCount > 0
              ? html`
                <table class="prop-table prop-table--cssvars">
                  <thead>
                    <tr>
                      <th>Variable</th>
                      <th>Computed</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${repeat(
                      cssVars,
                      (v) => v.name,
                      (v) => {
                        const computed = v.computedValue.trim() || '—';
                        const swatch = colorSwatch(computed);
                        const origin = v.declaredOnHost ? 'host' : 'inherited';
                        const originTitle = v.declaredOnHost
                          ? 'Origin: host (declared on this component)'
                          : 'Origin: inherited (from an ancestor)';
                        return html`
                          <tr
                            class="prop-row prop-row--origin-${origin}"
                            title=${originTitle}
                          >
                            <td class="prop-name">
                              <span class="prop-name-text">${v.name}</span>
                            </td>
                            <td class="prop-value">
                              ${
                                this.editingVar === v.name
                                  ? html`<input
                                    .value=${this.editValue}
                                    class="cssvar-edit-input"
                                    spellcheck="false"
                                    placeholder="value — empty clears the override"
                                    @input=${(e: Event) => {
                                      this.editValue = (e.target as HTMLInputElement).value;
                                    }}
                                    @keydown=${(e: KeyboardEvent) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        this.commitVarEdit(v.name);
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        this.cancelVarEdit();
                                      }
                                    }}
                                    @blur=${() => this.commitVarEdit(v.name)}
                                  />`
                                  : html`<span
                                    class="prop-val prop-val--editable"
                                    title="Click to set this variable on the host (inline style)"
                                    @click=${() => this.startVarEdit(v.name, computed)}
                                  >
                                    ${
                                      swatch
                                        ? html`<span
                                            class="css-swatch"
                                            style=${`background: ${swatch}`}
                                          ></span>`
                                        : nothing
                                    }
                                    <span class="val-string">${computed}</span>
                                  </span>`
                              }
                            </td>
                          </tr>
                        `;
                      },
                    )}
                  </tbody>
                </table>
              `
              : nothing
          }
        </section>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-tab-styles': WcTabStyles;
  }
}
