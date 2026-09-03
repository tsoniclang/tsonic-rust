import {
  compareText,
  requireCurrentType,
  rustCompilerTypeConstructsCurrentType,
  withDefaultGenericBindings,
  withProjectionGenericParameters,
} from "./utilities.js";
import { operationRow, targetTraitPath, typeRequirements } from "./operations.js";
import {
  projectFunction,
  sourceMethodIsInstance,
} from "./functions.js";
import {
  providerGenericBindingsFor,
  providerGenericParametersFor,
  sourceGenericParameterNames,
  sourceTypeFor,
  targetGenericArgumentFor,
  targetGenericParameterArguments,
  targetTraitFor,
  targetTypeFor,
} from "./types.js";
import { compilerAssociatedSourceExportName } from "../model/rustdoc-items.js";
import { rustUnitTargetType } from "../../../target-model/types/index.js";
import {
  compilerFunctionResult,
  rustCompilerFunctionHasCarrierContracts,
} from "./representability.js";
import type {
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
} from "@tsonic/tsts";
import type {
  RustCompilerAssociatedConstant,
  RustCompilerAssociatedType,
  RustCompilerExport,
  RustCompilerFunction,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerTraitDispatch,
  RustCompilerTypeParameter,
} from "../model/model.js";
import type { ProjectionContext } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProviderOperationDefinition, RustProviderTypeDefinition } from "../../packages/model.js";

export function projectFields(
  exported: Extract<RustCompilerExport, { readonly kind: "struct" | "union" }>,
  context: ProjectionContext,
  exportId: string,
  carrier: TargetTypeRef,
  members: ProviderMemberDeclaration[],
  operations: RustProviderOperationDefinition[],
): void {
  const generics = providerGenericBindingsFor(exported.genericParameters, context);
  const typeNames = generics.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.sourceName] : []);
  for (const field of exported.fields) {
    const sourceFieldType = sourceTypeFor(field.type, context, "result");
    const targetFieldType = targetTypeFor(field.type, context, "result");
    const memberId = `${exportId}::field:${field.name}`;
    members.push(Object.freeze({
      id: memberId,
      name: field.name,
      kind: "property",
      type: sourceFieldType,
    }));
    const common = {
      exportId,
      memberId,
      target: { form: "field" as const, name: field.name },
      receiverCarrier: carrier,
      ...(generics.length === 0 ? {} : { genericParameters: generics }),
      ...typeRequirements(
        typeParametersOf(exported.genericParameters),
        typeNames,
        context,
        (trait) => targetTraitFor(trait, context, "parameter", "target-default"),
      ),
    };
    operations.push(operationRow({
      ...common,
      operationKind: "property",
      resultCarrier: targetFieldType,
      ...(exported.kind === "union" ? { isUnsafe: true } : {}),
    }));
    operations.push(operationRow({
      ...common,
      operationKind: "property-set",
      resultCarrier: rustUnitTargetType(),
      parameterCarriers: Object.freeze([targetFieldType]),
    }));
  }
}

