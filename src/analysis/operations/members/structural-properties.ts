import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import { acceptRustMemberOperation, rejectSelectedOperation } from "./result.js";

import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

import { isProjectSourceDeclaration } from "../../../policy/identities/selected-source.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";

import type { RustCheckedOperationSelectionResult, RustCheckedPropertySelectionInput, RustPolicySelection } from "../../../policy/model/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";

import type { RustStructuralFieldRegistration, RustSourceUnion } from "../../../target-model/records/types/source-types.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { resolveRustProjectField } from "./project-fields.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";

type UnionField = NonNullable<Extract<RustTargetOperationFact,
  { readonly kind: "source-union-field" }>["variants"][number]["field"]>;

export function isProjectAccessorDeclaration(
  declaration: Node | undefined,
  kind: "KindGetAccessor" | "KindSetAccessor",
  context: RustOperationAnalysisContext,
): declaration is Node {
  return isProjectSourceDeclaration(context, declaration) &&
    context.ast.kindName(declaration) === kind;
}

export function selectStructuralSourceProperty(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  if (receiverCarrier === undefined) {
    return undefined;
  }
  const selectedDeclarations = selectedPropertyDeclarations(
    request,
    receiverCarrier,
    context,
    options,
  );
  const sourceUnion = options.sourceTypes.sourceUnionForCarrier(receiverCarrier);
  if (sourceUnion !== undefined) {
    if (selectedDeclarations === undefined || selectedDeclarations.length === 0) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SOURCE_UNION_PROPERTY_IDENTITY_MISSING",
        "Runtime-union property access requires exact selected source declarations.",
      );
    }
    const selectedVariantIndexes = selectedSourceUnionVariantIndexes(
      request,
      sourceUnion,
      context,
      options,
    );
    if (selectedVariantIndexes === undefined || selectedVariantIndexes.length === 0) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SOURCE_UNION_REFINEMENT_MISSING",
        "Runtime-union property access requires exact TSTS-selected receiver refinement.",
      );
    }
    const selectedIndexes = new Set(selectedVariantIndexes);
    const fields = sourceUnion.variants.map((variant, index): {
      readonly field: UnionField; readonly resultCarrier: TargetTypeRef;
    } | undefined => {
      if (!selectedIndexes.has(index)) {
        return undefined;
      }
      const matches = variant.shape?.fields.filter((field) =>
        field.declarations.some((declaration) => selectedDeclarations.includes(declaration))) ?? [];
      if (matches.length === 1) {
        const selected = matches[0]!;
        return { resultCarrier: selected.resultCarrier, field: {
          storage: variant.shape!.storage, storageIndex: selected.storageIndex,
          valueSemantics: selected.accessor !== undefined
            ? { kind: "accessor", writable: selected.accessor.setter }
            : selected.method === true ? { kind: "method" } : { kind: "stored" },
        } };
      }
      if (matches.length !== 0) return undefined;
      const projectFields = selectedDeclarations.map(declaration => resolveRustProjectField(
        declaration, variant.carrier, variant.sourceTypes[0]!, context, options)).filter(field => field !== undefined);
      if (projectFields.length !== 1) return undefined;
      const selected = projectFields[0]!;
      return { resultCarrier: selected.resultCarrier, field: {
        storage: selected.storage, storageIndex: selected.storageIndex, valueSemantics: selected.valueSemantics,
        ...(selected.declaration === undefined ? {} : { declaration: selected.declaration }),
        ...(selected.dispatch === undefined ? {} : { dispatch: selected.dispatch }),
      } };
    });
    if (selectedVariantIndexes.some((index) => fields[index] === undefined)) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SOURCE_UNION_PROPERTY_NOT_TOTAL",
        "The exact selected source property is not represented by every selected runtime-union arm.",
      );
    }
    const selectedFields = selectedVariantIndexes.map((index) => fields[index]!);
    const resultCarrier = selectedFields[0]?.resultCarrier;
    if (resultCarrier === undefined ||
      selectedFields.some((field) =>
        !rustTargetTypeRefEquals(field.resultCarrier, resultCarrier))) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SOURCE_UNION_PROPERTY_RESULT_NOT_CLOSED",
        "The exact selected runtime-union property does not have one closed Rust result carrier.",
      );
    }
    const operationId = sourceDeclarationsOperationId(
      context,
      selectedDeclarations,
      "union-field",
    );
    if (operationId === undefined) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SOURCE_UNION_PROPERTY_IDENTITY_MISSING",
        "Runtime-union property access has no deterministic declaration identity.",
      );
    }
    if (request.accessMode === "delete") {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_STRUCTURAL_FIELD_DELETE_UNSUPPORTED",
        "Structural fields cannot be deleted without an exact optional-property removal contract for every selected runtime-union arm.",
      );
    }
    return acceptRustMemberOperation(request, "property", {
      kind: "source-union-field",
      operationId,
      accessMode: request.accessMode,
      unionCarrier: receiverCarrier,
      selectedVariantIndexes,
      variants: sourceUnion.variants.map((variant, index) => ({
        name: variant.name,
        carrier: variant.carrier,
        ...(fields[index] === undefined
          ? {}
          : {
              field: fields[index]!.field,
            }),
      })),
      resultCarrier,
    }, context, options, {
      sourceExpression: request.expression,
      sourceReceiver: request.receiver,
      ...(request.sourceSelectedSymbol === undefined
        ? {}
        : { sourceSelectedSymbol: request.sourceSelectedSymbol }),
      ...(request.sourceSelectedDeclaration === undefined
        ? {}
        : { sourceSelectedDeclaration: request.sourceSelectedDeclaration }),
      sourceResultType: request.sourceResultType,
    });
  }

  const symbolMatch = request.sourceSelectedSymbol === undefined
    ? undefined
    : options.sourceTypes.structuralFieldProjectionForSymbol(
        request.sourceSelectedSymbol,
        receiverCarrier,
      );
  const declarationMatches = (selectedDeclarations ?? [])
    .map((declaration) =>
      options.sourceTypes.structuralFieldProjectionForDeclaration(declaration, receiverCarrier))
    .filter((projection): projection is NonNullable<typeof projection> => projection !== undefined);
  const matches = [
    ...(symbolMatch === undefined ? [] : [symbolMatch]),
    ...declarationMatches,
  ];
  const selected = matches[0];
  if (selected === undefined) {
    return undefined;
  }
  if (matches.some((candidate) =>
    !structuralFieldProjectionsAgree(selected, candidate)
  )) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_STRUCTURAL_PROPERTY_AMBIGUOUS",
      "Selected structural property evidence resolves to more than one Rust storage field.",
    );
  }
  const { field, shape } = selected;
  if (shape.construction !== undefined && field.method === true) {
    return rejectSelectedOperation(request.expression, context, "RUST_CONSTRUCTOR_METHOD_VALUE_UNSUPPORTED",
      "Constructor-object methods currently support selected calls, not extracted or replaced method values.");
  }
  if (request.accessMode === "delete") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_STRUCTURAL_FIELD_DELETE_UNSUPPORTED",
      "Structural fields cannot be deleted because the selected source field has no optional-property removal contract.",
    );
  }
  if (field.method === true && shape.storage === "structural-object" &&
    rustStructuralObjectCarrierValue(receiverCarrier)?.representation === "reference" &&
    (request.accessMode === "write" || request.accessMode === "read-write")) {
    const receiver = context.sourceStorage.subjectFor(request.receiver);
    const bindings = context.sourceStorage.bindingsForLexicalOwner(request.receiver);
    if (receiver.kind === "unresolved") {
      return rejectSelectedOperation(request.expression, context,
        "RUST_STRUCTURAL_METHOD_WRITE_PROVENANCE_MISSING", receiver.reason);
    }
    if (bindings.kind === "unresolved") {
      return rejectSelectedOperation(request.expression, context,
        "RUST_STRUCTURAL_METHOD_WRITE_PROVENANCE_MISSING", bindings.reason);
    }
    const origins = context.sourceStorage.boundOriginsFor(receiver.subject, bindings.bindings);
    const write = context.sourceStorage.writeAt(request.expression, bindings.bindings);
    if (origins.kind === "unresolved" || write.kind === "unresolved" || write.write.reason !== undefined) {
      return rejectSelectedOperation(request.expression, context,
        "RUST_STRUCTURAL_METHOD_WRITE_PROVENANCE_MISSING",
        origins.kind === "unresolved" ? origins.reason : write.kind === "unresolved" ? write.reason : write.write.reason!);
    }
    if (origins.subjects.some(subject => subject.kind === "input" && subject.projection.length === 0 &&
      context.ast.is.IsParameterDeclaration(subject.node))) {
      return rejectSelectedOperation(request.expression, context,
        "RUST_STRUCTURAL_METHOD_WRITE_UNSUPPORTED",
        "Rust v1 does not support replacing a structural method through a shared source parameter or its alias.");
    }
  }
  const resultCarrier = field.resultCarrier;
  const operationId = structuralFieldOperationId(receiverCarrier, field.storageIndex);
  return acceptRustMemberOperation(request, "property", {
    kind: "source-field",
    operationId,
    accessMode: request.accessMode,
    receiverCarrier,
    storage: shape.storage,
    storageIndex: field.storageIndex,
    valueSemantics: field.accessor === undefined
      ? field.method === true ? { kind: "method" } : { kind: "stored" }
      : { kind: "accessor", writable: field.accessor.setter },
    resultCarrier,
  }, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    ...(request.sourceSelectedSymbol === undefined
      ? {}
      : { sourceSelectedSymbol: request.sourceSelectedSymbol }),
    ...(request.sourceSelectedDeclaration === undefined
      ? {}
      : { sourceSelectedDeclaration: request.sourceSelectedDeclaration }),
    sourceResultType: request.sourceResultType,
  });
}

