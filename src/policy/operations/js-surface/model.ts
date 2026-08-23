import type {
  RustCallbackOperationTemplate,
  RustProviderOperationForm,
  RustProviderOperationTemplate,
  RustRuntimeSetTemplate,
  RustValueConversion,
} from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustProviderOperationFormDeclaresWritableInput } from "../forms.js";

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
  readonly authoredPropertyKey?: string;
}

export interface JsOperationSelection {
  readonly fact: RustProviderOperationTemplate | RustRuntimeSetTemplate;
  readonly resultCarrier?: TargetTypeRef;
  readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly callback?: RustCallbackOperationTemplate;
}

export type JsLane =
  | "js-array"
  | "string"
  | "js-string"
  | "map"
  | "set"
  | "date"
  | "json"
  | "math"
  | "number"
  | "boolean"
  | "global"
  | "console"
  | "object"
  | "regexp"
  | "regexp-named-groups"
  | "regexp-named-indices"
  | "regexp-string-iterator";

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
  | { readonly ref: "js-string-array" }
  | { readonly ref: "regexp" }
  | { readonly ref: "regexp-exec-array" }
  | { readonly ref: "regexp-match-array" }
  | { readonly ref: "regexp-indices" }
  | { readonly ref: "regexp-named-groups" }
  | { readonly ref: "regexp-named-indices" }
  | { readonly ref: "regexp-string-iterator" }
  | { readonly ref: "js-regexp-exec-array" }
  | { readonly ref: "js-regexp-match-array" }
  | { readonly ref: "js-regexp-indices" }
  | { readonly ref: "js-regexp-named-groups" }
  | { readonly ref: "js-regexp-named-indices" }
  | { readonly ref: "js-regexp-string-iterator" }
  | { readonly ref: "regexp-index-pair" }
  | { readonly ref: "option-of-regexp-exec-array" }
  | { readonly ref: "option-of-regexp-match-array" }
  | { readonly ref: "option-of-regexp-indices" }
  | { readonly ref: "option-of-regexp-named-groups" }
  | { readonly ref: "option-of-regexp-named-indices" }
  | { readonly ref: "option-of-js-regexp-exec-array" }
  | { readonly ref: "option-of-js-regexp-match-array" }
  | { readonly ref: "option-of-js-regexp-indices" }
  | { readonly ref: "option-of-js-regexp-named-groups" }
  | { readonly ref: "option-of-js-regexp-named-indices" }
  | { readonly ref: "option-of-regexp-index-pair" }
  | { readonly ref: "option-of-string" }
  | { readonly ref: "option-of-js-string" }
  | { readonly ref: "option-of-string-array" }
  | { readonly ref: "option-of-js-string-array" }
  | { readonly ref: "element-array" }
  | { readonly ref: "option-of-float64" }
  | { readonly ref: "string" }
  | { readonly ref: "js-string" }
  | { readonly ref: "undefined" }
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
  readonly authoredPropertyKey?: true;
  readonly shape:
    | {
        readonly op: "operation";
        readonly operationKind: "method" | "constructor" | "property" | "indexer";
        readonly target: RustProviderOperationForm;
        readonly discardedTarget?: RustProviderOperationForm;
        readonly resultConversion?: RustValueConversion;
        readonly evaluation?: "pure";
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
    if (row.shape.op === "operation" && row.shape.evaluation === "pure" &&
      (row.shape.operationKind === "constructor" ||
        row.callback !== undefined ||
        rustProviderOperationFormDeclaresWritableInput(row.shape.target))) {
      throw new Error(
        `Pure JavaScript operation row '${row.owner}.${row.member}' cannot construct identity, invoke a source callback, or declare writable source inputs.`,
      );
    }
    const operation = [
      row.owner,
      row.member,
      row.operationKind,
      row.lane,
      row.firstArgCarrierId ?? "",
    ].join("|");
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
