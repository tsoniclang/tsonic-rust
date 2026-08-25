export type RustCfgPredicate =
  | { readonly kind: "flag"; readonly name: string }
  | { readonly kind: "key-value"; readonly name: string; readonly value: string }
  | { readonly kind: "all" | "any"; readonly predicates: readonly RustCfgPredicate[] }
  | { readonly kind: "not"; readonly predicate: RustCfgPredicate };

export type RustRepresentation =
  | { readonly kind: "c" | "transparent" | "simd" }
  | { readonly kind: "integer"; readonly type: string }
  | { readonly kind: "packed"; readonly alignment?: bigint }
  | { readonly kind: "align"; readonly alignment: bigint };

export type RustAttribute =
  | {
      readonly kind: "lint";
      readonly level: "allow" | "expect" | "warn" | "deny";
      readonly lint: string;
      readonly reason?: string;
    }
  | { readonly kind: "doc-hidden" }
  | { readonly kind: "derive"; readonly traits: readonly string[] }
  | { readonly kind: "cfg"; readonly predicate: RustCfgPredicate }
  | { readonly kind: "repr"; readonly representations: readonly RustRepresentation[] }
  | { readonly kind: "inline"; readonly mode: "hint" | "always" | "never" }
  | { readonly kind: "cold" }
  | { readonly kind: "must-use"; readonly message?: string }
  | { readonly kind: "non-exhaustive" }
  | { readonly kind: "no-mangle" }
  | { readonly kind: "export-name"; readonly name: string }
  | { readonly kind: "link-name"; readonly name: string }
  | { readonly kind: "target-feature"; readonly feature: string };

export interface RustScopedAttribute {
  readonly style: "outer" | "inner";
  readonly attribute: RustAttribute;
}

export const rustDocHiddenAttribute: RustAttribute = Object.freeze({
  kind: "doc-hidden",
});

export function rustDeriveAttribute(...traits: readonly string[]): RustAttribute {
  if (traits.length === 0) {
    throw new Error("A Rust derive attribute requires at least one trait.");
  }
  return Object.freeze({ kind: "derive", traits: Object.freeze([...traits]) });
}

export function rustAttributeKey(attribute: RustAttribute): string {
  switch (attribute.kind) {
    case "lint":
      return `lint:${attribute.level}:${attribute.lint}:${attribute.reason ?? ""}`;
    case "doc-hidden":
    case "cold":
    case "non-exhaustive":
    case "no-mangle":
      return attribute.kind;
    case "derive":
      return `derive:${attribute.traits.join(",")}`;
    case "cfg":
      return `cfg:${rustCfgPredicateKey(attribute.predicate)}`;
    case "repr":
      return `repr:${attribute.representations.map((value) =>
        value.kind === "packed" || value.kind === "align"
          ? `${value.kind}:${value.alignment?.toString() ?? ""}`
          : value.kind === "integer" ? `integer:${value.type}` : value.kind).join(",")}`;
    case "inline":
      return `inline:${attribute.mode}`;
    case "must-use":
      return `must-use:${attribute.message ?? ""}`;
    case "export-name":
    case "link-name":
      return `${attribute.kind}:${attribute.name}`;
    case "target-feature":
      return `target-feature:${attribute.feature}`;
  }
}

function rustCfgPredicateKey(predicate: RustCfgPredicate): string {
  switch (predicate.kind) {
    case "flag": return `flag:${predicate.name}`;
    case "key-value": return `key-value:${predicate.name}:${predicate.value}`;
    case "not": return `not:${rustCfgPredicateKey(predicate.predicate)}`;
    case "all":
    case "any":
      return `${predicate.kind}:${predicate.predicates.map(rustCfgPredicateKey).join(",")}`;
  }
}
