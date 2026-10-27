import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustFlowReadProjectionFact, RustProjectUpcastFact, RustContextualValueConversionFact, RustOptionProjectionFact } from "./value-projections.js";
import type { RustProjectDowncastFact } from "../../types/project-projections.js";
import type { RustObjectReferenceView } from "./object-reference-views.js";

export interface RustValueProjection {
  readonly exits: boolean;
  readonly flow: RustFlowReadProjectionFact | undefined;
  readonly upcast: RustProjectUpcastFact | undefined;
  readonly downcast: RustProjectDowncastFact | undefined;
  readonly object: RustObjectReferenceView | undefined;
  readonly contextual: RustContextualValueConversionFact | undefined;
  readonly option: RustOptionProjectionFact | undefined;
  readonly fused: Extract<RustFlowReadProjectionFact, { readonly kind: "union-map" }> | undefined;
  readonly borrowable: boolean;
  readonly borrowedOptionIdentity: boolean;
  readonly borrowConversion: boolean;
  readonly referenceReborrow: boolean;
  readonly contextualIdentity: boolean;
  /** The applied contextual conversion takes its source by value (`JsValue::from(handle)`), even when its result is borrowed. */
  readonly contextualConsumesSource: boolean;
  readonly preserveAbsenceEffect: boolean;
  readonly absenceDiscard: "unit" | "value";
}

export type RustProjectUpcastEmission =
  | { readonly kind: "union"; readonly variants: readonly { readonly name: string; readonly fact: RustProjectUpcastFact }[] }
  | { readonly kind: "object"; readonly structural: boolean };

export interface RustValueProjectionRecords {
  readonly valueProjection: { readonly get: (node: Node, input?: TargetTypeRef) => RustValueProjection | undefined };
  readonly projectUpcastEmission: { readonly get: (fact: RustProjectUpcastFact) => RustProjectUpcastEmission | undefined };
}
