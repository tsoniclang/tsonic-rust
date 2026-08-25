import { functionSignatureDigest, operationRow, typeRequirements } from "./operations.js";
import {
  parameterPassing,
  sourceGenericArgumentFor,
  sourceTypeFor,
  targetGenericArgumentFor,
  targetGenericsFor,
  targetTraitFor,
  targetTypeFor,
} from "./types.js";
import {
  genericNameMap,
  genericParameterIdentity,
  importedSourceType,
  requireCurrentType,
  sourceGenericParameterHasDefault,
  sourceVisibleGenericParameters,
  uniqueText,
} from "./utilities.js";
import { sourceMethodIsInstance } from "./declaration-members.js";
import { rustSourceTypeExportIds } from "../../../source/semantics/identity.js";
import { rustTypesModule } from "../../../source/profiles/source-modules.js";
import type { ProjectionContext } from "./model.js";
import type {
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";
import type {
  RustCompilerFunction,
  RustCompilerGenericParameter,
  RustCompilerType,
} from "../model/model.js";
import type { RustProviderOperationDefinition } from "../../packages/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCompilerGenericParameterDependencies } from "../model/references.js";

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
  const inheritsOwnerSourceParameters = instanceMethod || constructor;
  const callableGenerics = mergeFunctionGenerics(
    inheritsOwnerSourceParameters ? undefined : context.currentType?.generics,
    fn.enclosingGenerics,
    fn.generics,
  );
  const completeTargetGenerics = mergeFunctionGenerics(
    context.currentType?.generics,
    fn.enclosingGenerics,
    fn.generics,
  );
  const ownGenericNames = genericNameMap(
    callableGenerics.parameters,
    new Set(context.genericNames?.values() ?? []),
  );
  const genericNames = new Map([...(context.genericNames ?? []), ...ownGenericNames]);
  const ownerSourceGenericParameters = inheritsOwnerSourceParameters || context.currentType?.generics === undefined
    ? Object.freeze([])
    : sourceVisibleGenericParameters(context.currentType.generics, context);
  const sourceGenericParameters = orderSourceGenericParameters([
      ...ownerSourceGenericParameters,
      ...sourceVisibleGenericParameters(fn.enclosingGenerics, context),
      ...sourceVisibleGenericParameters(fn.generics, context),
  ]);
  const inferredGenericParameters = callableGenerics.parameters.filter((parameter) =>
    parameter.kind === "type" && parameter.declarationKind !== "explicit");
  const baseFunctionContext: ProjectionContext = {
    ...context,
    genericScopeId: fn.identity.itemId,
    genericNames,
    genericParameters: new Map([
      ...(context.genericParameters ?? []),
      ...callableGenerics.parameters.map((parameter) =>
        [genericParameterIdentity(parameter), parameter] as const),
    ]),
  };
  const functionContext: ProjectionContext = context.currentType === undefined || inheritsOwnerSourceParameters
    ? baseFunctionContext
    : {
        ...baseFunctionContext,
        currentType: {
          ...context.currentType,
          sourceType: Object.freeze({
            kind: "provider-ref" as const,
            moduleSpecifier: context.owner.moduleSpecifier,
            exportName: context.currentType.name,
            ...(ownerSourceGenericParameters.length === 0
              ? {}
              : {
                  typeArguments: Object.freeze(ownerSourceGenericParameters.map((parameter) =>
                    sourceGenericParameterArgument(parameter, baseFunctionContext))),
                }),
          }),
        },
      };
  const memberId = context.currentType === undefined
    ? undefined
    : `${exportId}::${constructor ? "constructor" : instanceMethod ? "method" : "static"}:${fn.name}`;
  const signatureId = `${memberId ?? exportId}::signature:${functionSignatureDigest(fn)}`;
  const parameters: ProviderParameterDeclaration[] = [];
  const parameterCarriers: TargetTypeRef[] = [];
  const argumentModes: ("value" | "ref" | "mut-ref")[] = [];
  if (fn.receiver !== undefined && !instanceMethod) {
    const passing = parameterPassing(fn.receiver.type);
    parameters.push(Object.freeze({
      name: "receiver",
      type: sourceTypeFor(passing.type, functionContext, "parameter"),
      ...(passing.sourceMode === "by-value" ? {} : { passingMode: passing.sourceMode }),
    }));
    parameterCarriers.push(targetTypeFor(passing.type, functionContext, "parameter"));
    argumentModes.push(passing.targetMode);
  }
  for (let parameterIndex = 0; parameterIndex < fn.parameters.length; parameterIndex += 1) {
    const parameter = fn.parameters[parameterIndex]!;
    const passing = parameterPassing(parameter.type);
    parameters.push(Object.freeze({
      name: `argument${parameterIndex}`,
      type: sourceTypeFor(passing.type, functionContext, "parameter"),
      ...(passing.sourceMode === "by-value" ? {} : { passingMode: passing.sourceMode }),
    }));
    parameterCarriers.push(targetTypeFor(passing.type, functionContext, "parameter"));
    argumentModes.push(passing.targetMode);
  }
  if (fn.variadic) {
    const variadicType: ProviderTypeExpression = {
      kind: "array",
      elementType: { kind: "unknown" },
    };
    const variadicParameter: ProviderParameterDeclaration = Object.freeze({
      name: uniqueVariadicParameterName(parameters),
      type: variadicType,
      rest: true,
    });
    parameters.push(variadicParameter);
  }
  const result = compilerFunctionResult(fn.result);
  const resultCarrier = constructor
    ? requireCurrentType(context).carrier
    : targetTypeFor(result.type, functionContext, "result");
  const returnType = constructor ? undefined : sourceTypeFor(result.type, functionContext, "result");
  const methodTypeParameters = providerTypeParameters(
    sourceGenericParameters,
    functionContext,
  );
  const sourceTypeParameterNames = methodTypeParameters.map((parameter) => parameter.name);
  const allTypeParameters = uniqueText([
    ...(context.currentType?.typeParameters ?? []),
    ...sourceTypeParameterNames,
  ]);
  const sourceGenericBindings = providerSourceGenericBindings(
    inheritsOwnerSourceParameters
      ? [...(context.currentType?.genericParameters ?? []), ...sourceGenericParameters]
      : sourceGenericParameters,
    functionContext,
  );
  const targetGenericArguments = Object.freeze(sourceGenericParameters.map((parameter) =>
    targetGenericParameterArgument(parameter, functionContext)));
  const targetInferenceParameters = Object.freeze([
    ...(inheritsOwnerSourceParameters
      ? context.currentType?.targetInferenceParameters ?? []
      : []),
    ...inferredGenericParameters.map((parameter) =>
      targetGenericParameterArgument(parameter, functionContext)),
  ]);
  if (fn.variadic && (context.currentType !== undefined || fn.receiver !== undefined)) {
    throw new Error(`Rust C-variadic function '${fn.name}' must be one free provider function.`);
  }
  const receiverMode = fn.receiver === undefined || !instanceMethod
    ? undefined
    : parameterPassing(fn.receiver.type).targetMode;
  const targetReceiver = fn.receiver === undefined
    ? undefined
    : Object.freeze({
        type: targetTypeFor(fn.receiver.type, functionContext, "parameter"),
        explicit: fn.receiver.explicit,
      });
  const traitTarget = fn.traitDispatch === undefined
    ? undefined
    : {
        form: "trait-call" as const,
        owner: requireCurrentType(context).carrier,
        trait: targetTraitFor(fn.traitDispatch, functionContext, "parameter"),
        method: fn.name,
        ...(instanceMethod && receiverMode !== undefined ? { receiverMode } : {}),
        ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
      };
  const target = traitTarget ?? (fn.variadic
    ? { form: "call-c-variadic" as const, path: ownerTargetPath.join("::"), fixedArgumentModes: argumentModes }
    : context.currentType === undefined || !instanceMethod
      ? {
          form: "call" as const,
          path: context.currentType === undefined ? ownerTargetPath.join("::") : [...ownerTargetPath, fn.name].join("::"),
          ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
        }
      : {
          form: "receiver-method" as const,
          name: fn.name,
          ...(argumentModes.every((mode) => mode === "value") ? {} : { argModes: argumentModes }),
          ...(receiverMode === "mut-ref" ? { mutatesReceiver: true } : {}),
        });
  const operation = {
    exportId,
    ...(memberId === undefined ? {} : { memberId }),
    signatureId,
    operationKind: constructor ? "constructor" as const : "method" as const,
    target,
    resultCarrier,
    parameterCarriers,
    ...(context.currentType === undefined || !instanceMethod ? {} : { receiverCarrier: context.currentType.carrier }),
    ...(targetReceiver === undefined ? {} : { targetReceiver }),
    ...(sourceGenericBindings.length === 0 ? {} : { sourceGenericBindings }),
    ...(targetInferenceParameters.length === 0 ? {} : { targetInferenceParameters }),
    targetGenerics: targetGenericsFor(completeTargetGenerics, functionContext),
    targetCallableGenerics: targetGenericsFor(callableGenerics, functionContext),
    ...typeRequirements(completeTargetGenerics, allTypeParameters, functionContext),
    ...(targetGenericArguments.length === 0 ? {} : { targetGenericArguments }),
    ...(fn.asynchronous ? { isAsync: true as const } : {}),
    ...(fn.safety === "unsafe" ? { isUnsafe: true as const } : {}),
  };
  return {
    ...(memberId === undefined ? {} : { memberId }),
    signature: Object.freeze({
      id: signatureId,
      name: fn.name,
      parameters: Object.freeze(parameters),
      ...(returnType === undefined ? {} : { returnType }),
      ...(methodTypeParameters.length === 0 ? {} : { typeParameters: Object.freeze(methodTypeParameters) }),
    }),
    operation: result.fallible
      ? operationRow({ ...operation, isFallible: true, errorBoundary: "target-runtime" })
      : operationRow(operation),
  };
}

