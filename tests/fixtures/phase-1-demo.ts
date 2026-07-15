import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('demo-card')
export class DemoCard extends LitElement {
  @property() heading = '';
  static styles = css`
    :host { display: block; padding: 1rem; border-radius: var(--card-radius, 4px); background: var(--card-bg, white); border: 1px solid #ddd; }
    ::slotted(*) { color: navy; }
    h3 { margin: 0 0 .5rem; }
  `;
  render() {
    return html`
      <h3 part="title"><slot name="title">${this.heading}</slot></h3>
      <slot></slot>
      <small part="badge"><slot name="badge">tag</slot></small>
    `;
  }
}

@customElement('demo-toggle')
export class DemoToggle extends LitElement {
  static formAssociated = true;
  @state() private open = false;
  private internals = this.attachInternals();

  static styles = css`
    :host { display: inline-block; cursor: pointer; padding: .5rem 1rem; background: #eee; border-radius: 6px; }
    :host(:--open) { background: #cdf; }
  `;

  render() {
    return html`<slot></slot>`;
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('click', () => {
      this.open = !this.open;
      if (this.open) this.internals.states.add('--open');
      else this.internals.states.delete('--open');
      const id = this.getAttribute('aria-controls');
      if (id) document.getElementById(id)?.toggleAttribute('hidden');
    });
  }
}
