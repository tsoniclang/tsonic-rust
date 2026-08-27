import {
  isRustJsArrayCarrier,
  rustCallableTargetType,
  rustJsArrayLikeElementTargetType,
  rustJsArrayTargetType,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustTupleTargetType,
  rustVecTargetType,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustAuthoredTargetType } from "./tuples.js";
import {
  resolveRustExactNullishValueCarrier,
  resolveRustTargetType,
} from "./target.js";
import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceCallableTypeEvidence,
  SourceTypeComponentEvidence,
} from "@tsonic/target-api/source";
import type {
  RustTargetTypeResolutionContext,
  RustTargetTypeResolutionOptions,
} from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function resolveRustSignatureParameterListTarget(
  parameters: SourceCallableTypeEvidence["parameters"],
  elements: readonly TargetTypeRef[],
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const restIndexes = parameters.flatMap((parameter, index) =>
    parameter.parameterKind === "rest" ? [index] : []
  );
  if (restIndexes.length === 0) {
    return rustTupleTargetType(elements);
  }
  if (restIndexes.length !== 1) {
    return undefined;
  }
  const restIndex = restIndexes[0]!;
  const restCarrier = elements[restIndex];
  const restElement = restCarrier?.kind === "array"
    ? restCarrier.element
    : isRustJsArrayCarrier(restCarrier)
      ? rustJsArrayLikeElementTargetType(restCarrier)
      : undefined;
  if (restElement === undefined) {
    return undefined;
  }
  const homogeneous = elements.every((element, index) => {
    const value = index === restIndex
      ? restElement
      : rustOptionElementCarrier(element) ?? element;
    return rustTargetTypeRefEquals(value, restElement);
  });
  if (!homogeneous) {
    return undefined;
  }
  return options.jsEnabled
    ? rustJsArrayTargetType(restElement)
    : rustVecTargetType(restElement);
}

export function resolveRustCallableEvidence(
  callable: SourceCallableTypeEvidence,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const parameters = callable.parameters.map((parameter) =>
      resolveRustSignatureParameterEvidence(
        parameter,
        context,
        options,
        resolving,
        "callable",
    )
  );
  if (parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const result = resolveRustTypeComponentEvidence(
    callable.result,
    context,
    options,
    resolving,
  );
  if (result === undefined) return undefined;
  const declaration = callable.result.declaration;
  const genericContract = context.sourceLifetimes.contractFor(declaration);
  if (genericContract?.lifetimeBinder !== undefined) {
    return genericContract.parameters.some((parameter) => parameter.kind !== "lifetime")
      ? undefined
      : Object.freeze({
          kind: "closure" as const,
          args: Object.freeze(parameters as readonly TargetTypeRef[]),
          result,
          lifetimeBinder: genericContract.lifetimeBinder,
        });
  }
  return rustCallableTargetType(parameters as readonly TargetTypeRef[], result);
}

export function resolveRustSignatureParameterEvidence(
  parameter: SourceCallableTypeEvidence["parameters"][number],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  use: "callable" | "parameter-list",
): TargetTypeRef | undefined {
  const authoredTypeNode = parameter.declaration === undefined
    ? undefined
    : context.ast.typeNode(parameter.declaration);
  const resolved = resolveRustTypeComponentEvidence(
    {
      selectedType: parameter.type,
      ...(parameter.declaration === undefined
        ? {}
        : {
            declaration: parameter.declaration,
            ...(authoredTypeNode === undefined ? {} : { authoredTypeNode }),
          }),
    },
    context,
    options,
    resolving,
  );
  const optional = use === "parameter-list"
    ? parameter.parameterKind === "optional"
    : parameter.omissionKind === "undefined";
  return resolved === undefined || !optional ||
      rustOptionElementCarrier(resolved) !== undefined
    ? resolved
    : rustOptionTargetType(resolved);
}

export function resolveRustTypeComponentEvidence(
  component: SourceTypeComponentEvidence,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (component.authoredTypeNode === undefined) {
    return resolveRustTargetType(
      component.selectedType,
      context,
      options,
      resolving,
    );
  }
  const authoredSourceFile = context.ast.getSourceFile(component.authoredTypeNode);
  const semantics = authoredSourceFile !== undefined &&
      context.source.semantics.includes(authoredSourceFile)
    ? context.semantics(authoredSourceFile)
    : undefined;
  const selected = resolveRustTargetType(
    component.selectedType,
    context,
    options,
    resolving,
  );
  if (semantics === undefined) {
    return selected;
  }
  const authored = resolveRustAuthoredTargetType(
    component.authoredTypeNode,
    context,
    options,
    resolving,
  );
  const selection = semantics.types.authoredSelection(
    component.authoredTypeNode,
    component.selectedType,
  );
  if (selection.kind === "ambiguous") {
    return undefined;
  }
  if (selection.kind === "authored-members") {
    const targets = [
      ...selection.nodes.map((node) =>
        resolveRustAuthoredTargetType(node, context, options, resolving)),
      ...selection.selectedNullishTypes.map((type) =>
        resolveRustExactNullishValueCarrier(type, semantics)),
    ];
    if (targets.some((target) => target === undefined)) {
      return undefined;
    }
    return combineRustSelectedTargets(
      targets as readonly TargetTypeRef[],
      selection.selectedNullishTypes.length,
      options,
    );
  }
  return selected ?? authored;
}

function combineRustSelectedTargets(
  targets: readonly TargetTypeRef[],
  nullishCount: number,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (targets.length === 0) {
    return undefined;
  }
  if (targets.length === 1) {
    return targets[0];
  }
  if (nullishCount === 1 && targets.length === 2) {
    return rustOptionTargetType(targets[0]!);
  }
  const first = targets[0]!;
  if (targets.every((target) => rustTargetTypeRefEquals(first, target))) {
    return first;
  }
  return options.resolveProjectUnionCarrier(targets);
}

export function resolveRustEvidenceNodesToCommonCarrier(
  nodes: readonly Node[],
  selectedType: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (nodes.length === 0) {
    return undefined;
  }
  const carriers = [...new Set(nodes)].map((node) => {
    const semantics = context.semanticsFor(node);
    const selection = semantics.types.authoredSelection(node, selectedType);
    if (selection.kind !== "authored-members") {
      return undefined;
    }
    const selected = selection.nodes.map((member) =>
      resolveRustAuthoredTargetType(member, context, options, resolving)
    );
    if (selected.length !== 1 || selected[0] === undefined ||
      selection.selectedNullishTypes.length !== 0) {
      return undefined;
    }
    return selected[0];
  });
  if (carriers.some((carrier) => carrier === undefined)) {
    return undefined;
  }
  const first = carriers[0]!;
  return carriers.every((carrier) =>
      carrier !== undefined && rustTargetTypeRefEquals(first, carrier)
    )
    ? first
    : undefined;
}
