import { acceptRustMemberOperation, elementProvenance, normalizeSelectedOperationInputCarrier, rejectSelectedOperation } from "./result.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { finalizeProviderOperationFromSubjects } from "./conversions.js";
import { isProjectSourceDeclaration } from "../../../policy/evidence/selected-source.js";
import { isRustCopyCarrier } from "../../../target-model/types/index.js";
import {
  rustFixedArrayCarrierValue,
  rustSourcePrimitiveTargetType,
  rustTargetConstSafeInteger,
} from "../../../target-model/types/index.js";
import { rustInt32ToUsizeValueConversion, rustUsizeToInt32ValueConversion } from "../../../target-model/conversions/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectedValueCarrier } from "./operators.js";
import type {
  RustCheckedElementSelectionInput,
  RustCheckedOperationSelectionResult,
  RustCheckedPropertySelectionInput,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../../policy/operations/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";
import type { RustProviderOperationTemplate } from "../../facts/keys.js";
import type { RustStructuralFieldRegistration, RustSourceUnion } from "../../project-types/source-type-registry.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function isProjectAccessorDeclaration(
  declaration: Node | undefined,
  kind: "KindGetAccessor" | "KindSetAccessor",
  context: RustOperationPolicyContext,
): declaration is Node {
  return isProjectSourceDeclaration(context, declaration) &&
    context.ast.kindName(declaration) === kind;
}

