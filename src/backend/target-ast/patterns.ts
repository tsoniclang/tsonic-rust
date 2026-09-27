import type { RustPattern } from "./nodes.js";

export function rustPatternBindsName(pattern: RustPattern, name: string): boolean | undefined {
  return rustPatternBindings(pattern)?.some(binding => binding.name === name);
}

export function rustParametersBindName(parameters: readonly { readonly pattern: RustPattern }[], name: string): boolean | undefined {
  let found = false;
  for (const parameter of parameters) {
    const bindings = rustPatternBindings(parameter.pattern);
    if (bindings === undefined) return undefined;
    found ||= bindings.some(binding => binding.name === name);
  }
  return found;
}

export function rustPatternBindings(pattern: RustPattern): readonly Extract<RustPattern, { kind: "binding" }>[] | undefined {
  switch (pattern.kind) {
    case "binding": return [pattern];
    case "reference": return rustPatternBindings(pattern.pattern);
    case "tuple":
    case "tuple-variant": return collectBindings(pattern.elements);
    case "or": return collectBindings(pattern.alternatives);
    case "path":
    case "wildcard": return [];
    case "macro-invocation": return undefined;
  }
}

function collectBindings(patterns: readonly RustPattern[]): ReturnType<typeof rustPatternBindings> {
  const bindings: Extract<RustPattern, { kind: "binding" }>[] = [];
  for (const pattern of patterns) {
    const selected = rustPatternBindings(pattern);
    if (selected === undefined) return undefined;
    bindings.push(...selected);
  }
  return bindings;
}
