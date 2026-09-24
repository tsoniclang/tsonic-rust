import type { RustArgumentMode } from "../../target-model/operations/model.js";
import type { RustContextualValueConversion } from "../../target-model/conversions/contextual.js";
import type { RustSourceParameterAbiFact } from "./callables-and-resources.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export type RustCallableValueAdapter =
  | {
      readonly kind: "project-structural-view";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "identity";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "conversion";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly conversion: RustContextualValueConversion;
    }
  | {
      readonly kind: "project-upcast";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "call-scoped-lifetime";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "option-some";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly element: RustCallableValueAdapter;
    }
  | {
      readonly kind: "option-map";
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

export type RustCallableParameterAdapter =
  | {
      readonly kind: "runtime-value";
      readonly contractParameterIndex: number;
      readonly source: RustCallableParameterAbi;
      readonly target: RustCallableParameterAbi;
      readonly adapter: RustCallableValueAdapter;
    }
  | {
      readonly kind: "logical-value";
      readonly contractParameterIndex: number;
      readonly source: RustCallableParameterAbi;
      readonly target: RustCallableParameterAbi;
      readonly adapter: RustCallableValueAdapter;
    }
  | {
      readonly kind: "omitted";
      readonly target: RustCallableParameterAbi;
    }
  | {
      readonly kind: "fixed-rest";
      readonly contractParameterIndexes: readonly number[];
      readonly sources: readonly RustCallableParameterAbi[];
      readonly target: RustCallableParameterAbi;
      readonly elementAdapters: readonly RustCallableValueAdapter[];
    }
  | {
      readonly kind: "sequence-rest";
      readonly contractParameterIndex: number;
      readonly source: RustCallableParameterAbi;
      readonly target: RustCallableParameterAbi;
      readonly elementAdapter: RustCallableValueAdapter;
    };
