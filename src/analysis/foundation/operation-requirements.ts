import type { RustTargetOperationFact } from "../facts/operations/facts.js";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import type {
  RustTargetGenericArgument,
  RustTargetTypeRef,
} from "../../target-model/types/model.js";
import type { RustFoundation } from "../../target-model/foundation/model.js";
import { maximumRustFoundation } from "../../target-model/foundation/model.js";
import {
  rustFoundationForCarrier,
  rustFoundationForPath,
} from "./requirements.js";
import {
  rustFoundationForFinalizedOperationAbi,
  rustFoundationForValueConversion,
} from "./conversion-requirements.js";

export function rustFoundationForTargetOperationFact(
  fact: RustTargetOperationFact,
): RustFoundation {
  let foundation: RustFoundation = "core";
  const require = (candidate: RustFoundation): void => {
    foundation = maximumRustFoundation(foundation, candidate);
  };
  const requireCarrier = (carrier: RustTargetTypeRef | undefined): void => {
    if (carrier !== undefined) require(rustFoundationForCarrier(carrier));
  };
  const requireConversion = (conversion: RustValueConversion | undefined): void => {
    if (conversion !== undefined) require(rustFoundationForValueConversion(conversion));
  };
  const requireGenericArgument = (argument: RustTargetGenericArgument): void => {
    if (argument.kind === "type") requireCarrier(argument.type);
  };

  switch (fact.kind) {
    case "operator-token":
      requireCarrier(fact.resultCarrier);
      requireConversion(fact.leftConversion);
      requireConversion(fact.rightConversion);
      break;
    case "operator-call":
      require(rustFoundationForPath(fact.path));
      requireCarrier(fact.resultCarrier);
      requireConversion(fact.leftConversion);
      requireConversion(fact.rightConversion);
      break;
    case "string-concat":
    case "conditional":
    case "typeof":
    case "void-expression":
    case "identity-expression":
    case "default-value":
    case "disjoint-equality":
    case "source-enum-member":
    case "tuple-index":
    case "await-op":
    case "option-coalesce":
    case "nullish-identity":
      requireCarrier(fact.resultCarrier);
      break;
    case "template-string":
      requireCarrier(fact.resultCarrier);
      fact.substitutions.forEach((substitution) => requireCarrier(substitution.carrier));
      break;
    case "non-null-expression":
      requireCarrier(fact.sourceCarrier);
      requireCarrier(fact.resultCarrier);
      break;
    case "switch":
      requireCarrier(fact.discriminantCarrier);
      fact.clauses.forEach((clause) => requireCarrier(clause.carrier));
      break;
    case "provider-operation":
    case "runtime-set":
      require(rustFoundationForFinalizedOperationAbi(fact.abi));
      break;
    case "object-shape-projection":
      requireCarrier(fact.sourceValueCarrier);
      requireCarrier(fact.assignmentSourceCarrier);
      fact.assignmentFields?.forEach((field) => {
        requireCarrier(field.sourceCarrier);
        requireCarrier(field.targetCarrier);
        requireConversion(field.conversion);
      });
      fact.fields.forEach((field) => {
        requireCarrier(field.valueCarrier);
        requireConversion(field.conversion);
      });
      requireCarrier(fact.resultCarrier);
      break;
    case "array-literal":
      requireCarrier(fact.elementCarrier);
      requireCarrier(fact.resultCarrier);
      if (fact.lane === "js") require("std");
      break;
    case "iteration":
      requireCarrier(fact.elementCarrier);
      if (fact.lowering.kind === "js-array") require("std");
      if (fact.lowering.kind === "async-generator") require("alloc");
      break;
    case "option-check":
      requireCarrier(fact.optionCarrier);
      requireCarrier(fact.nullishCarrier);
      break;
    case "option-equality":
      requireCarrier(fact.optionCarrier);
      break;
    case "option-value-equality":
      requireCarrier(fact.optionCarrier);
      requireCarrier(fact.valueCarrier);
      break;
    case "project-type-test":
      requireCarrier(fact.sourceCarrier);
      requireCarrier(fact.dispatchCarrier);
      requireCarrier(fact.targetCarrier);
      requireCarrier(fact.resultCarrier);
      break;
    case "program-error-type-test":
      requireCarrier(fact.sourceCarrier);
      requireCarrier(fact.targetCarrier);
      requireCarrier(fact.resultCarrier);
      break;
    case "source-field":
      requireCarrier(fact.receiverCarrier);
      requireCarrier(fact.resultCarrier);
      requireCarrier(fact.dispatch?.ownerCarrier);
      break;
    case "source-index-signature":
      require("std");
      requireCarrier(fact.receiverCarrier);
      requireCarrier(fact.keyCarrier);
      requireCarrier(fact.resultCarrier);
      break;
    case "source-method-property":
      requireCarrier(fact.receiverCarrier);
      requireCarrier(fact.callableCarrier);
      requireCarrier(fact.write?.ownerCarrier);
      requireCarrier(fact.resultCarrier);
      break;
    case "source-static-field":
      require("std");
      requireCarrier(fact.resultCarrier);
      break;
    case "source-accessor":
      if (fact.receiver.kind === "static") requireCarrier(fact.receiver.typeCarrier);
      requireCarrier(fact.read?.resultCarrier);
      requireCarrier(fact.write?.valueCarrier);
      requireCarrier(fact.dispatch?.ownerCarrier);
      requireCarrier(fact.resultCarrier);
      break;
    case "source-union-field":
      requireCarrier(fact.unionCarrier);
      fact.variants.forEach((variant) => requireCarrier(variant.carrier));
      requireCarrier(fact.resultCarrier);
      break;
    case "source-call":
      if (fact.target.form === "method") {
        requireCarrier(fact.target.dispatch?.ownerCarrier);
      } else if (fact.target.form === "static-method" || fact.target.form === "constructor") {
        requireCarrier(fact.target.typeCarrier);
      } else if (fact.target.form === "callable") {
        requireCarrier(fact.target.carrier);
      } else if (fact.target.form === "structural-method") {
        requireCarrier(fact.target.receiverCarrier);
        requireCarrier(fact.target.callableCarrier);
      }
      fact.parameters.forEach((parameter) => {
        requireCarrier(parameter.valueCarrier);
        requireCarrier(parameter.parameterCarrier);
        parameter.inputs.forEach((input) => requireCarrier(input.carrier));
      });
      fact.targetGenericArguments?.forEach(requireGenericArgument);
      requireCarrier(fact.resultCarrier);
      break;
    case "provider-record-literal":
      fact.fields.forEach((field) => requireCarrier(field.storageCarrier));
      requireCarrier(fact.resultCarrier);
      break;
    case "record-literal":
      fact.fields.forEach((field) => requireCarrier(field.carrier));
      fact.contributions.forEach((contribution) => {
        if (contribution.kind === "spread") {
          requireCarrier(contribution.sourceCarrier);
          contribution.fields.forEach((field) => requireCarrier(field.carrier));
          contribution.methods.forEach((method) => requireCarrier(method.callableCarrier));
        }
      });
      requireCarrier(fact.resultCarrier);
      break;
    case "record-index-literal":
      require("std");
      requireCarrier(fact.keyCarrier);
      requireCarrier(fact.valueCarrier);
      fact.contributions.forEach((contribution) => {
        if (contribution.kind === "spread") requireCarrier(contribution.sourceCarrier);
      });
      requireCarrier(fact.resultCarrier);
      break;
    case "tuple-literal":
      requireCarrier(fact.resultCarrier);
      break;
    case "closure":
      fact.leadingParameters?.forEach((parameter) => requireCarrier(parameter.carrier));
      requireCarrier(fact.resultCarrier);
      break;
    case "throw-op":
      require("alloc");
      if (fact.error.kind === "project") requireCarrier(fact.error.carrier);
      break;
    case "regexp-create":
      require("std");
      break;
    case "source-conversion":
      requireConversion(fact.conversion);
      requireCarrier(fact.resultCarrier);
      break;
    case "reference-operation":
      requireCarrier(fact.operandCarrier);
      requireCarrier(fact.referenceCarrier);
      if (fact.operation === "store") requireCarrier(fact.valueCarrier);
      requireCarrier(fact.resultCarrier);
      break;
    case "typed-location":
      requireCarrier(fact.pointeeCarrier);
      requireCarrier(fact.locationCarrier);
      requireCarrier(fact.resultCarrier);
      break;
    case "native-pointer":
      requireCarrier(fact.pointerCarrier);
      requireCarrier(fact.pointeeCarrier);
      requireCarrier(fact.valueCarrier);
      requireCarrier(fact.offsetCarrier);
      requireCarrier(fact.resultCarrier);
      break;
    case "fixed-array-literal":
    case "fixed-index":
    case "option-none":
    case "option-wrap":
    case "flow-marker":
      break;
    default: {
      const exhaustive: never = fact;
      return exhaustive;
    }
  }
  return foundation;
}