function structuralFieldProjectionsAgree(
  left: RustStructuralFieldRegistration,
  right: RustStructuralFieldRegistration,
): boolean {
  return left.shape.storage === right.shape.storage &&
    rustTargetTypeRefEquals(left.shape.carrier, right.shape.carrier) &&
    left.field.storageIndex === right.field.storageIndex &&
    left.field.sourceName === right.field.sourceName &&
    left.field.presence === right.field.presence &&
    left.field.readonly === right.field.readonly &&
    left.field.accessor?.getter === right.field.accessor?.getter &&
    left.field.accessor?.setter === right.field.accessor?.setter &&
    left.field.method === right.field.method &&
    rustTargetTypeRefEquals(left.field.resultCarrier, right.field.resultCarrier);
}

function structuralFieldOperationId(
  receiverCarrier: TargetTypeRef,
  storageIndex: number,
): string {
  return `tsonic.rust.structural-field:${closedMetadataKey(receiverCarrier)}:${storageIndex}`;
}

function selectedPropertyDeclarations(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): readonly Node[] | undefined {
  const declarations: Node[] = [];
  if (request.sourceSelectedDeclaration !== undefined &&
    (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration) ||
      options.sourceTypes.structuralFieldProjectionForDeclaration(
        request.sourceSelectedDeclaration,
        receiverCarrier,
      ) !== undefined)) {
    declarations.push(request.sourceSelectedDeclaration!);
  }
  if (request.sourceSelectedSymbol !== undefined) {
    const semanticDeclarations = context.currentSemantics.declarations
      .symbolDeclarations(request.sourceSelectedSymbol);
    for (const declaration of semanticDeclarations) {
      if ((isProjectSourceDeclaration(context, declaration) ||
          options.sourceTypes.structuralFieldProjectionForDeclaration(
            declaration,
            receiverCarrier,
          ) !== undefined) &&
        !declarations.includes(declaration)) {
        declarations.push(declaration);
      }
    }
    const registeredDeclarations = options.sourceTypes.declarationsForSelectedSymbol(
      request.sourceSelectedSymbol,
    );
    if (registeredDeclarations !== undefined) {
      for (const declaration of registeredDeclarations) {
        if (!declarations.includes(declaration)) {
          declarations.push(declaration);
        }
      }
    }
  }
  return Object.freeze(declarations);
}