export function selectStructuralSourceProperty(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  if (receiverCarrier === undefined) {
    return undefined;
  }
  const selectedDeclarations = selectedPropertyDeclarations(request, context, options);
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
    const fields = sourceUnion.variants.map((variant, index) => {
      if (!selectedIndexes.has(index)) {
        return undefined;
      }
      const matches = variant.shape?.fields.filter((field) =>
        field.declarations.some((declaration) => selectedDeclarations.includes(declaration))) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
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
      unionCarrier: receiverCarrier,
      selectedVariantIndexes,
      variants: sourceUnion.variants.map((variant, index) => ({
        name: variant.name,
        carrier: variant.carrier,
        ...(fields[index] === undefined
          ? {}
          : {
              field: {
                storage: variant.shape!.storage,
                storageIndex: fields[index]!.storageIndex,
                valueSemantics: fields[index]!.accessor === undefined
                  ? fields[index]!.method === true
                    ? { kind: "method" }
                    : { kind: "stored" }
                  : {
                      kind: "accessor",
                      writable: fields[index]!.accessor!.setter,
                    },
              },
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
  if (field.method === true) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_STRUCTURAL_METHOD_VALUE_UNSUPPORTED",
      "Reading a structural method as a standalone function value requires an explicit JavaScript this-binding carrier; direct receiver calls are supported without guessing.",
    );
  }
  if (request.accessMode === "delete") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_STRUCTURAL_FIELD_DELETE_UNSUPPORTED",
      "Structural fields cannot be deleted because the selected source field has no optional-property removal contract.",
    );
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
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly Node[] | undefined {
  const declarations: Node[] = [];
  if (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)) {
    declarations.push(request.sourceSelectedDeclaration!);
  }
  if (request.sourceSelectedSymbol !== undefined) {
    const selected = options.sourceTypes.declarationsForSelectedSymbol(
      request.sourceSelectedSymbol,
    );
    if (selected === undefined) {
      if (declarations.length === 0) {
        return undefined;
      }
    } else {
      for (const declaration of selected) {
        if (isProjectSourceDeclaration(context, declaration) && !declarations.includes(declaration)) {
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
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly number[] | undefined {
  const all = Object.freeze(union.variants.map((_, index) => index));
  const selectedReceiverType = request.sourceReceiverType;
  if (selectedReceiverType !== undefined) {
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
  context: RustOperationPolicyContext,
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

export function selectRustFixedArrayLengthProperty(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const fixedArray = rustFixedArrayCarrierValue(receiverCarrier);
  if (fixedArray === undefined || request.accessMode !== "read") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_LENGTH_NOT_CLOSED",
      "The selected FixedArray.length access requires one exact fixed-array receiver and readonly access.",
    );
  }
  const resultCarrier = rustSourcePrimitiveTargetType("int32");
  const template: RustProviderOperationTemplate = {
    kind: "provider-operation",
    operationId: "tsonic.rust.fixed-array.length",
    operationKind: "property",
    target: { form: "receiver-method", name: "len" },
    resultCarrier,
    parameterCarriers: [],
    resultConversion: rustUsizeToInt32ValueConversion,
    evaluation: "pure",
    isAsync: false,
    isFallible: false,
    errorBoundary: "none",
  };
  const fact = finalizeProviderOperationFromSubjects(
    template,
    request.receiver,
    [],
    context,
    options,
    receiverCarrier,
  );
  if (fact === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_LENGTH_ABI_INCOMPLETE",
      "The selected FixedArray.length access cannot finalize one total Rust len operation ABI.",
    );
  }
  return acceptRustMemberOperation(
    request,
    "property",
    fact,
    context,
    options,
    {
      sourceExpression: request.expression,
      sourceReceiver: request.receiver,
      sourceSelectedSymbol: request.sourceSelectedSymbol,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceResultType: request.sourceResultType,
    },
  );
}

export function selectRustFixedArrayElementAccess(
  request: RustCheckedElementSelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const fixedArray = rustFixedArrayCarrierValue(receiverCarrier);
  if (fixedArray === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_RECEIVER_NOT_CLOSED",
      "The selected FixedArray index access has no exact fixed-array receiver carrier.",
    );
  }
  const index = request.sourceSelectedElementIndex;
  if (index !== undefined) {
    const length = rustTargetConstSafeInteger(fixedArray.length);
    if (length === undefined || index < 0 || index >= length) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_FIXED_ARRAY_INDEX_NOT_PROVEN",
        "Fixed-array element access carries a TSTS-selected ordinal outside the finalized array bounds.",
      );
    }
    return acceptRustMemberOperation(request, "indexer", {
      kind: "fixed-index",
      operationId: "tsonic.rust.fixed-array.index",
      index,
    }, context, options, elementProvenance(request), fixedArray.element);
  }
  if (!isRustCopyCarrier(fixedArray.element)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_DYNAMIC_INDEX_REQUIRES_COPY",
      "Dynamic fixed-array element access requires an exact Copy element carrier so a borrowed Rust index result can preserve source value semantics.",
    );
  }
  const dynamicIndexCarrier = selectedValueCarrier(
    request.argument,
    request.sourceArgumentType,
    context,
    options,
  );
  const normalizedIndexCarrier = normalizeSelectedOperationInputCarrier(
    request.argument,
    dynamicIndexCarrier,
    rustSourcePrimitiveTargetType("int32"),
    context,
    options,
  );
  if (
    normalizedIndexCarrier === undefined ||
    !rustTargetTypeRefEquals(
      normalizedIndexCarrier,
      rustSourcePrimitiveTargetType("int32"),
    )
  ) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_DYNAMIC_INDEX_CARRIER_UNSUPPORTED",
      "Dynamic fixed-array element access requires an exact int32 index carrier; literal unions and other source carriers are not reconstructed from their spelling.",
    );
  }
  const template: RustProviderOperationTemplate = {
    kind: "provider-operation",
    operationId: "tsonic.rust.fixed-array.dynamic-index",
    operationKind: "indexer",
    target: {
      form: "index",
      indexConversion: rustInt32ToUsizeValueConversion,
    },
    resultCarrier: fixedArray.element,
    parameterCarriers: [rustSourcePrimitiveTargetType("int32")],
    evaluation: "pure",
    isAsync: false,
    isFallible: false,
    errorBoundary: "none",
  };
  const fact = finalizeProviderOperationFromSubjects(
    template,
    request.receiver,
    [request.argument],
    context,
    options,
    receiverCarrier,
    [normalizedIndexCarrier],
  );
  if (fact === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_SELECTED_OPERATION_ABI_INCOMPLETE",
      "Dynamic fixed-array indexing cannot finalize one total Rust index ABI.",
    );
  }
  return acceptRustMemberOperation(
    request,
    "indexer",
    fact,
    context,
    options,
    elementProvenance(request),
  );
}
