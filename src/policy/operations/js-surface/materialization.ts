import {
  isRustNumericCarrier,
  rustJsValueTargetType,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustJsonValueConversion } from "../../conversions/selection.js";
import type { RustProviderOperationForm } from "../../../target-model/operations/model.js";
import type {
  RustTargetGenericArgument,
  RustTargetTraitRef,
  TargetTypeRef,
} from "../../../target-model/types/model.js";

function copyStyleOf(
  carrier: TargetTypeRef | undefined,
): { readonly kind: "method"; readonly name: "copied" | "cloned" } {
  return {
    kind: "method",
    name: carrier !== undefined &&
        (carrier.kind === "source-primitive" || isRustNumericCarrier(carrier))
      ? "copied"
      : "cloned",
  };
}

export function materializeTarget(
  target: RustProviderOperationForm,
  copyCarrier: TargetTypeRef | undefined,
): RustProviderOperationForm {
  if (target.form !== "receiver-method" || target.chain === undefined) {
    return target;
  }
  return {
    ...target,
    chain: target.chain.map((entry) =>
      entry.kind === "copy-selected-carrier" ? copyStyleOf(copyCarrier) : entry),
  };
}

export function materializeVariadicTarget(
  target: RustProviderOperationForm,
  elementCarrier: TargetTypeRef | undefined,
): RustProviderOperationForm | undefined {
  if (target.form === "receiver-tagged-array") {
    if (elementCarrier === undefined) {
      return undefined;
    }
    return {
      ...target,
      elementCarrier: materializeInferredCarrier(target.elementCarrier, elementCarrier),
      alternatives: target.alternatives.map((alternative) => ({
        ...alternative,
        inputCarrier: materializeInferredCarrier(alternative.inputCarrier, elementCarrier),
      })),
    };
  }
  if (target.form !== "receiver-value-array" && target.form !== "call-value-array") {
    return target;
  }
  const resolvedElementCarrier = target.elementCarrier.kind === "opaque" &&
    target.elementCarrier.id === "tsonic.rust.infer"
    ? elementCarrier
    : target.elementCarrier;
  return resolvedElementCarrier === undefined
    ? undefined
    : { ...target, elementCarrier: resolvedElementCarrier };
}

export function materializeJsonValueConversions(
  target: RustProviderOperationForm,
  sourceIndexes: readonly number[] | undefined,
  sourceCarriers: readonly (TargetTypeRef | undefined)[],
): RustProviderOperationForm | undefined {
  if (sourceIndexes === undefined) {
    return target;
  }
  if (target.form !== "call") {
    return undefined;
  }
  const order = target.argOrder ?? sourceCarriers.map((_carrier, index) => index);
  const selected = new Set(sourceIndexes);
  if (sourceIndexes.some((sourceIndex) => !order.includes(sourceIndex))) {
    return undefined;
  }
  const conversions = order.map((sourceIndex, targetIndex) => {
    const existing = target.argConversions?.[targetIndex];
    if (!selected.has(sourceIndex)) {
      return existing;
    }
    const source = sourceCarriers[sourceIndex];
    const mode = target.argModes?.[targetIndex] ?? "value";
    return existing !== undefined || source === undefined ||
        jsonValueArgumentNeedsNoConversion(source, mode)
      ? undefined
      : selectRustJsonValueConversion(source);
  });
  if (conversions.some((conversion, targetIndex) =>
    selected.has(order[targetIndex]!) && conversion === undefined &&
      target.argConversions?.[targetIndex] === undefined &&
      !jsonValueArgumentNeedsNoConversion(
        sourceCarriers[order[targetIndex]!],
        target.argModes?.[targetIndex] ?? "value",
      ))) {
    return undefined;
  }
  return { ...target, argConversions: conversions };
}

function jsonValueArgumentNeedsNoConversion(
  source: TargetTypeRef | undefined,
  mode: "value" | "ref" | "mut-ref",
): boolean {
  return source !== undefined && mode === "ref" &&
    rustTargetTypeRefEquals(source, rustJsValueTargetType());
}

function materializeInferredCarrier(
  carrier: TargetTypeRef,
  inferred: TargetTypeRef,
): TargetTypeRef {
  if (carrier.kind === "opaque" && carrier.id === "tsonic.rust.infer") {
    return inferred;
  }
  switch (carrier.kind) {
    case "target-named":
      return carrier.genericArguments === undefined
        ? carrier
        : {
            ...carrier,
            genericArguments: materializeInferredGenericArguments(
              carrier.genericArguments,
              inferred,
            ),
          };
    case "array":
      return { ...carrier, element: materializeInferredCarrier(carrier.element, inferred) };
    case "tuple":
      return {
        ...carrier,
        elements: carrier.elements.map((element) =>
          materializeInferredCarrier(element, inferred)),
      };
    case "reference":
      return { ...carrier, referent: materializeInferredCarrier(carrier.referent, inferred) };
    case "pointer":
      return { ...carrier, pointee: materializeInferredCarrier(carrier.pointee, inferred) };
    case "function-pointer":
    case "closure":
      return {
        ...carrier,
        args: carrier.args.map((argument) =>
          materializeInferredCarrier(argument, inferred)),
        result: materializeInferredCarrier(carrier.result, inferred),
      };
    case "trait-ref":
      return materializeInferredTraitRef(carrier, inferred);
    case "trait-object":
      return {
        ...carrier,
        principal: materializeInferredTraitRef(carrier.principal, inferred),
        autoTraits: carrier.autoTraits.map((trait) =>
          materializeInferredTraitRef(trait, inferred)),
      };
    case "impl-trait":
      return {
        ...carrier,
        bounds: carrier.bounds.map((trait) =>
          materializeInferredTraitRef(trait, inferred)),
        captures: materializeInferredGenericArguments(carrier.captures, inferred),
      };
    case "associated-type":
      return {
        ...carrier,
        owner: materializeInferredCarrier(carrier.owner, inferred),
        ...(carrier.trait === undefined
          ? {}
          : { trait: materializeInferredTraitRef(carrier.trait, inferred) }),
        ...(carrier.genericArguments === undefined
          ? {}
          : {
              genericArguments: materializeInferredGenericArguments(
                carrier.genericArguments,
                inferred,
              ),
            }),
      };
    default:
      return carrier;
  }
}

function materializeInferredTraitRef(
  trait: RustTargetTraitRef,
  inferred: TargetTypeRef,
): RustTargetTraitRef {
  return {
    ...trait,
    genericArguments: materializeInferredGenericArguments(
      trait.genericArguments,
      inferred,
    ),
    associatedConstraints: trait.associatedConstraints.map((constraint) =>
      constraint.kind === "equality"
        ? {
            ...constraint,
            genericArguments: materializeInferredGenericArguments(
              constraint.genericArguments,
              inferred,
            ),
            type: materializeInferredCarrier(constraint.type, inferred),
          }
        : {
            ...constraint,
            genericArguments: materializeInferredGenericArguments(
              constraint.genericArguments,
              inferred,
            ),
            traits: constraint.traits.map((bound) =>
              materializeInferredTraitRef(bound, inferred)),
          }),
  };
}

function materializeInferredGenericArguments(
  arguments_: readonly RustTargetGenericArgument[],
  inferred: TargetTypeRef,
): readonly RustTargetGenericArgument[] {
  return arguments_.map((argument): RustTargetGenericArgument =>
    argument.kind === "type"
      ? {
          kind: "type",
          type: materializeInferredCarrier(argument.type, inferred),
        }
      : argument);
}
