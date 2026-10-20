import type { Node } from "@tsonic/tsts";
import type { RustSafetyOperation } from "./safety.js";

export type RustSafetyPlacement = "declaration" | "constructor" | "getter" | "setter";

export interface RustSafetyEmission {
  readonly nativePointer: boolean;
  readonly unusedUnsafe: boolean;
}

export interface RustSafetyEmissionRecords {
  readonly safetyOperation: { readonly get: (node: Node) => RustSafetyOperation | undefined };
  readonly declarationSafety: { readonly get: (node: Node, placement: RustSafetyPlacement) => boolean | undefined };
  readonly callSafety: { readonly get: (node: Node) => boolean | undefined };
  readonly accessorSafety: { readonly get: (node: Node, role: "getter" | "setter") => boolean | undefined };
  readonly safetyAttributes: { readonly get: (node: Node) => RustSafetyEmission | undefined };
}