function mergeFunctionGenerics(
  ...parts: readonly (import("../model/model.js").RustCompilerGenerics | undefined)[]
): import("../model/model.js").RustCompilerGenerics {
  const parameters = new Map<string, RustCompilerGenericParameter>();
  const wherePredicates: import("../model/model.js").RustCompilerGenerics["wherePredicates"][number][] = [];
  for (const part of parts) {
    if (part === undefined) continue;
    for (const parameter of part.parameters) {
      const identity = genericParameterIdentity(parameter);
      const existing = parameters.get(identity);
      if (existing !== undefined && existing !== parameter) {
        throw new Error(`Rust callable generic '${identity}' has contradictory declarations.`);
      }
      parameters.set(identity, parameter);
    }
    wherePredicates.push(...part.wherePredicates);
  }
  return Object.freeze({
    parameters: Object.freeze([...parameters.values()]),
    wherePredicates: Object.freeze(wherePredicates),
  });
}

function orderSourceGenericParameters(
  parameters: readonly RustCompilerGenericParameter[],
): readonly RustCompilerGenericParameter[] {
  const identities = new Set(parameters.map(genericParameterIdentity));
  const remaining = parameters.map((parameter) => Object.freeze({
    parameter,
    dependencies: new Set([...rustCompilerGenericParameterDependencies(parameter)]
      .filter((identity) => identities.has(identity) && identity !== genericParameterIdentity(parameter))),
  }));
  const ordered: RustCompilerGenericParameter[] = [];
  const selected = new Set<string>();
  while (remaining.length > 0) {
    const ready = remaining.filter(({ dependencies }) =>
      [...dependencies].every((identity) => selected.has(identity)));
    const next = ready.find(({ parameter }) => !sourceGenericParameterHasDefault(parameter)) ?? ready[0];
    if (next === undefined) {
      throw new Error("Rust source generic parameters contain a cyclic declaration dependency.");
    }
    remaining.splice(remaining.indexOf(next), 1);
    ordered.push(next.parameter);
    selected.add(genericParameterIdentity(next.parameter));
  }
  const firstDefault = ordered.findIndex(sourceGenericParameterHasDefault);
  if (firstDefault >= 0 && ordered.slice(firstDefault).some((parameter) =>
    !sourceGenericParameterHasDefault(parameter))) {
    throw new Error("Rust source generic dependencies require a defaulted parameter before a required parameter.");
  }
  return Object.freeze(ordered);
}

