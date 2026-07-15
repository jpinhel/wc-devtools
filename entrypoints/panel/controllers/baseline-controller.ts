import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { SerializableValue, WCNode } from '../../../types/wc';

export interface NodeBaseline {
  properties: Record<string, SerializableValue>;
  attributes: Record<string, string>;
}

export class BaselineController implements ReactiveController {
  baselines = new Map<string, NodeBaseline>();

  constructor(private host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {}
  hostDisconnected(): void {}

  observe(tree: WCNode[]): void {
    let changed = false;
    const seen = new Set<string>();
    const visit = (nodes: WCNode[]): void => {
      for (const n of nodes) {
        seen.add(n.id);
        if (!this.baselines.has(n.id)) {
          this.baselines.set(n.id, {
            properties: { ...n.properties },
            attributes: { ...n.attributes },
          });
          changed = true;
        }
        if (n.children.length) visit(n.children);
        if (Array.isArray(n.shadowRoot) && n.shadowRoot.length) visit(n.shadowRoot);
      }
    };
    visit(tree);
    for (const id of [...this.baselines.keys()]) {
      if (!seen.has(id)) {
        this.baselines.delete(id);
        changed = true;
      }
    }
    if (changed) this.host.requestUpdate();
  }

  reset(): void {
    if (this.baselines.size === 0) return;
    this.baselines = new Map();
    this.host.requestUpdate();
  }
}
