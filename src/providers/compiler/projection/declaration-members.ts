import {
  compareText,
  genericNameMap,
  genericParameterIdentity,
  requireCurrentType,
  rustCompilerTypeNamesCurrentType,
} from "./utilities.js";
import { operationRow, typeRequirements } from "./operations.js";
import {
  compilerFunctionResult,
  projectFunction,
  providerSourceGenericBindings,
  providerTypeParameters,
  targetGenericParameterArgument,
} from "./functions.js";
import {
  sourceTypeFor,
  targetGenericsFor,
  targetTraitFor,
  targetTypeFor,
} from "./types.js";
import { rustUnitTargetType } from "../../../target-model/types/index.js";
import type {
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderPropertyName,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";
import type {
  RustCompilerAssociatedConstant,
  RustCompilerEnumVariant,
  RustCompilerField,
  RustCompilerFunction,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerGenerics,
} from "../model/model.js";
import type { ProjectionContext } from "./model.js";
import type { RustProviderOperationDefinition } from "../../packages/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function genericParameterProjectionMap(
  parameters: readonly RustCompilerGenericParameter[],
): ReadonlyMap<string, RustCompilerGenericParameter> {
  return new Map(parameters.map((parameter) => [genericParameterIdentity(parameter), parameter]));
}

export function uniqueProjectionGenericNames(
  parameters: readonly RustCompilerGenericParameter[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const occupied = new Set<string>();
  for (const [index, parameter] of parameters.entries()) {
    const base = parameter.kind === "lifetime"
      ? parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
        ? `L_${parameter.identity.displayName}`
        : "L_static"
      : parameter.kind === "const"
        ? `N_${parameter.displayName}`
        : parameter.displayName;
    const safeBase = /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(base) ? base : `G${index}`;
    let name = safeBase;
    let suffix = 2;
    while (occupied.has(name)) {
      name = `${safeBase}_${suffix}`;
      suffix += 1;
    }
    occupied.add(name);
    names.set(genericParameterIdentity(parameter), name);
  }
  return names;
}

export function compilerGenericParameterArgument(
  parameter: RustCompilerGenericParameter,
): RustCompilerGenericArgument {
  if (parameter.kind === "lifetime") {
    return Object.freeze({ kind: "lifetime", value: parameter.identity });
  }
  if (parameter.kind === "type") {
    return Object.freeze({
      kind: "type",
      value: Object.freeze({
        kind: "type-parameter",
        identity: parameter.identity,
        displayName: parameter.displayName,
      }),
    });
  }
  return Object.freeze({
    kind: "const",
    value: Object.freeze({
      kind: "parameter",
      identity: parameter.identity,
      displayName: parameter.displayName,
    }),
  });
}

export function projectFields(
  fields: readonly RustCompilerField[],
  union: boolean,
  context: ProjectionContext,
  exportId: string,
  receiverCarrier: TargetTypeRef,
  generics: RustCompilerGenerics,
  members: ProviderMemberDeclaration[],
  operations: RustProviderOperationDefinition[],
): void {
  for (const field of fields) {
    const memberId = `${exportId}::field:${field.identity.itemId}`;
    const sourceType = sourceTypeFor(field.type, context, "result");
    const targetType = targetTypeFor(field.type, context, "result");
    members.push(Object.freeze({
      id: memberId,
      name: providerFieldName(field.name),
      kind: "property",
      type: sourceType,
    }));
    const common = {
      exportId,
      memberId,
      receiverCarrier,
      sourceGenericBindings: providerSourceGenericBindings(
        requireCurrentType(context).genericParameters,
        context,
      ),
      targetGenerics: targetGenericsFor(generics, context),
      ...typeRequirements(generics, requireCurrentType(context).typeParameters, context),
    };
    operations.push(operationRow({
      ...common,
      operationKind: "property",
      target: fieldTarget(field),
      resultCarrier: targetType,
      ...(union ? { isUnsafe: true } : {}),
    }));
    operations.push(operationRow({
      ...common,
      operationKind: "property-set",
      target: fieldTarget(field),
      resultCarrier: rustUnitTargetType(),
      parameterCarriers: [targetType],
      ...(union ? { isUnsafe: true } : {}),
    }));
  }
}

function fieldTarget(
  field: RustCompilerField,
): { readonly form: "field"; readonly name: string } | { readonly form: "tuple-field"; readonly index: number } {
  const index = parseTupleFieldIndex(field.name);
  return index === undefined ? { form: "field", name: field.name } : { form: "tuple-field", index };
}

function providerFieldName(name: string): ProviderPropertyName {
  const index = parseTupleFieldIndex(name);
  return index === undefined ? name : { kind: "number-literal", value: index };
}

function parseTupleFieldIndex(name: string): number | undefined {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(name)) return undefined;
  const value = Number(name);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function projectEnumVariants(
  variants: readonly RustCompilerEnumVariant[],
  context: ProjectionContext,
  exportId: string,
  resultCarrier: TargetTypeRef,
  sourceResult: ProviderTypeExpression,
  generics: RustCompilerGenerics,
  members: ProviderMemberDeclaration[],
  operations: RustProviderOperationDefinition[],
): void {
  const owner = requireCurrentType(context);
  for (const variant of variants) {
    const memberId = `${exportId}::variant:${variant.identity.itemId}`;
    const path = [...owner.targetPath, variant.name].join("::");
    if (variant.fields.kind === "unit") {
      if (owner.genericParameters.length === 0) {
        members.push(Object.freeze({
          id: memberId,
          name: variant.name,
          kind: "field",
          static: true,
          type: sourceResult,
        }));
        operations.push(operationRow({
          exportId,
          memberId,
          operationKind: "property",
          target: { form: "path", path },
          resultCarrier,
        }));
      } else {
        const signatureId = `${memberId}::signature`;
        members.push(Object.freeze({
          id: memberId,
          name: variant.name,
          kind: "method",
          static: true,
          signatures: Object.freeze([Object.freeze({
            id: signatureId,
            name: variant.name,
            parameters: Object.freeze([]),
            returnType: sourceResult,
            typeParameters: Object.freeze(owner.genericParameters.map((parameter, index) =>
              providerGenericParameter(parameter, context, index))),
          })]),
        }));
        operations.push(operationRow({
          exportId,
          memberId,
          signatureId,
          operationKind: "method",
          target: { form: "path", path },
          resultCarrier,
          sourceGenericBindings: providerSourceGenericBindings(owner.genericParameters, context),
          targetGenerics: targetGenericsFor(generics, context),
          targetGenericArguments: owner.genericParameters.map((parameter) =>
            targetGenericParameterArgument(parameter, context)),
          ...typeRequirements(generics, owner.typeParameters, context),
        }));
      }
      continue;
    }
    const fields = variant.fields.fields;
    const parameters: ProviderParameterDeclaration[] = fields.map((field, index) => Object.freeze({
      name: variant.fields.kind === "struct" ? field.name : `value${index}`,
      type: sourceTypeFor(field.type, context, "parameter"),
    }));
    const parameterCarriers = fields.map((field) => targetTypeFor(field.type, context, "parameter"));
    const signatureId = `${memberId}::signature`;
    members.push(Object.freeze({
      id: memberId,
      name: variant.name,
      kind: "method",
      static: true,
      signatures: Object.freeze([Object.freeze({
        id: signatureId,
        name: variant.name,
        parameters: Object.freeze(parameters),
        returnType: sourceResult,
        ...(owner.genericParameters.length === 0
          ? {}
          : {
              typeParameters: Object.freeze(owner.genericParameters.map((parameter, index) =>
                providerGenericParameter(parameter, context, index))),
            }),
      })]),
    }));
    const targetGenericArguments = owner.genericParameters.map((parameter) =>
      targetGenericParameterArgument(parameter, context));
    operations.push(operationRow({
      exportId,
      memberId,
      signatureId,
      operationKind: "method",
      target: variant.fields.kind === "struct"
        ? { form: "struct-variant", path, fields: Object.freeze(fields.map((field) => field.name)) }
        : { form: "call", path },
      resultCarrier,
      parameterCarriers,
      sourceGenericBindings: providerSourceGenericBindings(owner.genericParameters, context),
      targetGenerics: targetGenericsFor(generics, context),
      ...(targetGenericArguments.length === 0 ? {} : { targetGenericArguments }),
      ...typeRequirements(generics, owner.typeParameters, context),
    }));
  }
}

export function projectTypeMethods(
  methods: readonly RustCompilerFunction[],
  ownerKind: "struct" | "enum" | "union" | "trait",
  context: ProjectionContext,
  exportId: string,
  ownerTargetPath: readonly string[],
): {
  readonly members: readonly ProviderMemberDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const projected = methods.flatMap((method) => {
    if (ownerKind === "trait" && method.receiver === undefined) return [];
    const result = compilerFunctionResult(method.result);
    const constructor = ownerKind === "struct" && method.receiver === undefined &&
      method.traitDispatch === undefined && method.name === "new" &&
      method.enclosingGenerics.parameters.length === 0 &&
      method.generics.parameters.length === 0 && rustCompilerTypeNamesCurrentType(result.type, context);
    return [{
      method,
      constructor,
      value: projectFunction(method, context, exportId, constructor, ownerTargetPath),
    }];
  });
  const byMember = new Map<string, typeof projected>();
  for (const entry of projected) {
    const memberId = entry.value.memberId!;
    const group = byMember.get(memberId) ?? [];
    group.push(entry);
    byMember.set(memberId, group);
  }
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  for (const [memberId, group] of [...byMember].sort(([left], [right]) => compareText(left, right))) {
    const counts = new Map<string, number>();
    for (const entry of group) {
      const key = sourceSignatureSelectionKey(entry.value.signature);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const selected = group.filter((entry) => counts.get(sourceSignatureSelectionKey(entry.value.signature)) === 1);
    if (selected.length === 0) continue;
    const first = selected[0]!;
    members.push(Object.freeze({
      id: memberId,
      name: first.constructor ? "constructor" : first.method.name,
      kind: first.constructor ? "constructor" : "method",
      ...(first.constructor || sourceMethodIsInstance(first.method) ? {} : { static: true }),
      signatures: Object.freeze(selected.map((entry) => entry.value.signature)),
    }));
    operations.push(...selected.map((entry) => entry.value.operation));
  }
  return { members: Object.freeze(members), operations: Object.freeze(operations) };
}

export function projectAssociatedConstants(
  constants: readonly RustCompilerAssociatedConstant[],
  context: ProjectionContext,
  exportId: string,
  ownerTargetPath: readonly string[],
  ownerGenerics: RustCompilerGenerics,
): {
  readonly members: readonly ProviderMemberDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const nameCounts = new Map<string, number>();
  for (const constant of constants) {
    nameCounts.set(constant.name, (nameCounts.get(constant.name) ?? 0) + 1);
  }
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  const owner = requireCurrentType(context);
  for (const constant of constants) {
    if (nameCounts.get(constant.name) !== 1) continue;
    const memberId = `${exportId}::associated-constant:${constant.identity.itemId}`;
    const resultCarrier = targetTypeFor(constant.type, context, "result");
    const sourceType = sourceTypeFor(constant.type, context, "result");
    const target = constant.traitDispatch === undefined
      ? { form: "path" as const, path: [...ownerTargetPath, constant.name].join("::") }
      : {
          form: "trait-associated-value" as const,
          owner: owner.carrier,
          trait: targetTraitFor(constant.traitDispatch, context, "result"),
          name: constant.name,
        };
    const ownContext: ProjectionContext = {
      ...context,
      genericNames: new Map([
        ...(context.genericNames ?? []),
        ...genericNameMap(constant.generics.parameters),
      ]),
      genericParameters: new Map([
        ...(context.genericParameters ?? []),
        ...genericParameterProjectionMap(constant.generics.parameters),
      ]),
    };
    const ownParameters = providerTypeParameters(
      constant.generics.parameters,
      ownContext,
    );
    const allSourceParameters = [...owner.typeParameters, ...ownParameters.map((parameter) => parameter.name)];
    const genericArguments = constant.generics.parameters.map((parameter) =>
      targetGenericParameterArgument(parameter, ownContext));
    if (allSourceParameters.length === 0) {
      members.push(Object.freeze({
        id: memberId,
        name: constant.name,
        kind: "property",
        static: true,
        type: sourceType,
      }));
      operations.push(operationRow({
        exportId,
        memberId,
        operationKind: "property",
        target,
        resultCarrier,
        ...typeRequirements(constant.generics, allSourceParameters, ownContext),
      }));
      continue;
    }
    const signatureId = `${memberId}::signature`;
    members.push(Object.freeze({
      id: memberId,
      name: constant.name,
      kind: "method",
      static: true,
      signatures: Object.freeze([Object.freeze({
        id: signatureId,
        name: constant.name,
        parameters: Object.freeze([]),
        returnType: sourceType,
        typeParameters: Object.freeze([
          ...owner.genericParameters.map((parameter, index) =>
            providerGenericParameter(parameter, context, index)),
          ...ownParameters,
        ]),
      })]),
    }));
    operations.push(operationRow({
      exportId,
      memberId,
      signatureId,
      operationKind: "method",
      target,
      resultCarrier,
      sourceGenericBindings: providerSourceGenericBindings([
        ...owner.genericParameters,
        ...constant.generics.parameters,
      ], ownContext),
      targetGenerics: targetGenericsFor(
        mergeGenerics(ownerGenerics, constant.generics),
        ownContext,
      ),
      ...(genericArguments.length === 0 ? {} : { targetGenericArguments: genericArguments }),
      ...typeRequirements(mergeGenerics(ownerGenerics, constant.generics), allSourceParameters, ownContext),
    }));
  }
  return { members: Object.freeze(members), operations: Object.freeze(operations) };
}

function sourceSignatureSelectionKey(signature: ProviderSignatureDeclaration): string {
  return JSON.stringify({
    parameters: signature.parameters,
    returnType: signature.returnType,
    typeParameters: signature.typeParameters,
  });
}

export function sourceMethodIsInstance(method: RustCompilerFunction): boolean {
  return method.receiver !== undefined;
}

function providerGenericParameter(
  parameter: RustCompilerGenericParameter,
  context: ProjectionContext,
  index: number,
): ProviderTypeParameterDeclaration {
  const projected = providerTypeParameters([parameter], context);
  if (projected.length !== 1) {
    throw new Error(`Rust generic parameter ${index} did not project exactly once.`);
  }
  return projected[0]!;
}

export function mergeGenerics(
  left: RustCompilerGenerics,
  right: RustCompilerGenerics,
): RustCompilerGenerics {
  return Object.freeze({
    parameters: Object.freeze([...left.parameters, ...right.parameters]),
    wherePredicates: Object.freeze([...left.wherePredicates, ...right.wherePredicates]),
  });
}