function selectedSourceUnionVariantIndexes(
  request: RustCheckedPropertySelectionInput,
  union: RustSourceUnion,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): readonly number[] | undefined {
  const all = Object.freeze(union.variants.map((_, index) => index));
  const selectedReceiverType = request.sourceReceiverType;
  if (selectedReceiverType !== undefined) {
    const retained = options.sourceTypes.sourceUnionVariantIndexesForTypes(
      union.carrier,
      context.currentSemantics.types.isUnion(selectedReceiverType)
        ? context.currentSemantics.types.unionOrIntersectionTypes(selectedReceiverType)
        : [selectedReceiverType],
    );
    if (retained !== undefined) return retained;
    const selectedRefinement = context.currentSemantics.types.refinement(
      union.sourceType,
      selectedReceiverType,
    );
    if (selectedRefinement.kind === "exact") {
      return all;
    }
    if (selectedRefinement.kind === "members") {
      const direct = options.sourceTypes.sourceUnionVariantIndexesForTypes(
        union.carrier,
        selectedRefinement.types,
      );
      if (direct !== undefined) {
        return direct;
      }
    }
  }
  const refinement = context.source.semantics.selectValueTypeRefinement(request.receiver);
  if (refinement.kind !== "resolved") {
    return undefined;
  }
  if (refinement.refinement.kind === "exact" &&
    refinement.declaredType === union.sourceType) {
    return all;
  }
  return refinement.refinement.kind === "members"
    ? options.sourceTypes.sourceUnionVariantIndexesForTypes(
        union.carrier,
        refinement.refinement.types,
      )
    : undefined;
}

function sourceDeclarationsOperationId(
  context: RustOperationAnalysisContext,
  declarations: readonly Node[],
  kind: "field" | "union-field",
): string | undefined {
  if (declarations.length === 0) {
    return undefined;
  }
  const identities = declarations.map((declaration) => {
    const fileName = context.ast.getFileName(context.ast.getSourceFile(declaration));
    const start = context.ast.pos(declaration);
    const end = context.ast.end(declaration);
    return fileName.length === 0 || start < 0 || end < start
      ? undefined
      : `${fileName}:${start}:${end}`;
  });
  if (identities.some((identity) => identity === undefined)) {
    return undefined;
  }
  const unique = [...new Set(identities as readonly string[])].sort();
  return `tsonic.rust.source.${kind}:${JSON.stringify(unique)}`;
}
