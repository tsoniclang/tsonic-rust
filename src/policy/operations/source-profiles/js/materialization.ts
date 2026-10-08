import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import {
  isRustNumericCarrier,
  rustJsValueTargetType,
} from "../../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectRustProjectedValueConversion } from "../../../conversions/selection.js";
import type { RustProviderOperationForm, RustValueConversion } from "../../../../target-model/operations/model.js";
import { jsValueProjectionsAreValid, type JsOperationTarget, type JsValueProjection } from "./model.js";
import { resolveCarrierRef, type JsLaneBindings } from "./carrier-references.js";
import type {
  RustTargetGenericArgument,
  RustTargetTraitRef,
  TargetTypeRef,
} from "../../../../target-model/types/model.js";

export function materializeJsOperationTarget(
  target: JsOperationTarget,
  bindings: JsLaneBindings,
): RustProviderOperationForm | undefined {
  if (target.form !== "associated-call") return target;
  const owner = resolveCarrierRef(target.owner, bindings);
  return owner === undefined ? undefined : { ...target, owner };
}

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
  parameterCarriers: readonly (TargetTypeRef | undefined)[],
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
  const leadingArguments = target.leadingArguments.map((argument, index) => {
    const carrier = argument.carrier.kind === "opaque" && argument.carrier.id === "tsonic.rust.infer"
      ? parameterCarriers[index] : argument.carrier;
    return carrier === undefined ? undefined : { ...argument, carrier };
  });
  return resolvedElementCarrier === undefined || leadingArguments.some(argument => argument === undefined)
    ? undefined
    : { ...target, elementCarrier: resolvedElementCarrier,
        leadingArguments: leadingArguments as typeof target.leadingArguments };
}

export function materializeJsValueProjections(
  target: RustProviderOperationForm,
  projections: readonly JsValueProjection[] | undefined,
  sourceCarriers: readonly (TargetTypeRef | undefined)[],
  definitions: RustTypeDefinitions,
  propertyProjection?: (argumentIndex: number) => RustValueConversion | undefined,
): RustProviderOperationForm | undefined {
  if (projections === undefined) {
    return target;
  }
  if ((target.form !== "call" && target.form !== "free-call") ||
    !jsValueProjectionsAreValid(projections, sourceCarriers.length)) {
    return undefined;
  }
  const order = target.argOrder ?? sourceCarriers.map((_carrier, index) => index);
  if (!jsValueProjectionsAreValid(order.map(sourceIndex => ({ sourceIndex, kind: "properties" })), sourceCarriers.length)) {
    return undefined;
  }
  const selected = new Map(projections.map(projection => [projection.sourceIndex, projection.kind]));
  if (projections.some(projection => !order.includes(projection.sourceIndex))) {
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
      : selectJsValueProjection(source, sourceIndex, selected.get(sourceIndex)!, definitions, propertyProjection);
  });
  if (conversions.some((conversion, targetIndex) =>
    selected.has(order[targetIndex]!) && (target.argConversions?.[targetIndex] !== undefined ||
      conversion === undefined && !jsonValueArgumentNeedsNoConversion(
        sourceCarriers[order[targetIndex]!],
        target.argModes?.[targetIndex] ?? "value",
      )))) {
    return undefined;
  }
  return { ...target, argConversions: conversions };
}

export function selectJsValueProjection(
  source: TargetTypeRef,
  sourceIndex: number,
  projection: "json" | "properties",
  definitions: RustTypeDefinitions,
  propertyProjection?: (argumentIndex: number) => RustValueConversion | undefined,
): RustValueConversion | undefined {
  return projection === "properties" ? propertyProjection?.(sourceIndex)
    : selectRustProjectedValueConversion(source, "json", definitions);
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
