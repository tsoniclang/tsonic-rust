import type { TargetTypeRef } from "../../types/model.js";
import type { RustTargetOperationFact } from "./operations.js";

export function rustTargetOperationResultCarrier(fact: RustTargetOperationFact): TargetTypeRef | undefined {
  switch (fact.kind) {
    case "provider-operation":
    case "default-value":
    case "object-shape-projection":
    case "operator-token":
    case "union-equality":
    case "operator-call":
    case "sequence":
    case "string-concat":
    case "template-string":
    case "typeof":
    case "void-expression":
    case "array-literal":
    case "source-field":
    case "source-indexed-field":
    case "source-index-signature":
    case "source-method-property":
    case "source-static-field":
    case "source-accessor":
    case "source-union-field":
    case "union-property":
    case "source-call":
    case "source-enum-member":
    case "provider-record-literal":
    case "closed-record-literal":
    case "record-literal":
    case "record-index-literal":
    case "tuple-literal":
    case "tuple-index":
    case "await-op":
    case "closure":
    case "source-conversion":
    case "reference-operation":
    case "native-range":
    case "native-propagation":
    case "option-coalesce":
    case "nullish-identity":
    case "nullish-assignment":
    case "non-null-expression":
    case "constant-equality":
    case "typed-location":
    case "native-pointer":
    case "project-type-test":
    case "closed-type-test":
    case "program-error-type-test":
    case "program-error-equality":
    case "builtin-error-property":
      return fact.resultCarrier;
    case "iteration":
      return fact.elementCarrier;
    case "option-check":
    case "option-equality":
      return { kind: "source-primitive", name: "bool" };
    default:
      return undefined;
  }
}