export function selectUnambiguousMembers(
  members: readonly ProviderMemberDeclaration[],
  operations: readonly RustProviderOperationDefinition[],
): { readonly members: readonly ProviderMemberDeclaration[]; readonly operations: readonly RustProviderOperationDefinition[] } {
  const groups = new Map<string, ProviderMemberDeclaration[]>();
  for (const member of members) {
    if (typeof member.name !== "string") throw new Error("Rust compiler providers may expose only identifier-named source members.");
    const key = `${member.static === true ? "static" : "instance"}\0${member.name}`;
    const group = groups.get(key) ?? [];
    group.push(member);
    groups.set(key, group);
  }
  const ambiguous = new Set([...groups.values()].filter((group) => group.length > 1).flatMap((group) => group.map((member) => member.id)));
  return Object.freeze({
    members: Object.freeze(members.filter((member) => !ambiguous.has(member.id))),
    operations: Object.freeze(operations.filter((operation) => operation.memberId === undefined || !ambiguous.has(operation.memberId))),
  });
}

export function compilerFunctionResult(type: RustCompilerType): { readonly type: RustCompilerType; readonly fallible: boolean } {
  if (type.kind === "path" && isTsonicResultPath(type)) {
    const typeArguments = type.arguments.flatMap((argument) => argument.kind === "type" ? [argument.value] : []);
    return { type: typeArguments[0]!, fallible: true };
  }
  return { type, fallible: false };
}

