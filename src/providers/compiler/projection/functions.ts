import { functionSignatureDigest, operationRow, targetTraitPath, typeRequirements } from "./operations.js";
import { parameterPassing, sourceTypeFor, targetTypeFor } from "./types.js";
import { requireCurrentType, uniqueText } from "./utilities.js";
import { rustBorrowedStrToStringValueConversion } from "../../../target-model/conversions/model.js";
import { sourceMethodIsInstance } from "./declarations.js";
import type { ProjectionContext } from "./model.js";
import type { ProviderMemberDeclaration, ProviderParameterDeclaration, ProviderSignatureDeclaration } from "@tsonic/tsts";
import type { RustCompilerFunction, RustCompilerType } from "../model/model.js";
import type { RustProviderOperationDefinition } from "../../packages/model.js";
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
  const parameters: ProviderParameterDeclaration[] = [];
  const parameterCarriers: TargetTypeRef[] = [];
  const argumentModes: ("value" | "ref" | "mut-ref")[] = [];
  if (fn.receiver?.kind === "custom") {
    const passing = parameterPassing(fn.receiver.type);
    parameters.push(Object.freeze({
      name: "receiver",
      type: sourceTypeFor(passing.type, context, "parameter"),
      ...(passing.sourceMode === "by-value" ? {} : { passingMode: passing.sourceMode }),
    }));
    parameterCarriers.push(targetTypeFor(passing.type, context, "parameter"));
    argumentModes.push(passing.targetMode);
  }
  for (let parameterIndex = 0; parameterIndex < fn.parameters.length; parameterIndex += 1) {
    const parameter = fn.parameters[parameterIndex]!;
    const passing = parameterPassing(parameter.type);
    parameters.push(Object.freeze({
      name: `argument${parameterIndex}`,
      type: sourceTypeFor(passing.type, context, "parameter"),
      ...(passing.sourceMode === "by-value" ? {} : { passingMode: passing.sourceMode }),
    }));
    parameterCarriers.push(targetTypeFor(passing.type, context, "parameter"));
    argumentModes.push(passing.targetMode);
  }
  if (fn.variadic) {
    parameters.push(Object.freeze({
      name: uniqueVariadicParameterName(parameters),
      type: { kind: "array", elementType: { kind: "unknown" } },
      rest: true,
    } satisfies ProviderParameterDeclaration));
  }
  const result = compilerFunctionResult(fn.result);
  const exposedResultType = fn.borrowedResult?.sourceType ?? result.type;
  const resultCarrier = constructor
    ? requireCurrentType(context).carrier
    : targetTypeFor(exposedResultType, context, "result");
  const returnType = constructor ? undefined : sourceTypeFor(exposedResultType, context, "result");
  const resultConversion = fn.borrowedResult === undefined
    ? undefined
    : fn.borrowedResult.conversion === "owned-string"
      ? rustBorrowedStrToStringValueConversion
      : Object.freeze({ kind: "copy-from-reference" as const, target: resultCarrier });
  const methodTypeParameters = uniqueText([
    ...(context.currentType !== undefined && !instanceMethod && !constructor
      ? context.currentType.typeParameters
      : []),
    ...fn.typeParameters.map((parameter) => parameter.name),
  ]);
  const allTypeParameters = uniqueText([
    ...(context.currentType?.typeParameters ?? []),
    ...methodTypeParameters,
  ]);
  const targetTypeArguments = Object.freeze(fn.typeParameters.map(({ name }): TargetTypeRef => Object.freeze({
    kind: "type-parameter",
    name,
  })));
  if (fn.variadic && (context.currentType !== undefined || fn.receiver !== undefined)) {
    throw new Error(`Rust C-variadic function '${fn.name}' must be one free provider function.`);
  }
  const traitTarget = fn.traitDispatch === undefined
    ? undefined
    : {
        form: "trait-call" as const,
        owner: requireCurrentType(context).carrier,
        traitPath: targetTraitPath(fn.traitDispatch.path, context),
        traitTypeArguments: fn.traitDispatch.typeArguments.map((argument) =>
          targetTypeFor(argument, context, "result", true)),
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
        ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
      };
  const target = traitTarget ?? (fn.variadic
    ? {
        form: "call-c-variadic" as const,
        path: ownerTargetPath.join("::"),
        fixedArgumentModes: argumentModes,
      }
    : context.currentType === undefined || !instanceMethod
    ? {
        form: "call" as const,
        path: context.currentType === undefined
          ? ownerTargetPath.join("::")
          : [...ownerTargetPath, fn.name].join("::"),
        ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
      }
    : {
        form: "receiver-method" as const,
        name: fn.name,
        ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
        ...(fn.receiver?.kind === "mutable" ? { mutatesReceiver: true } : {}),
      });
  const operation = {
    exportId,
    ...(memberId === undefined ? {} : { memberId }),
    signatureId,
    operationKind: constructor ? "constructor" as const : "method" as const,
    target,
    resultCarrier,
    parameterCarriers,
    ...(context.currentType === undefined || !instanceMethod
      ? {}
      : { receiverCarrier: context.currentType.carrier }),
    ...(allTypeParameters.length === 0 ? {} : { typeParameters: allTypeParameters }),
    ...typeRequirements(fn.typeRequirements, allTypeParameters),
    ...(targetTypeArguments.length === 0 ? {} : { targetTypeArguments }),
    ...(resultConversion === undefined ? {} : { resultConversion }),
    ...(fn.asynchronous ? { isAsync: true as const } : {}),
    ...(fn.unsafe ? { isUnsafe: true as const } : {}),
  };
  return {
    ...(memberId === undefined ? {} : { memberId }),
    signature: Object.freeze({
      id: signatureId,
      name: fn.name,
      parameters: Object.freeze(parameters),
      ...(returnType === undefined ? {} : { returnType }),
      ...(methodTypeParameters.length === 0
        ? {}
        : { typeParameters: Object.freeze(methodTypeParameters.map((name) => Object.freeze({ name }))) }),
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
    if (group.length <= 1) {
      continue;
    }
    for (const member of group) {
      ambiguousMemberIds.add(member.id);
    }
  }
  return {
    members: Object.freeze(members.filter((member) => !ambiguousMemberIds.has(member.id))),
    operations: Object.freeze(operations.filter((operation) =>
      operation.memberId === undefined || !ambiguousMemberIds.has(operation.memberId))),
  };
}

function uniqueVariadicParameterName(
  parameters: readonly ProviderParameterDeclaration[],
): string {
  const occupied = new Set(parameters.map((parameter) => parameter.name));
  let name = "variadicArguments";
  while (occupied.has(name)) {
    name = `_${name}`;
  }
  return name;
}

export function compilerFunctionResult(type: RustCompilerType): {
  readonly type: RustCompilerType;
  readonly fallible: boolean;
} {
  if (type.kind === "path" && isTsonicResultPath(type)) {
    return { type: type.typeArguments[0]!, fallible: true };
  }
  return { type, fallible: false };
}

function isTsonicResultPath(type: Extract<RustCompilerType, { readonly kind: "path" }>): boolean {
  return type.crateName === "tsonic_rust_runtime" &&
    type.modulePath.length === 1 &&
    type.modulePath[0] === "error" &&
    type.name === "TsonicResult" &&
    type.typeArguments.length === 1;
}
