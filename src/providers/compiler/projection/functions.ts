import {
  functionSignatureDigest,
  operationRow,
  targetTraitPath,
  typeRequirements,
} from "./operations.js";
import {
  parameterPassing,
  providerGenericBindingsFor,
  providerGenericParametersFor,
  sourceTypeFor,
  targetGenericArgumentFor,
  targetGenericParameterArguments,
  targetTypeFor,
} from "./types.js";
import {
  requireCurrentType,
  withProjectionGenericParameters,
} from "./utilities.js";
import {
  referencedCallableOwnerGenericParameters,
  sourceCallableGenericParameters,
} from "./source-generics.js";
import { compilerFunctionResult } from "./representability.js";
import {
  rustBorrowedStrToStringValueConversion,
} from "../../../target-model/conversions/model.js";
import type { ProjectionContext } from "./model.js";
import type {
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
} from "@tsonic/tsts";
import type {
  RustCompilerFunction,
  RustCompilerGenericParameter,
  RustCompilerType,
} from "../model/model.js";
import type {
  RustProviderOperationDefinition,
} from "../../packages/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function projectFunction(
  fn: RustCompilerFunction,
  context: ProjectionContext,
  exportId: string,
  constructor: boolean,
  ownerTargetPath: readonly string[],
): {
  readonly memberId?: string;
  readonly signature: ProviderSignatureDeclaration;
  readonly operation: RustProviderOperationDefinition;
} {
  const instanceMethod = sourceMethodIsInstance(fn);
  const memberId = context.currentType === undefined
    ? undefined
    : `${exportId}::${constructor ? "constructor" : instanceMethod ? "method" : "static"}:${fn.name}`;
  const signatureId = `${memberId ?? exportId}::signature:${functionSignatureDigest(fn)}`;
  const ownerGenerics = context.currentType?.genericParameters ?? [];
  const functionContext = withProjectionGenericParameters(
    context,
    fn.genericParameters,
  );
  const parameters: ProviderParameterDeclaration[] = [];
  const parameterCarriers: TargetTypeRef[] = [];
  const argumentModes: ("value" | "ref" | "mut-ref")[] = [];

  if (fn.receiver?.kind === "custom") {
    projectParameter(
      "receiver",
      fn.receiver.type,
      functionContext,
      parameters,
      parameterCarriers,
      argumentModes,
    );
  }
  for (const [parameterIndex, parameter] of fn.parameters.entries()) {
    projectParameter(
      `argument${parameterIndex}`,
      parameter.type,
      functionContext,
      parameters,
      parameterCarriers,
      argumentModes,
    );
  }
  if (fn.variadic) {
    parameters.push(Object.freeze({
      name: uniqueVariadicParameterName(parameters),
      type: Object.freeze({
        kind: "array" as const,
        elementType: Object.freeze({ kind: "unknown" as const }),
      }),
      rest: true,
    }));
  }
  if (fn.variadic && (context.currentType !== undefined || fn.receiver !== undefined)) {
    throw new Error(`Rust C-variadic function '${fn.name}' must be one free provider function.`);
  }

  const result = compilerFunctionResult(fn.result);
  const exposedResultType = fn.borrowedResult?.sourceType ?? result.type;
  const resultCarrier = targetTypeFor(exposedResultType, functionContext, "result");
  const returnType = constructor
    ? undefined
    : sourceTypeFor(exposedResultType, functionContext, "result");
  const resultConversion = fn.borrowedResult === undefined
    ? undefined
    : fn.borrowedResult.conversion === "owned-string"
      ? rustBorrowedStrToStringValueConversion
      : Object.freeze({ kind: "copy-from-reference" as const, target: resultCarrier });

  const selectedOwnerGenerics = context.currentType !== undefined &&
      !instanceMethod
    ? referencedCallableOwnerGenericParameters(ownerGenerics, fn)
    : ownerGenerics;
  const signatureGenerics = sourceCallableGenericParameters(
    context.currentType !== undefined && !instanceMethod && !constructor
      ? selectedOwnerGenerics
      : [],
    fn.genericParameters,
  );
  const operationGenerics = combineGenericParameters(
    selectedOwnerGenerics,
    fn.genericParameters,
  );
  const operationGenericBindings = providerGenericBindingsFor(
    operationGenerics,
    functionContext,
  );
  const operationTypeNames = operationGenericBindings.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.sourceName] : []);
  const targetGenericArguments = targetGenericParameterArguments(
    fn.genericParameters,
    functionContext,
  );

  const target = fn.traitDispatch === undefined
    ? ordinaryFunctionTarget(
        fn,
        context,
        ownerTargetPath,
        instanceMethod,
        argumentModes,
      )
    : {
        form: "trait-call" as const,
        owner: requireCurrentType(context).carrier,
        traitPath: targetTraitPath(fn.traitDispatch.path, functionContext),
        traitGenericArguments: fn.traitDispatch.genericArguments.map((argument) =>
          targetGenericArgumentFor(argument, functionContext, "result")),
        method: fn.name,
        ...(instanceMethod
          ? {
              receiverMode: fn.receiver?.kind === "value"
                ? "value" as const
                : fn.receiver?.kind === "mutable"
                  ? "mut-ref" as const
                  : "ref" as const,
            }
          : {}),
        ...(argumentModes.every((mode) => mode === "value")
          ? {}
          : { argModes: Object.freeze(argumentModes) }),
      };
  const operation = {
    exportId,
    ...(memberId === undefined ? {} : { memberId }),
    signatureId,
    operationKind: constructor ? "constructor" as const : "method" as const,
    target,
    resultCarrier,
    parameterCarriers: Object.freeze(parameterCarriers),
    ...(context.currentType === undefined || !instanceMethod
      ? {}
      : { receiverCarrier: context.currentType.carrier }),
    ...(operationGenericBindings.length === 0
      ? {}
      : { genericParameters: operationGenericBindings }),
    ...typeRequirements(fn.typeRequirements, operationTypeNames),
    ...(targetGenericArguments.length === 0
      ? {}
      : { targetGenericArguments }),
    ...(resultConversion === undefined ? {} : { resultConversion }),
    ...(fn.asynchronous ? { isAsync: true as const } : {}),
    ...(fn.unsafe ? { isUnsafe: true as const } : {}),
  };
  const sourceTypeParameters = providerGenericParametersFor(
    signatureGenerics,
    functionContext,
  );
  return {
    ...(memberId === undefined ? {} : { memberId }),
    signature: Object.freeze({
      id: signatureId,
      name: fn.name,
      parameters: Object.freeze(parameters),
      ...(returnType === undefined ? {} : { returnType }),
      ...(sourceTypeParameters.length === 0
        ? {}
        : { typeParameters: sourceTypeParameters }),
    }),
    operation: result.fallible
      ? operationRow({
          ...operation,
          isFallible: true,
          errorBoundary: "target-runtime",
        })
      : operationRow(operation),
  };
}

