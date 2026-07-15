import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { framesInWindow, type ProfilingState } from '../../../lib/profiling';
import type { WCNode } from '../../../types/wc';
import { findNode } from '../utils';

@customElement('wc-profiling-panel')
export class WcProfilingPanel extends LitElement {
  @property({ attribute: false }) state: ProfilingState = { frames: [] };
  @property({ attribute: false }) tree: WCNode[] = [];
  @property({ type: Number }) windowMs = 5000;

  @state() private _tick = 0;
  private _timer: ReturnType<typeof setInterval> | null = null;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._timer = setInterval(() => {
      this._tick++;
    }, 500);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
  }

  private get recent(): { id: string; count: number; node: WCNode }[] {
    void this._tick;
    const frames = framesInWindow(this.state, this.windowMs, Date.now());
    const counts = new Map<string, number>();
    for (const f of frames) {
      for (const [id, n] of f.counts) counts.set(id, (counts.get(id) ?? 0) + n);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count, node: findNode(this.tree, id) }))
      .filter((x): x is { id: string; count: number; node: WCNode } => Boolean(x.node))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
  }

  private bar(count: number, max: number): string {
    if (max === 0) return '0%';
    return `${Math.round((count / max) * 100)}%`;
  }

  private onSelect(id: string): void {
    this.dispatchEvent(
      new CustomEvent('select', { detail: { id }, bubbles: true, composed: true }),
    );
  }

  render() {
    const recent = this.recent;
    const max = recent[0]?.count ?? 0;
    const seconds = this.windowMs / 1000;
    return html`
      <div class="profiling-panel">
        <div class="profiling-header">
          <span>Recent re-renders (${seconds}s window)</span>
          <span class="profiling-total">
            ${recent.length} component${recent.length === 1 ? '' : 's'}
          </span>
        </div>
        ${
          recent.length === 0
            ? html`<div class="empty-state empty-state--small">No re-renders captured yet.</div>`
            : html`
              <div class="profiling-list">
                ${repeat(
                  recent,
                  (row) => row.id,
                  (row) => html`
                    <button
                      class="profiling-row"
                      aria-label=${`Inspect ${row.node.tagName}, ${row.count} re-renders`}
                      @click=${() => this.onSelect(row.id)}
                    >
                      <span class="profiling-tag">&lt;${row.node.tagName}&gt;</span>
                      <span class="profiling-bar">
                        <span
                          class="profiling-bar-fill"
                          style=${`width: ${this.bar(row.count, max)}`}
                        ></span>
                      </span>
                      <span class="profiling-count">${row.count}</span>
                    </button>
                  `,
                )}
              </div>
            `
        }
        ${nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-profiling-panel': WcProfilingPanel;
  }
}
