import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { CemElement } from '../../../../types/wc';

@customElement('wc-tab-cem')
export class WcTabCem extends LitElement {
  @property({ attribute: false }) cem!: CemElement;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  /** One documented member: name + type + default on one line, description below. */
  private docRow(opts: {
    name: string;
    type?: string;
    defaultValue?: string;
    description?: string;
  }) {
    return html`
      <div class="cem-doc-row">
        <div class="cem-doc-head">
          <span class="cem-name" title=${opts.name}>${opts.name}</span>
          ${opts.type ? html`<code class="cem-type">${opts.type}</code>` : nothing}
          ${
            opts.defaultValue !== undefined && opts.defaultValue !== ''
              ? html`<span class="cem-default">default <code>${opts.defaultValue}</code></span>`
              : nothing
          }
        </div>
        ${opts.description ? html`<p class="cem-doc-desc">${opts.description}</p>` : nothing}
      </div>
    `;
  }

  render() {
    const cem = this.cem;
    return html`
      <div class="cem-content">
        ${cem.description ? html`<p class="cem-description">${cem.description}</p>` : nothing}
        ${
          cem.attributes?.length
            ? html`
              <section class="cem-section">
                <h4 class="cem-heading">Attributes</h4>
                ${repeat(
                  cem.attributes,
                  (a) => a.name,
                  (a) =>
                    this.docRow({
                      name: a.name,
                      type: a.type,
                      defaultValue: a.default,
                      description: a.description,
                    }),
                )}
              </section>
            `
            : nothing
        }
        ${
          cem.events?.length
            ? html`
              <section class="cem-section">
                <h4 class="cem-heading">Events</h4>
                ${repeat(
                  cem.events,
                  (e) => e.name,
                  (e) => this.docRow({ name: e.name, type: e.type, description: e.description }),
                )}
              </section>
            `
            : nothing
        }
        ${
          cem.slots?.length
            ? html`
              <section class="cem-section">
                <h4 class="cem-heading">Slots</h4>
                ${repeat(
                  cem.slots,
                  (_s, i) => i,
                  (s) => this.docRow({ name: s.name || '(default)', description: s.description }),
                )}
              </section>
            `
            : nothing
        }
        ${
          cem.cssParts?.length
            ? html`
              <section class="cem-section">
                <h4 class="cem-heading">CSS Parts</h4>
                ${repeat(
                  cem.cssParts,
                  (p) => p.name,
                  (p) => this.docRow({ name: `::part(${p.name})`, description: p.description }),
                )}
              </section>
            `
            : nothing
        }
        ${
          cem.cssProperties?.length
            ? html`
              <section class="cem-section">
                <h4 class="cem-heading">CSS Custom Properties</h4>
                ${repeat(
                  cem.cssProperties,
                  (p) => p.name,
                  (p) =>
                    this.docRow({
                      name: p.name,
                      defaultValue: p.default,
                      description: p.description,
                    }),
                )}
              </section>
            `
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-tab-cem': WcTabCem;
  }
}
