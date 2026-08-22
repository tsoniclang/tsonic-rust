import type { ResolvedSourceWellKnownSymbolInfo } from "@tsonic/tsts";

export type RustSourceMemberKey =
  | { readonly kind: "property"; readonly name: string }
  | {
      readonly kind: "well-known-symbol";
      readonly symbol: ResolvedSourceWellKnownSymbolInfo["kind"];
    };

export function rustPropertySourceMemberKey(name: string): RustSourceMemberKey {
  return Object.freeze({ kind: "property", name });
}

export function rustWellKnownSymbolSourceMemberKey(
  symbol: ResolvedSourceWellKnownSymbolInfo["kind"],
): RustSourceMemberKey {
  return Object.freeze({ kind: "well-known-symbol", symbol });
}

export function rustSourceMemberKeysEqual(
  left: RustSourceMemberKey,
  right: RustSourceMemberKey,
): boolean {
  return left.kind === right.kind &&
    (left.kind === "property"
      ? right.kind === "property" && left.name === right.name
      : right.kind === "well-known-symbol" && left.symbol === right.symbol);
}

export function rustSourceMemberKeyText(key: RustSourceMemberKey): string {
  return key.kind === "property"
    ? `property:${key.name}`
    : `well-known-symbol:${key.symbol}`;
}

export function rustSourceMemberDisplayName(key: RustSourceMemberKey): string {
  if (key.kind === "property") {
    return key.name;
  }
  switch (key.symbol) {
    case "async-dispose": return "@@asyncDispose";
    case "async-iterator": return "@@asyncIterator";
    case "dispose": return "@@dispose";
    case "has-instance": return "@@hasInstance";
    case "is-concat-spreadable": return "@@isConcatSpreadable";
    case "iterator": return "@@iterator";
    case "match": return "@@match";
    case "match-all": return "@@matchAll";
    case "replace": return "@@replace";
    case "search": return "@@search";
    case "species": return "@@species";
    case "split": return "@@split";
    case "to-primitive": return "@@toPrimitive";
    case "to-string-tag": return "@@toStringTag";
    case "unscopables": return "@@unscopables";
  }
}

export function rustSourceMemberTargetName(key: RustSourceMemberKey): string {
  if (key.kind === "property") {
    return key.name;
  }
  switch (key.symbol) {
    case "async-dispose": return "symbol_async_dispose";
    case "async-iterator": return "symbol_async_iterator";
    case "dispose": return "symbol_dispose";
    case "has-instance": return "symbol_has_instance";
    case "is-concat-spreadable": return "symbol_is_concat_spreadable";
    case "iterator": return "symbol_iterator";
    case "match": return "symbol_match";
    case "match-all": return "symbol_match_all";
    case "replace": return "symbol_replace";
    case "search": return "symbol_search";
    case "species": return "symbol_species";
    case "split": return "symbol_split";
    case "to-primitive": return "symbol_to_primitive";
    case "to-string-tag": return "symbol_to_string_tag";
    case "unscopables": return "symbol_unscopables";
  }
}
