import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { EventLogEntry, SerializableValue, WCNode } from '../../../../types/wc';
import { icon } from '../../icons';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function formatDetail(detail: SerializableValue): string {
  if (detail === null) return '';
  if (typeof detail === 'object') return JSON.stringify(detail);
  return String(detail);
}

@customElement('wc-tab-events')
export class WcTabEvents extends LitElement {
  @property({ attribute: false }) node!: WCNode;
  @property({ attribute: false }) eventLog: EventLogEntry[] = [];

  @state() private dispatchType = '';
  @state() private dispatchDetail = '';
  @state() private dispatchError: string | null = null;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  private get nodeEvents(): EventLogEntry[] {
    return this.eventLog.filter((e) => e.nodeId === this.node.id);
  }

  private clear(): void {
    this.dispatchEvent(new CustomEvent('clear-events', { bubbles: true, composed: true }));
  }

  private dispatchToComponent(): void {
    const eventType = this.dispatchType.trim();
    if (eventType === '') return;
    let detail: SerializableValue = null;
    const raw = this.dispatchDetail.trim();
    if (raw !== '') {
      try {
        detail = JSON.parse(raw) as SerializableValue;
      } catch {
        this.dispatchError = 'Invalid detail — must be JSON';
        return;
      }
    }
    this.dispatchError = null;
    this.dispatchEvent(
      new CustomEvent('dispatch-event', {
        detail: { nodeId: this.node.id, eventType, detail },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderDispatchForm() {
    return html`
      <div class="event-dispatch-row">
        <input
          class="event-dispatch-input event-dispatch-input--type"
          type="text"
          placeholder="event-type"
          spellcheck="false"
          .value=${this.dispatchType}
          @input=${(e: Event) => {
            this.dispatchType = (e.target as HTMLInputElement).value;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') this.dispatchToComponent();
          }}
        />
        <input
          class="event-dispatch-input event-dispatch-input--detail"
          type="text"
          placeholder='detail JSON (optional), e.g. {"value": 1}'
          spellcheck="false"
          .value=${this.dispatchDetail}
          @input=${(e: Event) => {
            this.dispatchDetail = (e.target as HTMLInputElement).value;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') this.dispatchToComponent();
          }}
        />
        <button
          class="icon-btn event-dispatch-btn"
          title="Dispatch a CustomEvent on this component (bubbles, composed)"
          ?disabled=${this.dispatchType.trim() === ''}
          @click=${() => this.dispatchToComponent()}
        >
          ${unsafeHTML(icon('play', { size: 11 }))} Dispatch
        </button>
      </div>
      ${
        this.dispatchError
          ? html`<div class="event-dispatch-error">${this.dispatchError}</div>`
          : nothing
      }
    `;
  }

  render() {
    const events = this.nodeEvents;
    return html`
      ${this.renderDispatchForm()}
      <div class="events-toolbar">
        <span class="events-count">
          ${events.length} event${events.length !== 1 ? 's' : ''}
        </span>
        <button
          class="clear-btn icon-btn"
          ?disabled=${events.length === 0}
          @click=${() => this.clear()}
        >
          ${unsafeHTML(icon('trash-2', { size: 11 }))} Clear
        </button>
      </div>
      ${
        events.length === 0
          ? html`<div class="empty-state empty-state--small">
            No CustomEvents dispatched yet.
          </div>`
          : html`
            <div class="events-list">
              ${repeat(
                [...events].reverse(),
                (_e, i) => i,
                (entry, idx) => html`
                  <div class="event-row" data-fresh=${idx < 3 ? 'true' : 'false'}>
                    <span class="event-dot"></span>
                    <span class="event-type-badge">${entry.eventType}</span>
                    <span class="event-detail">
                      ${entry.detail !== null ? formatDetail(entry.detail) : ''}
                    </span>
                    ${
                      entry.bubbles
                        ? html`<span class="event-bubbles" title="bubbles">↑</span>`
                        : html`<span></span>`
                    }
                    <span class="event-time">${formatTime(entry.timestamp)}</span>
                  </div>
                `,
              )}
            </div>
          `
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-tab-events': WcTabEvents;
  }
}
