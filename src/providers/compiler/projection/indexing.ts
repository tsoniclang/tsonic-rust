import { rustInt32ToUsizeValueConversion } from "../../../target-model/conversions/model.js";
import {
  rustSourcePrimitiveTargetType,
  rustUnitTargetType,
} from "../../../target-model/types/index.js";
import {
  rustCompilerTypesEqual,
} from "../model/types/substitution.js";
import {
  canonicalPathKey,
  genericParameterIdentity,
  requireCurrentType,
  rustCompilerTypeNamesCurrentType,
} from "./utilities.js";
import {
  operationRow,
  typeRequirements,
} from "./operations.js";
import {
  providerSourceGenericBindings,
} from "./functions.js";
import {
  sourceTypeFor,
  targetGenericsFor,
  targetTypeFor,
} from "./types.js";
import type {
  ProviderMemberDeclaration,
  ProviderTypeExpression,
} from "@tsonic/tsts";
import type {
  RustCompilerFunction,
  RustCompilerType,
  RustCompilerTypeParameter,
} from "../model/model.js";
import type { RustProviderOperationDefinition } from "../../packages/model.js";
import type { ProjectionContext } from "./model.js";

const indexTraitPath = Object.freeze(["core", "ops", "index", "Index"]);
const indexMutTraitPath = Object.freeze(["core", "ops", "index", "IndexMut"]);
const indexOutputPath = Object.freeze(["core", "ops", "index", "Index", "Output"]);
const sliceIndexTraitPath = Object.freeze(["core", "slice", "index", "SliceIndex"]);

interface StandardSliceIndexSelection {
  readonly method: RustCompilerFunction;
  readonly element: RustCompilerType;
  readonly writable: boolean;
}

export function projectStandardSliceIndexing(
  methods: readonly RustCompilerFunction[],
  context: ProjectionContext,
  exportId: string,
): {
  readonly members: readonly ProviderMemberDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const reads = methods.flatMap((method) => {
    const selected = selectStandardSliceIndex(method, context, false);
    return selected === undefined ? [] : [selected];
  });
  const writes = methods.flatMap((method) => {
    const selected = selectStandardSliceIndex(method, context, true);
    return selected === undefined ? [] : [selected];
  });
  if (reads.length === 0 && writes.length === 0) {
    return Object.freeze({ members: Object.freeze([]), operations: Object.freeze([]) });
  }
  if (reads.length !== 1) {
    throw new Error(`Rust type '${requireCurrentType(context).name}' has ${reads.length} exact standard slice index reads; expected one.`);
  }
  const read = reads[0]!;
  const matchingWrites = writes.filter((candidate) =>
    rustCompilerTypesEqual(candidate.element, read.element));
  if (matchingWrites.length !== writes.length || matchingWrites.length > 1) {
    throw new Error(`Rust type '${requireCurrentType(context).name}' has an incompatible standard slice index write contract.`);
  }
  const write = matchingWrites[0];
  const memberId = `${exportId}::indexer:${read.method.identity.itemId}`;
  const signatureId = `${memberId}::signature`;
  const sourceElement = sourceTypeFor(read.element, context, "result");
  const targetElement = targetTypeFor(read.element, context, "result");
  const indexSourceType: ProviderTypeExpression = Object.freeze({
    kind: "source-primitive",
    name: "int32",
  });
  const owner = requireCurrentType(context);
  const common = {
    exportId,
    memberId,
    signatureId,
    receiverCarrier: owner.carrier,
    sourceGenericBindings: providerSourceGenericBindings(
      owner.genericParameters,
      context,
    ),
    targetGenerics: targetGenericsFor(owner.generics, context),
    ...typeRequirements(owner.generics, owner.typeParameters, context),
  };
  const member: ProviderMemberDeclaration = Object.freeze({
    id: memberId,
    name: "indexer",
    kind: "indexer",
    ...(write === undefined ? { readonly: true } : {}),
    signatures: Object.freeze([Object.freeze({
      id: signatureId,
      parameters: Object.freeze([Object.freeze({
        name: "index",
        type: indexSourceType,
      })]),
      returnType: sourceElement,
    })]),
  });
  const readOperation = operationRow({
    ...common,
    operationKind: "indexer",
    target: Object.freeze({
      form: "index",
      indexConversion: rustInt32ToUsizeValueConversion,
    }),
    resultCarrier: targetElement,
    parameterCarriers: Object.freeze([rustSourcePrimitiveTargetType("int32")]),
  });
  const operations: RustProviderOperationDefinition[] = [readOperation];
  if (write !== undefined) {
    operations.push(operationRow({
      ...common,
      operationKind: "index-set",
      target: Object.freeze({
        form: "index",
        indexConversion: rustInt32ToUsizeValueConversion,
      }),
      resultCarrier: rustUnitTargetType(),
      parameterCarriers: Object.freeze([
        rustSourcePrimitiveTargetType("int32"),
        targetElement,
      ]),
    }));
  }
  return Object.freeze({
    members: Object.freeze([member]),
    operations: Object.freeze(operations),
  });
}

