import type {
  RustCallbackOperationTemplate,
  RustProviderOperationForm,
  RustProviderOperationTemplate,
  RustRuntimeSetTemplate,
  RustValueConversion,
} from "../model.js";
import type { TargetTypeRef } from "../../types/model.js";

export interface JsOperationRequest {
  readonly ownerName: string;
  readonly memberName: string;
  readonly operationKind: "call" | "property" | "indexer" | "constructor" | "property-set" | "index-set" | "delete";
  readonly receiverCarrier?: TargetTypeRef;
  readonly argumentCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly selectedMethodTypeArgumentCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly authoredMethodTypeArgumentCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly argumentMatchScore?: (
    expected: TargetTypeRef,
    actual: TargetTypeRef | undefined,
    index: number,
  ) => number | undefined;
  readonly carrierSupportsProjectIdentity?: (carrier: TargetTypeRef) => boolean;
  readonly resultUse?: "consumed" | "discarded";
}

export interface JsOperationSelection {
  readonly fact: RustProviderOperationTemplate | RustRuntimeSetTemplate;
  readonly resultCarrier?: TargetTypeRef;
  readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly callback?: RustCallbackOperationTemplate;
}

export type JsLane = "js-array" | "string" | "map" | "set" | "date" | "json" | "math" | "number" | "boolean" | "global" | "console" | "object" | "regexp" | "regexp-match";

export type JsCarrierRef =
  | { readonly ref: "cb-array-from-map"; readonly arity: 0 | 1 | 2 }
  | { readonly ref: "cb-array-predicate"; readonly arity: 0 | 1 | 2 | 3 }
  | { readonly ref: "cb-array-map"; readonly arity: 0 | 1 | 2 | 3 }
  | { readonly ref: "cb-array-reduce"; readonly arity: 0 | 1 | 2 | 3 | 4 }
  | { readonly ref: "cb-array-reduce-first"; readonly arity: 0 | 1 | 2 | 3 | 4 }
  | { readonly ref: "cb-array-for-each"; readonly arity: 0 | 1 | 2 | 3 }
  | { readonly ref: "cb-array-comparator"; readonly arity: 0 | 1 | 2 }
  | { readonly ref: "cb-map-for-each"; readonly arity: 0 | 1 | 2 | 3 }
  | { readonly ref: "cb-set-for-each"; readonly arity: 0 | 1 | 2 | 3 }
  | { readonly ref: "int32" }
  | { readonly ref: "jsvalue" }
  | { readonly ref: "float64" }
  | { readonly ref: "infer" }
  | { readonly ref: "selected-method-type-argument"; readonly index: number }
  | { readonly ref: "selected-method-input-array"; readonly index: number }
  | { readonly ref: "selected-method-output-array"; readonly index: number }
  | { readonly ref: "bool" }
  | { readonly ref: "unit" }
  | { readonly ref: "string-array" }
  | { readonly ref: "regexp-match" }
  | { readonly ref: "option-of-regexp-match" }
  | { readonly ref: "regexp-match-vec" }
  | { readonly ref: "option-of-string" }
  | { readonly ref: "option-of-string-array" }
  | { readonly ref: "element-array" }
  | { readonly ref: "option-of-float64" }
  | { readonly ref: "string" }
  | { readonly ref: "element" }
  | { readonly ref: "option-of-element" }
  | { readonly ref: "receiver" }
  | { readonly ref: "map-key" }
  | { readonly ref: "map-value" }
  | { readonly ref: "option-of-map-value" }
  | { readonly ref: "map-key-array" }
  | { readonly ref: "map-value-array" }
  | { readonly ref: "map-entry-array" }
  | { readonly ref: "set-value" }
  | { readonly ref: "set-value-array" }
  | { readonly ref: "set-entry-array" }
  | { readonly ref: "argument"; readonly index: number };

type JsCarrierCapability = "numeric" | "integer" | "clone" | "stringifiable" | "js-equality" | "project-identity-equality";

export interface JsOperationRowData {
  readonly owner: string;
  readonly member: string;
  readonly operationKind: JsOperationRequest["operationKind"];
  readonly lane: JsLane;
  readonly variant?: string;
  readonly requirements?: readonly {
    readonly carrier: JsCarrierRef;
    readonly capability: JsCarrierCapability;
  }[];
  readonly callback?: RustCallbackOperationTemplate;
  readonly selectedMethodTypeArgumentArity?: number;
  readonly fallible?: boolean;
  readonly variadic?: true;
  readonly firstArgCarrierId?: string;
  readonly shape:
    | {
        readonly op: "operation";
        readonly operationKind: "method" | "constructor" | "property" | "indexer";
        readonly target: RustProviderOperationForm;
        readonly discardedTarget?: RustProviderOperationForm;
        readonly resultConversion?: RustValueConversion;
        readonly result: JsCarrierRef;
        readonly sourceResult?: JsCarrierRef;
        readonly sourceAbsence?: "undefined" | "null";
        readonly params?: readonly (JsCarrierRef | undefined)[];
        readonly firstArgCarrierId?: string;
}
    | {
        readonly op: "set";
        readonly target: RustProviderOperationForm;
        readonly params: readonly JsCarrierRef[];
      };
}

export function defineJsOperationRows(rows: readonly JsOperationRowData[]): readonly JsOperationRowData[] {
  const identities = new Set<string>();
  const variantsByOperation = new Map<string, string[]>();
  for (const row of rows) {
    const operation = `${row.owner}|${row.member}|${row.operationKind}|${row.lane}`;
    const variant = row.variant ?? "";
    const identity = `${operation}|${variant}`;
    if (identities.has(identity)) {
      throw new Error(`Duplicate JavaScript operation row '${identity}'.`);
    }
    identities.add(identity);
    variantsByOperation.set(operation, [...(variantsByOperation.get(operation) ?? []), variant]);
  }
  for (const [operation, variants] of variantsByOperation) {
    if (variants.length > 1 && variants.some((variant) => variant.length === 0)) {
      throw new Error(`JavaScript operation rows for '${operation}' require explicit variants.`);
    }
  }
  return Object.freeze([...rows]);
}