export function projectVariants(
  exported: Extract<RustCompilerExport, { readonly kind: "enum" }>,
  context: ProjectionContext,
  exportId: string,
  selectedTargetPath: readonly string[],
  carrier: TargetTypeRef,
  sourceType: ProviderTypeExpression,
  nativeEnum: boolean,
  members: ProviderMemberDeclaration[],
  operations: RustProviderOperationDefinition[],
): void {
  const generics = providerGenericBindingsFor(exported.genericParameters, context);
  const sourceParameters = providerGenericParametersFor(exported.genericParameters, context);
  const typeNames = generics.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.sourceName] : []);
  for (const variant of exported.variants) {
    const memberId = `${exportId}::variant:${variant.name}`;
    if (variant.kind === "plain") {
      if (sourceParameters.length !== 0) {
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
            returnType: sourceType,
            typeParameters: sourceParameters,
          })]),
        }));
        operations.push(operationRow({
          exportId,
          memberId,
          signatureId,
          operationKind: "method",
          target: {
            form: "associated-value",
            owner: carrier,
            name: variant.name,
          },
          resultCarrier: carrier,
          genericParameters: generics,
          ...typeRequirements(
            typeParametersOf(exported.genericParameters),
            typeNames,
            context,
            (trait) => targetTraitFor(trait, context, "parameter", "target-default"),
          ),
        }));
        continue;
      }
      members.push(Object.freeze({
        id: memberId,
        name: variant.name,
        kind: "field",
        ...(nativeEnum ? {} : { static: true, type: sourceType }),
      }));
      operations.push(operationRow({
        exportId,
        memberId,
        operationKind: "property",
        target: {
          form: "path",
          path: [...selectedTargetPath, variant.name].join("::"),
        },
        resultCarrier: carrier,
        ...(generics.length === 0 ? {} : { genericParameters: generics }),
        ...typeRequirements(
          typeParametersOf(exported.genericParameters),
          typeNames,
          context,
          (trait) => targetTraitFor(trait, context, "parameter", "target-default"),
        ),
      }));
      continue;
    }
    const fieldTypes = variant.kind === "struct"
      ? variant.fields.map((field) => field.type)
      : variant.fields;
    const parameters = fieldTypes.map((field, index): ProviderParameterDeclaration =>
      Object.freeze({
        name: `value${index}`,
        type: sourceTypeFor(field, context, "parameter"),
      }));
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
        returnType: sourceType,
        ...(sourceParameters.length === 0 ? {} : { typeParameters: sourceParameters }),
      })]),
    }));
    operations.push(operationRow({
      exportId,
      memberId,
      signatureId,
      operationKind: "method",
      target: {
        ...(variant.kind === "struct"
          ? {
              form: "struct-variant" as const,
              fields: Object.freeze(variant.fields.map((field) => field.name)),
            }
          : { form: "call" as const }),
        path: [...selectedTargetPath, variant.name].join("::"),
      },
      resultCarrier: carrier,
      parameterCarriers: Object.freeze(fieldTypes.map((field) =>
        targetTypeFor(field, context, "parameter"))),
      ...(generics.length === 0 ? {} : { genericParameters: generics }),
      ...typeRequirements(
        typeParametersOf(exported.genericParameters),
        typeNames,
        context,
        (trait) => targetTraitFor(trait, context, "parameter", "target-default"),
      ),
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
  const projected = methods
    .filter((method) => rustCompilerFunctionHasCarrierContracts(method, context) &&
      (ownerKind !== "trait" || sourceMethodIsInstance(method)))
    .map((method) => {
    const result = compilerFunctionResult(method.result);
    const constructor = ownerKind === "struct" && method.receiver === undefined &&
      method.traitDispatch === undefined && method.name === "new" &&
      method.genericParameters.length === 0 &&
      rustCompilerTypeConstructsCurrentType(result.type, context);
    return {
      method,
      constructor,
      value: projectFunction(
        method,
        context,
        exportId,
        constructor,
        ownerTargetPath,
      ),
    };
    });
  const byMember = new Map<string, typeof projected>();
  for (const entry of projected) {
    const memberId = entry.value.memberId;
    if (memberId === undefined) {
      throw new Error(`Rust method '${entry.method.name}' has no provider member identity.`);
    }
    const group = byMember.get(memberId) ?? [];
    group.push(entry);
    byMember.set(memberId, group);
  }
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  for (const [memberId, group] of [...byMember]
    .sort(([left], [right]) => compareText(left, right))) {
    const counts = new Map<string, number>();
    for (const entry of group) {
      const key = sourceSignatureSelectionKey(entry.value.signature);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const selected = group.filter((entry) =>
      counts.get(sourceSignatureSelectionKey(entry.value.signature)) === 1);
    if (selected.length === 0) continue;
    const first = selected[0]!;
    members.push(Object.freeze({
      id: memberId,
      name: first.constructor ? "constructor" : first.method.name,
      kind: first.constructor ? "constructor" : "method",
      ...(first.constructor || sourceMethodIsInstance(first.method)
        ? {}
        : { static: true }),
      signatures: Object.freeze(selected.map((entry) => entry.value.signature)),
    }));
    operations.push(...selected.map((entry) => entry.value.operation));
  }
  return Object.freeze({
    members: Object.freeze(members),
    operations: Object.freeze(operations),
  });
}

export function projectAssociatedConstants(
  constants: readonly RustCompilerAssociatedConstant[],
  context: ProjectionContext,
  exportId: string,
): {
  readonly members: readonly ProviderMemberDeclaration[];
  readonly operations: readonly RustProviderOperationDefinition[];
} {
  const counts = new Map<string, number>();
  for (const constant of constants) {
    counts.set(constant.name, (counts.get(constant.name) ?? 0) + 1);
  }
  const ownerGenerics = requireCurrentType(context).genericParameters;
  const genericBindings = providerGenericBindingsFor(ownerGenerics, context);
  const sourceParameters = providerGenericParametersFor(ownerGenerics, context);
  const typeNames = genericBindings.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.sourceName] : []);
  const members: ProviderMemberDeclaration[] = [];
  const operations: RustProviderOperationDefinition[] = [];
  for (const constant of constants) {
    if (counts.get(constant.name) !== 1) continue;
    const memberId = `${exportId}::trait-constant:${constant.name}`;
    const resultCarrier = targetTypeFor(constant.type, context, "result");
    const sourceType = sourceTypeFor(constant.type, context, "result");
    const target = {
      form: "trait-associated-value" as const,
      owner: requireCurrentType(context).carrier,
      traitPath: targetTraitPath(constant.traitDispatch.path, context),
      traitGenericArguments: constant.traitDispatch.genericArguments.map((argument) =>
        targetGenericArgumentFor(argument, context, "result")),
      name: constant.name,
    };
    const requirements = typeRequirements(
      [...typeParametersOf(ownerGenerics), ...constant.typeRequirements],
      typeNames,
      context,
      (trait) => targetTraitFor(trait, context, "parameter", "target-default"),
    );
    if (genericBindings.length === 0) {
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
        ...requirements,
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
        typeParameters: sourceParameters,
      })]),
    }));
    operations.push(operationRow({
      exportId,
      memberId,
      signatureId,
      operationKind: "method",
      target,
      resultCarrier,
      genericParameters: genericBindings,
      ...requirements,
    }));
  }
  return Object.freeze({
    members: Object.freeze(members),
    operations: Object.freeze(operations),
  });
}

