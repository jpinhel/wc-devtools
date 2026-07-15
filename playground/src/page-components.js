/**
 * Demo components for the playground — deliberately exercises every inspector
 * tab: properties/attributes (reflect), methods, events, slots, ::parts,
 * adoptedStyleSheets, CSS custom properties, CustomStateSet, @lit/task and
 * @lit-labs/signals (the Signals tab), plus a self-re-rendering clock for
 * trace updates.
 *
 * Bare imports are bundled locally by `bun build` (see the playground script) —
 * no network dependency.
 */

import { Task } from '@lit/task';
import { SignalWatcher, signal } from '@lit-labs/signals';
import { css, html, LitElement } from 'lit';

// ── <demo-card> — Lit, reflected property, slot, ::part, css custom props ────

class DemoCard extends LitElement {
  static properties = {
    variant: { type: String, reflect: true },
    heading: { type: String },
    elevated: { type: Boolean, reflect: true },
  };

  static styles = css`
    :host {
      display: block;
      width: 240px;
      background: var(--demo-card-bg, #fff);
      border: 1px solid #d9dce6;
      border-left: 4px solid var(--demo-accent, #6473ff);
      border-radius: 8px;
      font-size: 13px;
    }
    :host([variant='primary']) { --demo-accent: #6473ff; }
    :host([variant='neutral']) { --demo-accent: #9aa1b5; }
    :host([variant='danger'])  { --demo-accent: #e5484d; }
    :host([elevated]) { box-shadow: 0 6px 20px rgba(20, 24, 46, 0.14); }
    header { padding: 10px 12px; font-weight: 600; color: var(--demo-accent, #6473ff); }
    .body { padding: 0 12px 12px; line-height: 1.5; }
  `;

  constructor() {
    super();
    this.variant = 'primary';
    this.heading = 'Card';
    this.elevated = false;
  }

  /** Toggles the elevated look — invokable from the Methods tab. */
  toggleElevation() {
    this.elevated = !this.elevated;
    return this.elevated;
  }

  render() {
    return html`
      <header part="heading">${this.heading}</header>
      <div class="body" part="body"><slot></slot></div>
    `;
  }
}
customElements.define('demo-card', DemoCard);

// ── <demo-counter> — vanilla, CustomStateSet, events, methods ─────────────────

const counterSheet = new CSSStyleSheet();
counterSheet.replaceSync(`
  :host { display: inline-block; }
  button {
    font: 600 14px system-ui;
    padding: 10px 16px;
    border-radius: 8px;
    border: 1px solid #d9dce6;
    background: #fff;
    cursor: pointer;
  }
  :host(:state(hot)) button { border-color: #e5484d; color: #e5484d; }
`);

class DemoCounter extends HTMLElement {
  static observedAttributes = ['count'];

  constructor() {
    super();
    this.count = 0;
    this._internals = this.attachInternals();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [counterSheet];
    root.innerHTML = `<button part="button">count is 0</button>`;
    root.querySelector('button').addEventListener('click', () => this.increment());
  }

  /** Increments the counter — also invokable from the Methods tab. */
  increment(by = 1) {
    this.count += by;
    this.setAttribute('count', String(this.count));
    this.shadowRoot.querySelector('button').textContent = `count is ${this.count}`;
    if (this.count >= 5) this._internals.states.add('hot');
    this.dispatchEvent(
      new CustomEvent('count-changed', {
        detail: { count: this.count },
        bubbles: true,
        composed: true,
      }),
    );
    return this.count;
  }

  reset() {
    this.count = -1;
    this._internals.states.delete('hot');
    return this.increment(1) - 1;
  }
}
customElements.define('demo-counter', DemoCounter);

// ── <demo-clock> — re-renders every second (trace updates demo) ───────────────

class DemoClock extends LitElement {
  static properties = { time: { state: true } };

  static styles = css`
    :host {
      display: inline-block;
      font: 600 15px ui-monospace, monospace;
      background: #1a1d27;
      color: #7ee787;
      padding: 12px 16px;
      border-radius: 8px;
    }
  `;

  constructor() {
    super();
    this.time = new Date().toLocaleTimeString();
  }

  connectedCallback() {
    super.connectedCallback();
    this._timer = setInterval(() => {
      this.time = new Date().toLocaleTimeString();
    }, 1000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._timer);
  }

  render() {
    return html`${this.time}`;
  }
}
customElements.define('demo-clock', DemoClock);

// ── <demo-task-user> — @lit/task (Signals tab: task status) ──────────────────

class DemoTaskUser extends LitElement {
  static styles = css`
    :host { display: inline-block; font-size: 13px; background: #fff;
            border: 1px solid #d9dce6; border-radius: 8px; padding: 12px 14px; }
  `;

  constructor() {
    super();
    this._userTask = new Task(this, {
      task: async () => {
        await new Promise((r) => setTimeout(r, 1500));
        return { name: 'Ada Lovelace', role: 'engineer' };
      },
      args: () => [],
    });
  }

  render() {
    return this._userTask.render({
      pending: () => html`Loading user…`,
      complete: (user) => html`<strong>${user.name}</strong> — ${user.role}`,
    });
  }
}
customElements.define('demo-task-user', DemoTaskUser);

// ── <demo-signal-counter> — @lit-labs/signals (Signals tab: live values) ──────

const sharedCount = signal(0);

class DemoSignalCounter extends SignalWatcher(LitElement) {
  static styles = css`
    :host { display: inline-block; font-size: 13px; background: #fff;
            border: 1px solid #d9dce6; border-radius: 8px; padding: 12px 14px; }
    button { margin-left: 8px; cursor: pointer; }
  `;

  constructor() {
    super();
    // Own property so the inspector's signal scan finds it
    this.counter = sharedCount;
  }

  render() {
    return html`
      signal value: <strong>${sharedCount.get()}</strong>
      <button @click=${() => sharedCount.set(sharedCount.get() + 1)}>+1</button>
    `;
  }
}
customElements.define('demo-signal-counter', DemoSignalCounter);