function selectStandardSliceIndex(
  method: RustCompilerFunction,
  context: ProjectionContext,
  writable: boolean,
): StandardSliceIndexSelection | undefined {
  const traitPath = writable ? indexMutTraitPath : indexTraitPath;
  if (method.name !== (writable ? "index_mut" : "index") ||
    method.traitDispatch === undefined ||
    canonicalPathKey(method.traitDispatch.identity.canonicalPath) !== canonicalPathKey(traitPath) ||
    method.traitDispatch.arguments.length !== 1 ||
    method.traitDispatch.associatedConstraints.length !== 0 ||
    method.parameters.length !== 1 || method.receiver === undefined ||
    method.receiver.type.kind !== "reference" ||
    method.receiver.type.mutable !== writable ||
    !rustCompilerTypeNamesCurrentType(method.receiver.type.target, context) ||
    method.result.kind !== "reference" || method.result.mutable !== writable ||
    method.result.target.kind !== "associated-type" ||
    canonicalPathKey(method.result.target.trait.identity.canonicalPath) !== canonicalPathKey(indexTraitPath) ||
    canonicalPathKey(method.result.target.item.canonicalPath) !== canonicalPathKey(indexOutputPath) ||
    method.result.target.displayName !== "Output" ||
    method.result.target.arguments.length !== 0 ||
    method.result.target.trait.arguments.length !== 1 ||
    method.result.target.trait.associatedConstraints.length !== 0 ||
    !rustCompilerTypeNamesCurrentType(method.result.target.owner, context) ||
    method.generics.parameters.length !== 0 || method.generics.wherePredicates.length !== 0 ||
    method.enclosingGenerics.parameters.length !== 1 ||
    method.enclosingGenerics.wherePredicates.length !== 0 ||
    method.asynchronous || method.safety !== "safe" || method.abi !== "Rust" || method.variadic) {
    return undefined;
  }
  const parameter = method.enclosingGenerics.parameters[0];
  const traitArgument = method.traitDispatch.arguments[0];
  const outputTraitArgument = method.result.target.trait.arguments[0];
  if (parameter?.kind !== "type" || traitArgument?.kind !== "type" ||
    outputTraitArgument?.kind !== "type" ||
    !isSelectedTypeParameter(traitArgument.value, parameter) ||
    !isSelectedTypeParameter(outputTraitArgument.value, parameter) ||
    !isSelectedTypeParameter(method.parameters[0]!.type, parameter) ||
    parameter.bounds.length !== 1) {
    return undefined;
  }
  const bound = parameter.bounds[0];
  if (bound?.kind !== "trait" || bound.polarity !== "required" || bound.binder !== undefined ||
    canonicalPathKey(bound.trait.identity.canonicalPath) !== canonicalPathKey(sliceIndexTraitPath) ||
    bound.trait.arguments.length !== 1 || bound.trait.associatedConstraints.length !== 0) {
    return undefined;
  }
  const sliceArgument = bound.trait.arguments[0];
  if (sliceArgument?.kind !== "type" || sliceArgument.value.kind !== "slice") return undefined;
  return Object.freeze({ method, element: sliceArgument.value.element, writable });
}

function isSelectedTypeParameter(
  type: RustCompilerType,
  parameter: RustCompilerTypeParameter,
): boolean {
  return type.kind === "type-parameter" &&
    type.identity.itemId === genericParameterIdentity(parameter);
}