export function projectAssociatedTypes(
  exported: Extract<RustCompilerExport, { readonly kind: "trait" }>,
  context: ProjectionContext,
): {
  readonly declarations: readonly ProviderExportDeclaration[];
  readonly types: readonly RustProviderTypeDefinition[];
} {
  const declarations: ProviderExportDeclaration[] = [];
  const types: RustProviderTypeDefinition[] = [];
  for (const associated of exported.associatedTypes) {
    const self = syntheticAssociatedSelf(exported, associated, context);
    const exportName = compilerAssociatedSourceExportName(
      associated.identity.itemId,
      associated.name,
    );
    const exportId = `${exported.id}::associated-type:${associated.identity.itemId}`;
    const parameters = Object.freeze([
      ...exported.genericParameters,
      self,
      ...associated.genericParameters,
    ]);
    const genericContext = withDefaultGenericBindings(
      withProjectionGenericParameters(context, parameters),
      parameters,
    );
    const associatedContext: ProjectionContext = Object.freeze({
      ...genericContext,
      currentType: Object.freeze({
        exportId,
        name: associated.name,
        carrier: Object.freeze({ kind: "type-parameter", name: self.name }),
        sourceType: Object.freeze({ kind: "type-parameter", name: self.name }),
        genericParameters: parameters,
        canonicalPath: Object.freeze([...exported.canonicalPath, associated.name, "Self"]),
        targetPath: exported.targetPath,
      }),
    });
    const sourceParameters = providerGenericParametersFor(parameters, associatedContext)
      .map((parameter, index) => parameters[index] === self
        ? Object.freeze({ name: parameter.name })
        : parameter);
    const trait = targetTraitFor(
      traitDispatchFor(exported),
      associatedContext,
      "result",
    );
    const carrier: TargetTypeRef = Object.freeze({
      kind: "associated-type",
      owner: Object.freeze({ kind: "type-parameter", name: self.name }),
      trait,
      name: associated.name,
      ...(associated.genericParameters.length === 0
        ? {}
        : {
            genericArguments: targetGenericParameterArguments(
              associated.genericParameters,
              associatedContext,
            ),
          }),
    });
    declarations.push(Object.freeze({
      id: exportId,
      name: exportName,
      exportName,
      kind: "type",
      type: associated.defaultType === undefined
        ? Object.freeze({ kind: "unknown" })
        : sourceTypeFor(associated.defaultType, associatedContext, "result"),
      typeParameters: sourceParameters,
    }));
    const typeNames = providerTypeParameterNames(parameters, associatedContext);
    types.push(Object.freeze({
      exportId,
      genericParameters: providerGenericBindingsFor(parameters, associatedContext),
      targetCarrier: carrier,
      ...typeRequirements(
        typeParametersOf(parameters),
        typeNames,
        associatedContext,
        (selectedTrait) => targetTraitFor(
          selectedTrait,
          associatedContext,
          "parameter",
          "target-default",
        ),
      ),
    }));
  }
  return Object.freeze({
    declarations: Object.freeze(declarations),
    types: Object.freeze(types),
  });
}

