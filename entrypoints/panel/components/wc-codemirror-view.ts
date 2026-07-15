import type { EditorView as EditorViewType } from '@codemirror/view';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('wc-codemirror-view')
export class WcCodemirrorView extends LitElement {
  @property({ type: String }) value = '';
  @property({ type: String }) language: 'css' | 'json' = 'json';
  @property({ type: Boolean }) readonly = false;
  @property({ type: Number }) maxHeight?: number;

  // Light DOM so the global panel stylesheet applies without changes.
  protected createRenderRoot(): HTMLElement {
    return this;
  }

  private _view: EditorViewType | null = null;
  private _observer: MutationObserver | null = null;
  private _mq: MediaQueryList | null = null;
  private _currentTheme: 'dark' | 'light' = 'light';
  /** Set to true while we are programmatically dispatching a doc change. */
  private _programmatic = false;

  private _detectTheme(): 'dark' | 'light' {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark') return 'dark';
    if (explicit === 'light') return 'light';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private async _buildExtensions(theme: 'dark' | 'light') {
    const [cmView, cmCommands, langModule] = await Promise.all([
      import('@codemirror/view'),
      import('@codemirror/commands'),
      this.language === 'css' ? import('@codemirror/lang-css') : import('@codemirror/lang-json'),
    ]);
    const { EditorView, keymap, lineNumbers } = cmView;
    const { defaultKeymap, history, historyKeymap } = cmCommands;

    const themeExt =
      theme === 'dark'
        ? (await import('@codemirror/theme-one-dark')).oneDark
        : EditorView.theme(
            {
              '&': { backgroundColor: '#ffffff', color: '#1a1a1a' },
              '.cm-gutters': {
                backgroundColor: '#f5f5f5',
                color: '#888',
                borderRight: '1px solid #e0e0e0',
              },
              '.cm-activeLine': { backgroundColor: '#f0f4f8' },
              '.cm-activeLineGutter': { backgroundColor: '#e0e0e0' },
              '.cm-content': { caretColor: '#1a1a1a' },
            },
            { dark: false },
          );

    const langExt =
      this.language === 'css'
        ? (langModule as Awaited<typeof import('@codemirror/lang-css')>).css()
        : (langModule as Awaited<typeof import('@codemirror/lang-json')>).json();

    return {
      EditorView,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        langExt,
        themeExt,
        EditorView.editable.of(!this.readonly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !this.readonly && !this._programmatic) {
            this.dispatchEvent(
              new CustomEvent('update', {
                detail: { value: update.state.doc.toString() },
                bubbles: true,
                composed: true,
              }),
            );
          }
        }),
        EditorView.theme({
          '&': {
            fontSize: '11px',
            maxHeight: this.maxHeight ? `${this.maxHeight}px` : '300px',
          },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
    };
  }

  private async _mountEditor(initialDoc: string): Promise<void> {
    const container = this.querySelector<HTMLDivElement>('.cm-host');
    if (!container) return;
    const { EditorState } = await import('@codemirror/state');
    const { EditorView, extensions } = await this._buildExtensions(this._currentTheme);
    const state = EditorState.create({ doc: initialDoc, extensions });
    this._view = new EditorView({ state, parent: container });
  }

  private async _recreateForTheme(): Promise<void> {
    if (!this._view) return;
    const container = this.querySelector<HTMLDivElement>('.cm-host');
    if (!container) return;
    const currentDoc = this._view.state.doc.toString();
    this._view.destroy();
    this._view = null;
    await this._mountEditor(currentDoc);
  }

  private _onThemeChange = (): void => {
    const next = this._detectTheme();
    if (next !== this._currentTheme) {
      this._currentTheme = next;
      void this._recreateForTheme();
    }
  };

  override firstUpdated(): void {
    this._currentTheme = this._detectTheme();
    void this._mountEditor(this.value);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._observer = new MutationObserver(this._onThemeChange);
    this._observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    this._mq = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    this._mq?.addEventListener('change', this._onThemeChange);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._view?.destroy();
    this._view = null;
    this._observer?.disconnect();
    this._observer = null;
    this._mq?.removeEventListener('change', this._onThemeChange);
    this._mq = null;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('value') && this._view) {
      const current = this._view.state.doc.toString();
      if (current !== this.value) {
        this._programmatic = true;
        this._view.dispatch({
          changes: { from: 0, to: this._view.state.doc.length, insert: this.value },
        });
        this._programmatic = false;
      }
    }
  }

  render() {
    return html`<div class="cm-host"></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wc-codemirror-view': WcCodemirrorView;
  }
}
