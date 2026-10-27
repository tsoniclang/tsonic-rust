import type { RustArgumentMode } from "../../operations/model.js";
import type { RustContextualValueConversion } from "../../conversions/contextual.js";
import type { RustSourceParameterAbiFact } from "./callables-and-resources.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustValueConversionContract } from "../../conversions/contracts.js";
import { rustRestSequenceElements } from "../../operations/rest-assembly.js";

export type RustCallableValueAdapter =
  | { readonly kind: "absent-completion"; readonly sourceCarrier: TargetTypeRef; readonly targetCarrier: TargetTypeRef; readonly fallible: false }
  | {
      readonly kind: "project-structural-view";
      readonly fallible: false;
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "identity";
      readonly fallible: false;
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "conversion";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly conversion: RustContextualValueConversion;
      readonly fallible: boolean;
      readonly lowering: { readonly kind: "native"; readonly contract: RustValueConversionContract } | { readonly kind: "compiler" };
      readonly upcast?: import("../objects/value-projections.js").RustProjectUpcastFact;
    }
  | {
      readonly kind: "project-upcast";
      readonly fallible: false;
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "call-scoped-lifetime";
      readonly fallible: false;
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "option-some";
      readonly fallible: boolean;
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly element: RustCallableValueAdapter;
    }
  | {
      readonly kind: "option-map";
      readonly lowering: "branch" | "native-option";
      readonly fallible: boolean;
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly element: RustCallableValueAdapter;
    };

export interface RustCallableParameterAbi {
  readonly form: RustSourceParameterAbiFact["form"];
  readonly valueCarrier: TargetTypeRef;
  readonly parameterCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
  readonly entryConversion?: RustSourceParameterAbiFact["entryConversion"];
}

export type RustCallableParameterRead = "value" | "owned-string" | "copy" | "clone";

export interface RustCallableRestIteration {
  readonly collection: "vec" | "js-array";
  readonly elementCarrier: TargetTypeRef;
  readonly mutable: boolean;
  readonly cloneRequirement: TargetTypeRef | undefined;
}

export type RustCallableRestSegment =
  | {
      readonly kind: "value";
      readonly read: RustCallableParameterRead;
      readonly contractParameterIndex: number;
      readonly source: RustCallableParameterAbi;
      readonly adapter: RustCallableValueAdapter;
    }
  | {
      readonly kind: "sequence";
      readonly iteration: RustCallableRestIteration;
      readonly contractParameterIndex: number;
      readonly source: RustCallableParameterAbi;
      readonly offset: number;
      readonly adapter: RustCallableValueAdapter;
    };

export type RustCallableParameterAdapter =
  | {
      readonly kind: "runtime-value";
      readonly fallible: boolean;
      readonly contractParameterIndex: number;
      readonly source: RustCallableParameterAbi;
      readonly target: RustCallableParameterAbi;
      readonly adapter: RustCallableValueAdapter;
    }
  | {
      readonly kind: "logical-value";
      readonly fallible: boolean;
      readonly read: RustCallableParameterRead;
      readonly contractParameterIndex: number;
      readonly source: RustCallableParameterAbi;
      readonly target: RustCallableParameterAbi;
      readonly adapter: RustCallableValueAdapter;
    }
  | {
      readonly kind: "omitted";
      readonly fallible: false;
      readonly target: RustCallableParameterAbi;
    }
  | {
      readonly kind: "rest";
      readonly fallible: boolean;
      readonly elementCarrier: TargetTypeRef;
      readonly collection: "vec" | "js-array";
      readonly segments: readonly RustCallableRestSegment[];
      readonly target: RustCallableParameterAbi;
    }
  | {
      readonly kind: "rest-element";
      readonly fallible: boolean;
      readonly iteration: RustCallableRestIteration;
      readonly optionalAdapter: RustCallableValueAdapter | undefined;
      readonly contractParameterIndex: number;
      readonly source: RustCallableParameterAbi;
      readonly offset: number;
      readonly target: RustCallableParameterAbi;
      readonly adapter: RustCallableValueAdapter;
    };

export function callableRestElement(carrier: TargetTypeRef): TargetTypeRef | undefined {
  const sequence = rustRestSequenceElements(carrier);
  return sequence?.collection === "vec" || sequence?.collection === "js-array" ? sequence.elements[0] : undefined;
}
