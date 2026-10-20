import { rustNeverTargetType, rustOptionElementCarrier } from "../../../target-model/types/index.js";
import { rustTupleTargetType } from "../../../policy/types/collections/tuple-carrier.js";

import { resolveCallableType } from "./callables.js";
import { resolveRustTupleElementTargetTypeWithState } from "./tuples.js";
import { resolveRustTargetType, resolveStructuralObjectType } from "./target.js";
import { sourceTransformedTypeFactEvidenceNodes } from "@tsonic/target-api/source";

import type { Node, Type } from "@tsonic/tsts";
import type { SourceStandardTypeTransformation } from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { resolveRustCallableEvidence, resolveRustEvidenceNodesToCommonCarrier, resolveRustSignatureParameterEvidence, resolveRustTypeComponentEvidence } from "./source-evidence.js";
import { resolveRustSignatureParameterListTarget } from "../../../policy/types/callables/parameter-list.js";

import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";

export function resolveRustCheckerTransformedType(
  authoredRoot: Node,
  selectedType: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const semantics = context.semanticsFor(authoredRoot);
  const standard = semantics.types.standardTransformation(
    authoredRoot,
    selectedType,
  );
  if (standard !== undefined) {
    return resolveStandardSourceTypeTransformation(
      standard,
      selectedType,
      authoredRoot,
      context,
      options,
      resolving,
    );
  }
  const direct = resolveRustEvidenceNodesToCommonCarrier(
    sourceTransformedTypeFactEvidenceNodes(
      context.ast,
      semantics,
      authoredRoot,
      selectedType,
    ),
    selectedType,
    context,
    options,
    resolving,
  );
  if (direct !== undefined) {
    return direct;
  }
  if (semantics.types.isTuple(selectedType)) {
    const infos = semantics.types.tupleElementInfos(selectedType);
    const elements = infos.map((element) =>
      resolveRustTupleElementTargetTypeWithState(
        element,
        semantics,
        context,
        options,
        resolving,
        authoredRoot,
      )
    );
    return infos.length === 0 || elements.some((element) => element === undefined)
      ? undefined
      : rustTupleTargetType(elements as readonly TargetTypeRef[]);
  }
  const callable = resolveCallableType(
    selectedType,
    context,
    options,
    resolving,
  );
  return callable ?? resolveRustTargetType(
    selectedType,
    context,
    options,
    resolving,
    authoredRoot,
  );
}

export function resolveStandardSourceTypeTransformation(
  transformation: SourceStandardTypeTransformation,
  selectedType: Type,
  authoredRoot: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (transformation.kind === "unresolved") {
    return undefined;
  }
  if (transformation.kind === "non-nullish") {
    if (context.currentSemantics.types.isNever(selectedType)) return rustNeverTargetType();
    const input = resolveRustTypeComponentEvidence(transformation.component, context, options, resolving);
    return rustOptionElementCarrier(input) ?? rustOptionalStorageValue(input) ?? input;
  }
  if (transformation.kind === "component") {
    return resolveRustTypeComponentEvidence(
      transformation.component,
      context,
      options,
      resolving,
    );
  }
  if (transformation.kind === "parameter-list") {
    const elements = transformation.parameters.map((element) =>
      resolveRustSignatureParameterEvidence(
        element,
        context,
        options,
        resolving,
      )
    );
    return elements.some((element) => element === undefined)
      ? undefined
      : resolveRustSignatureParameterListTarget(
          transformation.parameters,
          elements as readonly TargetTypeRef[],
          options,
        );
  }
  if (transformation.kind === "structural") {
    return resolveStructuralObjectType(
      selectedType,
      context,
      options,
      resolving,
      authoredRoot,
    );
  }
  return resolveRustCallableEvidence(
    transformation.callable,
    context,
    options,
    resolving,
  );
}
