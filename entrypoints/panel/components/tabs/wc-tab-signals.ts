import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { WCNode } from '../../../../types/wc';
import '../wc-prop-value';

@customElement('wc-tab-signals')
export class WcTabSignals extends LitElement {
  @property({ attribute: false }) node!: WCNode;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  private get isEmpty(): boolean {
    const n = this.node;
    return (
      (!n.signals || n.signals.length === 0) &&
      (!n.contextRequests || n.contextRequests.length === 0) &&
      (!n.tasks || n.tasks.length === 0)
    );
  }

  render() {
    if (this.isEmpty) {
      return html`<div class="empty-state empty-state--small">
        No signals, context requests, or tasks on this component.
      </div>`;
    }
    const n = this.node;
    return html`
      <div class="signals-content">
        ${
          n.signals?.length
            ? html`
              <section class="signals-section">
                <h4 class="signals-heading">Signals</h4>
                <div class="signals-list">
                  ${repeat(
                    n.signals,
                    (s) => s.label,
                    (sig) => html`
                      <div class="signal-row">
                        <span class="signal-pulse"></span>
                        <span class="signal-label">${sig.label}</span>
                        <wc-prop-value .value=${sig.value}></wc-prop-value>
                      </div>
                    `,
                  )}
                </div>
              </section>
            `
            : nothing
        }
        ${
          n.contextRequests?.length
            ? html`
              <section class="signals-section">
                <h4 class="signals-heading">Context requests</h4>
                <div class="context-list">
                  ${repeat(
                    n.contextRequests,
                    (c) => c.key,
                    (ctx) => html`
                      <div class="context-row">
                        <span class="context-key">${ctx.key}</span>
                        ${
                          ctx.providerTag
                            ? html`<span class="context-provider">
                              provider: &lt;${ctx.providerTag}&gt;
                            </span>`
                            : nothing
                        }
                      </div>
                    `,
                  )}
                </div>
              </section>
            `
            : nothing
        }
        ${
          n.tasks?.length
            ? html`
              <section class="signals-section">
                <h4 class="signals-heading">Tasks</h4>
                <div class="tasks-list">
                  ${repeat(
                    n.tasks,
                    (t) => t.label,
                    (task) => html`
                      <div class="task-row">
                        <span class="task-label">${task.label}</span>
                        <span class="task-status task-status--${task.status}">
                          ${task.status}
                        </span>
                        ${
                          task.status === 'complete' && task.value !== undefined
                            ? html`<wc-prop-value .value=${task.value}></wc-prop-value>`
                            : task.status === 'error'
                              ? html`<span class="task-error" title=${task.error}>
                                ${task.error}
                              </span>`
                              : nothing
                        }
                      </div>
                    `,
                  )}
                </div>
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
    'wc-tab-signals': WcTabSignals;
  }
}
