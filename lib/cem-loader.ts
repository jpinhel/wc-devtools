import type { CemElement, CemIndex } from '../types/wc';

interface RawCemDeclaration {
  kind?: string;
  tagName?: string;
  description?: string;
  attributes?: Array<{
    name: string;
    type?: { text?: string };
    default?: string;
    description?: string;
    fieldName?: string;
  }>;
  events?: Array<{ name: string; type?: { text?: string }; description?: string }>;
  slots?: Array<{ name?: string; description?: string }>;
  cssParts?: Array<{ name: string; description?: string }>;
  cssProperties?: Array<{ name: string; description?: string; default?: string }>;
}

interface RawCemModule {
  kind?: string;
  declarations?: RawCemDeclaration[];
}

interface RawCem {
  schemaVersion?: string;
  modules?: RawCemModule[];
}

export function parseCem(raw: unknown): CemIndex {
  const out: CemIndex = new Map();
  if (!raw || typeof raw !== 'object') return out;
  const cem = raw as RawCem;
  if (!Array.isArray(cem.modules)) return out;
  for (const mod of cem.modules) {
    if (!Array.isArray(mod.declarations)) continue;
    for (const decl of mod.declarations) {
      if (decl.kind !== 'class' || !decl.tagName) continue;
      out.set(decl.tagName, {
        tagName: decl.tagName,
        description: decl.description,
        attributes: decl.attributes?.map((a) => ({
          name: a.name,
          type: a.type?.text,
          default: a.default,
          description: a.description,
          fieldName: a.fieldName,
        })),
        events: decl.events?.map((e) => ({
          name: e.name,
          type: e.type?.text,
          description: e.description,
        })),
        slots: decl.slots?.map((s) => ({ name: s.name, description: s.description })),
        cssParts: decl.cssParts?.map((p) => ({ name: p.name, description: p.description })),
        cssProperties: decl.cssProperties?.map((p) => ({
          name: p.name,
          description: p.description,
          default: p.default,
        })),
      } satisfies CemElement);
    }
  }
  return out;
}