function projectParameter(
  name: string,
  type: RustCompilerType,
  context: ProjectionContext,
  parameters: ProviderParameterDeclaration[],
  carriers: TargetTypeRef[],
  modes: ("value" | "ref" | "mut-ref")[],
): void {
  const passing = parameterPassing(type);
  parameters.push(Object.freeze({
    name,
    type: sourceTypeFor(passing.type, context, "parameter"),
    ...(passing.sourceMode === "by-value"
      ? {}
      : { passingMode: passing.sourceMode }),
  }));
  carriers.push(targetTypeFor(passing.type, context, "parameter"));
  modes.push(passing.targetMode);
}

function ordinaryFunctionTarget(
  fn: RustCompilerFunction,
  context: ProjectionContext,
  ownerTargetPath: readonly string[],
  instanceMethod: boolean,
  argumentModes: readonly ("value" | "ref" | "mut-ref")[],
): import("../../../target-model/operations/model.js").RustProviderOperationForm {
  if (fn.variadic) {
    return {
      form: "call-c-variadic",
      path: ownerTargetPath.join("::"),
      fixedArgumentModes: argumentModes,
    };
  }
  if (context.currentType === undefined || !instanceMethod) {
    return {
      form: "call",
      path: context.currentType === undefined
        ? ownerTargetPath.join("::")
        : [...ownerTargetPath, fn.name].join("::"),
      ...(argumentModes.every((mode) => mode === "value")
        ? {}
        : { argModes: argumentModes }),
    };
  }
  return {
    form: "receiver-method",
    name: fn.name,
    ...(argumentModes.every((mode) => mode === "value")
      ? {}
      : { argModes: argumentModes }),
    ...(fn.receiver?.kind === "mutable" ? { mutatesReceiver: true } : {}),
  };
}

function combineGenericParameters(
  left: readonly RustCompilerGenericParameter[],
  right: readonly RustCompilerGenericParameter[],
): readonly RustCompilerGenericParameter[] {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  return Object.freeze([...left, ...right]);
}

export function selectUnambiguousMembers(
  members: readonly ProviderMemberDeclaration[],
  operations: readonly RustProviderOperationDefinition[],
): {
  readonly members: readonly ProviderMemberDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const membersBySourceSlot = new Map<string, ProviderMemberDeclaration[]>();
  for (const member of members) {
    if (typeof member.name !== "string") {
      throw new Error("Rust compiler providers may expose only identifier-named source members.");
    }
    const key = `${member.static === true ? "static" : "instance"}\0${member.name}`;
    const group = membersBySourceSlot.get(key) ?? [];
    group.push(member);
    membersBySourceSlot.set(key, group);
  }
  const ambiguousMemberIds = new Set<string>();
  for (const group of membersBySourceSlot.values()) {
    if (group.length <= 1) continue;
    for (const member of group) ambiguousMemberIds.add(member.id);
  }
  return Object.freeze({
    members: Object.freeze(members.filter((member) =>
      !ambiguousMemberIds.has(member.id))),
    operations: Object.freeze(operations.filter((operation) =>
      operation.memberId === undefined || !ambiguousMemberIds.has(operation.memberId))),
  });
}

function uniqueVariadicParameterName(
  parameters: readonly ProviderParameterDeclaration[],
): string {
  const occupied = new Set(parameters.map((parameter) => parameter.name));
  let name = "variadicArguments";
  while (occupied.has(name)) name = `_${name}`;
  return name;
}

export function sourceMethodIsInstance(method: RustCompilerFunction): boolean {
  return method.receiver?.kind === "value" ||
    method.receiver?.kind === "shared" ||
    method.receiver?.kind === "mutable";
}