export function providerTypeParameters(
  parameters: readonly RustCompilerGenericParameter[],
  context: ProjectionContext,
): readonly ProviderTypeParameterDeclaration[] {
  return Object.freeze(parameters.map((parameter): ProviderTypeParameterDeclaration => {
    const name = context.genericNames?.get(genericParameterIdentity(parameter));
    if (name === undefined) throw new Error("Rust generic parameter has no source-visible name.");
    if (parameter.kind === "lifetime") {
      const constraint = importedSourceType(
        context,
        rustTypesModule,
        rustSourceTypeExportIds.life,
        [],
      );
      return Object.freeze({
        name,
        constraints: Object.freeze([constraint]),
      });
    }
    if (parameter.kind === "const") {
      const constraint = importedSourceType(
        context,
        rustTypesModule,
        rustSourceTypeExportIds.constParameter,
        [sourceTypeFor(parameter.type, context, "parameter", true)],
      );
      return Object.freeze({
        name,
        constraints: Object.freeze([constraint]),
        ...(parameter.defaultValue === undefined ? {} : {
          defaultType: sourceGenericArgumentFor({ kind: "const", value: parameter.defaultValue }, context, "parameter"),
        }),
      });
    }
    return Object.freeze({
      name,
      ...(!sourceGenericParameterHasDefault(parameter) || parameter.defaultType === undefined
        ? {}
        : { defaultType: sourceTypeFor(parameter.defaultType, context, "parameter", true) }),
    });
  }));
}

export function targetGenericParameterArgument(
  parameter: RustCompilerGenericParameter,
  context: ProjectionContext,
): import("../../../target-model/semantics/index.js").RustGenericArgument {
  if (parameter.kind === "lifetime") {
    return targetGenericArgumentFor({ kind: "lifetime", value: parameter.identity }, context, "parameter");
  }
  if (parameter.kind === "type") {
    return targetGenericArgumentFor({
      kind: "type",
      value: { kind: "type-parameter", identity: parameter.identity, displayName: parameter.displayName },
    }, context, "parameter");
  }
  return targetGenericArgumentFor({
    kind: "const",
    value: {
      kind: "parameter",
      identity: parameter.identity,
      displayName: parameter.displayName,
    },
  }, context, "parameter");
}

export function sourceGenericParameterArgument(
  parameter: RustCompilerGenericParameter,
  context: ProjectionContext,
): ProviderTypeExpression {
  if (parameter.kind === "lifetime") {
    return sourceGenericArgumentFor({ kind: "lifetime", value: parameter.identity }, context, "result");
  }
  if (parameter.kind === "type") {
    const name = context.genericNames?.get(genericParameterIdentity(parameter));
    if (name === undefined) {
      throw new Error("Rust generic parameter has no exact source declaration identity.");
    }
    return Object.freeze({ kind: "type-parameter", name });
  }
  return sourceGenericArgumentFor({
    kind: "const",
    value: { kind: "parameter", identity: parameter.identity, displayName: parameter.displayName },
  }, context, "result");
}

export function providerSourceGenericBindings(
  parameters: readonly RustCompilerGenericParameter[],
  context: ProjectionContext,
): readonly import("../../../target-model/operations/model.js").RustProviderSourceGenericBinding[] {
  return Object.freeze(parameters.map((parameter) => {
    const sourceName = context.genericNames?.get(genericParameterIdentity(parameter));
    if (sourceName === undefined) {
      throw new Error("Rust generic parameter has no exact source-to-target parameter relation.");
    }
    return Object.freeze({
      sourceName,
      target: Object.freeze({
        kind: "generic-parameter" as const,
        parameter: targetGenericParameterArgument(parameter, context),
      }),
    });
  }));
}

function uniqueVariadicParameterName(parameters: readonly ProviderParameterDeclaration[]): string {
  const occupied = new Set(parameters.map((parameter) => parameter.name));
  let name = "variadicArguments";
  while (occupied.has(name)) name = `_${name}`;
  return name;
}

function isTsonicResultPath(type: Extract<RustCompilerType, { readonly kind: "path" }>): boolean {
  return type.crateName === "tsonic_rust_runtime" && type.modulePath.length === 1 &&
    type.modulePath[0] === "error" && type.name === "TsonicResult" &&
    type.arguments.length === 1 && type.arguments[0]?.kind === "type";
}