export function traitDispatchFor(
  exported: Extract<RustCompilerExport, { readonly kind: "trait" }>,
): RustCompilerTraitDispatch {
  const genericArguments = exported.genericParameters.map(
    compilerGenericParameterArgument,
  );
  return Object.freeze({
    identity: Object.freeze({
      itemId: exported.id,
      canonicalPath: exported.canonicalPath,
    }),
    path: exported.targetPath.join("::"),
    genericArguments: Object.freeze(genericArguments),
    associatedConstraints: Object.freeze([]),
  });
}

function compilerGenericParameterArgument(
  parameter: RustCompilerGenericParameter,
): RustCompilerGenericArgument {
  if (parameter.kind === "lifetime") {
    return Object.freeze({ kind: "lifetime", lifetime: parameter.lifetime });
  }
  if (parameter.kind === "type") {
    return Object.freeze({
      kind: "type",
      type: Object.freeze({
        kind: "generic",
        identity: parameter.identity,
        name: parameter.name,
      }),
    });
  }
  return Object.freeze({
    kind: "const",
    value: Object.freeze({
      kind: "parameter",
      identity: parameter.identity,
      name: parameter.name,
    }),
  });
}

export function syntheticTraitSelf(
  exported: Extract<RustCompilerExport, { readonly kind: "trait" }>,
  context: ProjectionContext,
): { readonly parameter: RustCompilerTypeParameter; readonly carrier: TargetTypeRef } {
  const name = uniqueGenericName(
    "SelfType",
    sourceGenericParameterNames(exported.genericParameters, context),
  );
  const parameter: RustCompilerTypeParameter = Object.freeze({
    kind: "type",
    identity: Object.freeze({
      itemId: `${exported.id}::implicit-self`,
      canonicalPath: Object.freeze([...exported.canonicalPath, "Self"]),
    }),
    name,
    requirements: Object.freeze([]),
    outlives: Object.freeze([]),
    maybeSized: true,
  });
  return Object.freeze({
    parameter,
    carrier: Object.freeze({ kind: "type-parameter", name }),
  });
}

function syntheticAssociatedSelf(
  exported: Extract<RustCompilerExport, { readonly kind: "trait" }>,
  associated: RustCompilerAssociatedType,
  context: ProjectionContext,
): RustCompilerTypeParameter {
  const occupied = sourceGenericParameterNames(
    [...exported.genericParameters, ...associated.genericParameters],
    withProjectionGenericParameters(context, [
      ...exported.genericParameters,
      ...associated.genericParameters,
    ]),
  );
  const name = uniqueGenericName("SelfType", occupied);
  return Object.freeze({
    kind: "type",
    identity: Object.freeze({
      itemId: `${associated.identity.itemId}::owner`,
      canonicalPath: Object.freeze([...exported.canonicalPath, associated.name, "Self"]),
    }),
    name,
    requirements: associated.ownerRequirements,
    outlives: associated.ownerOutlives,
    maybeSized: associated.ownerMaybeSized,
  });
}

function uniqueGenericName(base: string, occupiedNames: readonly string[]): string {
  const occupied = new Set(occupiedNames);
  let selected = base;
  while (occupied.has(selected)) selected = `_${selected}`;
  return selected;
}

export function providerTypeParameterNames(
  parameters: readonly RustCompilerGenericParameter[],
  context: ProjectionContext,
): readonly string[] {
  const bindings = providerGenericBindingsFor(parameters, context);
  return Object.freeze(bindings.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.sourceName] : []));
}

export function typeParametersOf(
  parameters: readonly RustCompilerGenericParameter[],
): readonly RustCompilerTypeParameter[] {
  return Object.freeze(parameters.filter((parameter): parameter is RustCompilerTypeParameter =>
    parameter.kind === "type"));
}

function sourceSignatureSelectionKey(
  signature: ProviderSignatureDeclaration,
): string {
  return JSON.stringify({
    parameters: signature.parameters,
    typeParameters: signature.typeParameters?.map(({ name }) => name) ?? [],
  });
}
