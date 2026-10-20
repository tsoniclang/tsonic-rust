import type { RustLifetimeRef } from "../../lifetimes/index.js";
import { rustLifetimeKey, rustPlaceholderLifetime } from "../../lifetimes/index.js";

import type { TargetTypeRef } from "../model.js";

import { substituteRustTargetGenerics } from "./substitution.js";

export function substituteElidedLifetime(type: TargetTypeRef, lifetime: RustLifetimeRef): TargetTypeRef {
  return substituteRustTargetGenerics(type, new Map(),
    new Map([[rustLifetimeKey(rustPlaceholderLifetime), lifetime]]), new Map(), (selected, source) => {
      if (source.kind === "function-pointer" || source.kind === "closure") return source;
      return selected.kind === "reference" && selected.lifetime === undefined ? { ...selected, lifetime } : selected;
    });
}
