export const nativeIdentity = index => ({ krate: 0, index });

export function nativeDefinition(index, kind) {
  return {
    id: nativeIdentity(index),
    stable: { krate: "0123456789abcdef", path: index.toString(16).padStart(16, "0") },
    parent: index === 0 ? null : nativeIdentity(0), path: `crate::item${index}`, name: `item${index}`,
    kind, macroKinds: [], type: null, generics: null, visibility: null, source: null,
  };
}

export function nativeEvidenceFixture() {
  return {
    phase: "declarations", root: nativeIdentity(0), items: [nativeIdentity(0)],
    inputs: [], probes: [], types: [], constants: [], expansions: [],
    definitions: [nativeDefinition(0, "module")],
    scopes: [{ kind: "named", owner: nativeIdentity(0), bindings: [], ambiguities: [] }],
  };
}
