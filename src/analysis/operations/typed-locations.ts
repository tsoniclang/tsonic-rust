import { selectRustTypedLocationCallSignature } from "../../policy/operations/typed-locations/call-signature.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import { selectedRustCallSignature } from "../program/records/calls/selected-call.js";
import type { AstReader, Node, ProviderDeclarationIdentity, SourceCallMarkerKind } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { selectedValueCarrier } from "./selected-values.js";
import { rustSelectedCallTypeParameters } from "../source-evidence/types/resolution/generic-arguments.js";
import { acceptRustPolicy, rejectRustPolicy } from "../../policy/model/contracts.js";
import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection } from "../../policy/model/contracts.js";

import type { RustTargetMember, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetOperation } from "../../target-model/records/operations/member-selections.js";
import { Node_Expression, Node_Type, sourceDeclarationIsModuleScoped } from "@tsonic/target-api/source";

import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import type { RustTypedLocationOperands } from "../../target-model/records/storage/typed-location-operands.js";
import { rustSourceLocationTargetType, rustOptionalLocationPointeeCarrier, rustCallableProtocol, rustClosureProtocol, rustOptionElementCarrier, isRustAbsenceCarrier } from "../../target-model/types/index.js";
import { rustCarrierSupportsObjectIdentity } from "../../policy/operations/js-values/carrier-protocols.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import type { RustOperationsProviderOptions } from "./members/model.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import type { RustTargetTypeResolutionOptions } from "../source-evidence/types/resolution/index.js";
import { selectRustTypedLocationSourceOperation } from "../../source/extension/typed-locations.js";
import type { RustTypedLocationSourceFact } from "../../source/extension/typed-locations.js";

function typedLocationCallArguments(
  request: RustCheckedCallSelectionInput,
): readonly Node[] {
  return request.source.sourceArguments.map((argument) => argument.expression);
}

function typedLocationCallCalleeSymbol(
  request: RustCheckedCallSelectionInput,
): import("@tsonic/tsts").Symbol | undefined {
  return request.source.sourceCallee.selectedSymbol ??
    request.source.sourceCallee.symbol;
}

export function selectRustTypedLocationCall(
  request: RustCheckedCallSelectionInput,
  provider: ProviderDeclarationIdentity,
  marker: SourceCallMarkerKind,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  context.records.assertOpen();
  const selection = selectRustTypedLocationSourceOperation(
    request.source.call,
    marker,
    (subject, key) => context.source.sourceFacts.getFact(subject, key),
  );
  if (selection.kind === "not-typed-location") {
    return undefined;
  }
  if (selection.kind === "evidence-missing") {
    return rejectRustTypedLocation(
      request.source.call,
      context,
      "RUST_POINTER_OPERATION_FACT_NOT_PROVEN",
      `Selected typed-location operation '${selection.operation}' has no matching finalized TSTS operation fact.`,
    );
  }
  return acceptRustTypedLocationCall(
    request,
    provider,
    selection.sourceOperation,
    context,
    options,
  );
}

function acceptRustTypedLocationCall(
  request: RustCheckedCallSelectionInput,
  provider: ProviderDeclarationIdentity,
  sourceOperation: RustTypedLocationSourceFact,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  if (!rustTypedLocationArgumentsMatch(request, sourceOperation)) {
    return rejectRustTypedLocation(
      request.source.call,
      context,
      "RUST_POINTER_OPERATION_EVIDENCE_CONFLICT",
      `Selected '${sourceOperation.operation}' call arguments conflict with its finalized TSTS pointer-operation evidence.`,
    );
  }
  const selectedGenericParameters = request.source.sourceSelectedMethodTypeArguments ?? [];
  const genericArity = sourceOperation.operation === "project-pointer" ? 2 : 1;
  if (selectedGenericParameters.length !== genericArity) {
    return rejectRustTypedLocation(request.source.call, context,
      "RUST_POINTER_GENERIC_EVIDENCE_CONFLICT",
      `Selected '${sourceOperation.operation}' operation requires ${genericArity} exact source type arguments.`);
  }
  const pointeeCarrier = resolveRustTypedLocationPointee(
    sourceOperation,
    context,
    options,
  );
  if (pointeeCarrier === undefined) {
    return rejectRustTypedLocation(
      request.source.call,
      context,
      "RUST_POINTER_POINTEE_CARRIER_NOT_PROVEN",
      `Selected '${sourceOperation.operation}' operation has no closed Rust pointee carrier from finalized source evidence.`,
    );
  }
  const locationCarrier = rustSourceLocationTargetType(pointeeCarrier);
  const plan = rustTypedLocationPlan(sourceOperation, pointeeCarrier, context, options);
  if (plan.kind === "rejected") {
    return rejectRustTypedLocation(request.source.call, context,
      "RUST_POINTER_STORAGE_NOT_REPRESENTABLE", plan.reason);
  }
  const identityArgument = sourceOperation.operation === "bind-pointer" ? request.source.sourceArguments[0] : undefined;
  const identity = sourceOperation.operation !== "bind-pointer" || identityArgument?.expression !== sourceOperation.identityExpression
    ? undefined : selectedValueCarrier(identityArgument.expression, identityArgument.type, context, options);
  if (sourceOperation.operation === "bind-pointer" && (identity === undefined ||
    !(rustCarrierSupportsObjectIdentity(identity) || options.projectCarrierSupportsObjectIdentity(identity)))) {
    return rejectRustTypedLocation(request.source.call, context,
      "RUST_POINTER_IDENTITY_NOT_PROVEN", "Pointer binding requires a closed reference identity carrier.");
  }
  const signature = selectRustTypedLocationCallSignature(plan.value, pointeeCarrier, context.ast, identity);
  if (signature === undefined) return rejectRustTypedLocation(request.source.call, context,
    "RUST_POINTER_STORAGE_NOT_REPRESENTABLE", "Pointer operation requires its exact native input and result carriers.");
  return recordRustTypedLocationCall(request, plan.value, pointeeCarrier, locationCarrier, signature.parameters, signature.result,
    signature.generics, context, provider);
}

export function recordRustTypedLocationCall(
  request: RustCheckedCallSelectionInput,
  plan: RustTypedLocationOperands,
  pointeeCarrier: TargetTypeRef,
  locationCarrier: TargetTypeRef,
  parameterCarriers: readonly TargetTypeRef[],
  resultCarrier: TargetTypeRef,
  genericCarriers: readonly TargetTypeRef[],
  context: RustOperationAnalysisContext,
  provider?: ProviderDeclarationIdentity,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  context.records.assertOpen();
  const sourceOperation = plan;
  const selectedGenericParameters = request.source.sourceSelectedMethodTypeArguments ?? [];
  const sourceParameters = rustSelectedCallTypeParameters(selectedGenericParameters, context);
  if (sourceParameters === undefined) return rejectRustTypedLocation(request.source.call, context,
    "RUST_POINTER_GENERIC_EVIDENCE_CONFLICT", "A pointer operation requires exact selected generic declarations.");
  const operationId = `tsonic.rust.location.${sourceOperation.operation}`;
  const evidence = [{
    message: `rust selected exact typed-location operation ${sourceOperation.operation}`,
  }];
  requireRustRecord(context.requiredRecords, "typedLocationPlan", request.source.call, sourceOperation.operation, "recordRustTypedLocationCall");
  context.records.typedLocations.finalize(request.source.call, pointeeCarrier, locationCarrier, plan);
  const targetFact: RustTargetOperationFact = {
    kind: "typed-location",
    operationId,
    operation: sourceOperation.operation,
    pointeeCarrier,
    locationCarrier,
    resultCarrier,
  };
  const operation: RustSelectedTargetOperation = {
    operationId,
    operationKind: "method",
    targetOperation: sourceOperation.operation,
    resultType: resultCarrier,
    provenance: {
      sourceExpression: request.source.call,
      sourceCallee: request.source.sourceCallee.expression,
      sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: typedLocationCallCalleeSymbol(request),
      sourceResultType: request.source.sourceResultType,
      providerDeclaration: provider,
    },
  };
  for (const argument of typedLocationCallArguments(request)) {
    requireRustRecord(context.requiredRecords, "argumentPassing", argument, "by-value", "recordRustTypedLocationCall");
    context.records.argumentPassingPlans.pass(argument, "by-value");
  }
  const member: RustTargetMember = {
    id: operationId,
    sourceName: sourceOperation.operation,
    targetName: sourceOperation.operation,
    kind: "method",
    parameters: parameterCarriers.map((type, index) => ({
      name: `arg${index}`,
      type,
      passingMode: "by-value",
    })),
    returnType: resultCarrier,
    genericParameters: sourceParameters.map(parameter => ({
      kind: "type",
      sourceName: parameter.name,
      targetIdentity: parameter.identity,
    })),
    providerDeclaration: provider,
  };
  const selectedSignature = selectedRustCallSignature(request, member, {
    providerDeclaration: provider,
    targetGenericArguments: genericCarriers.map(type => ({ kind: "type", type })),
  });
  return acceptRustPolicy({ selectedSignature, targetFact, operation }, evidence);
}

function resolveRustTypedLocationPointee(
  operation: RustTypedLocationSourceFact,
  context: RustOperationAnalysisContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (operation.explicitPointeeTypeNode !== undefined) {
    return resolveRustTargetTypeRef(
      operation.explicitPointeeTypeNode,
      context,
      options,
    );
  }
  switch (operation.operation) {
    case "address-of":
      return resolveRustTargetTypeRef(
        operation.storageExpression,
        context,
        options,
      ) ?? resolveRustTargetTypeRef(
        operation.storageDeclaration === undefined
          ? operation.storageType
          : Node_Type(context.ast, operation.storageDeclaration) ??
            operation.storageDeclaration,
        context,
        options,
      );
    case "allocate":
      return resolveRustTargetTypeRef(
        operation.initialExpression,
        context,
        options,
      ) ?? resolveRustTargetTypeRef(operation.initialType, context, options);
    case "load":
    case "store":
    case "hash-pointer":
      return rustOptionalLocationPointeeCarrier(resolveRustTargetTypeRef(
        operation.pointerExpression,
        context,
        options,
      ) ?? resolveRustTargetTypeRef(
        operation.pointerType,
        context,
        options,
      ));
    case "equal-pointer":
      return rustOptionalLocationPointeeCarrier(resolveRustTargetTypeRef(
        operation.leftExpression,
        context,
        options,
      ) ?? resolveRustTargetTypeRef(
        operation.leftType,
        context,
        options,
      )) ?? rustOptionalLocationPointeeCarrier(resolveRustTargetTypeRef(
        operation.rightExpression,
        context,
        options,
      ) ?? resolveRustTargetTypeRef(
        operation.rightType,
        context,
        options,
      ));
    case "bind-pointer":
    case "project-pointer": {
      const callback = sourceCallback(operation, context, options);
      return callback?.kind === "function-pointer" ? callback.result
        : (rustClosureProtocol(callback) ?? rustCallableProtocol(callback))?.result;
    }
  }
}

function sourceCallback(
  operation: Extract<RustTypedLocationSourceFact, { operation: "bind-pointer" | "project-pointer" }>,
  context: RustOperationAnalysisContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  return resolveRustTargetTypeRef(operation.operation === "bind-pointer"
    ? operation.readExpression : operation.fromSourceExpression, context, options);
}

function rustTypedLocationArgumentsMatch(
  request: RustCheckedCallSelectionInput,
  operation: RustTypedLocationSourceFact,
): boolean {
  if (operation.call !== request.source.call) {
    return false;
  }
  const expected = operation.operation === "address-of"
    ? [operation.storageExpression]
    : operation.operation === "allocate"
      ? [operation.initialExpression]
      : operation.operation === "load"
        ? [operation.pointerExpression]
        : operation.operation === "store"
          ? [operation.pointerExpression, operation.valueExpression]
          : operation.operation === "equal-pointer"
            ? [operation.leftExpression, operation.rightExpression]
            : operation.operation === "hash-pointer"
              ? [operation.pointerExpression]
              : operation.operation === "bind-pointer"
                ? [operation.identityExpression, operation.readExpression, operation.writeExpression]
                : [operation.pointerExpression, operation.fromSourceExpression, operation.toSourceExpression];
  return expected.length === typedLocationCallArguments(request).length &&
    expected.every((argument, index) => argument === typedLocationCallArguments(request)[index]);
}

type RustTypedLocationPlanSelection =
  | { readonly kind: "selected"; readonly value: RustTypedLocationOperands }
  | { readonly kind: "rejected"; readonly reason: string };

function rustTypedLocationPlan(
  operation: RustTypedLocationSourceFact,
  pointeeCarrier: TargetTypeRef,
  context: RustOperationAnalysisContext,
  options: RustTargetTypeResolutionOptions,
): RustTypedLocationPlanSelection {
  switch (operation.operation) {
    case "hash-pointer":
      return { kind: "selected", value: { operation: operation.operation,
        pointerExpression: operation.pointerExpression } };
    case "bind-pointer":
      return { kind: "selected", value: { operation: operation.operation,
        identityExpression: operation.identityExpression,
        readExpression: operation.readExpression, writeExpression: operation.writeExpression } };
    case "project-pointer": {
      const sourceLocation = resolveRustTargetTypeRef(operation.pointerExpression, context, options);
      const operandPointeeCarrier = rustOptionalLocationPointeeCarrier(sourceLocation);
      const sourcePointeeCarrier = operation.explicitSourcePointeeTypeNode === undefined
        ? operandPointeeCarrier
        : resolveRustTargetTypeRef(operation.explicitSourcePointeeTypeNode, context, options);
      return sourcePointeeCarrier === undefined ||
        (operandPointeeCarrier === undefined
          ? !isRustAbsenceCarrier(sourceLocation)
          : !rustTargetTypeRefEquals(sourcePointeeCarrier, operandPointeeCarrier))
        ? { kind: "rejected", reason: "Pointer projection requires the exact source location carrier." }
        : { kind: "selected", value: { operation: operation.operation,
            pointerExpression: operation.pointerExpression, sourcePointeeCarrier,
            optional: rustOptionElementCarrier(sourceLocation) !== undefined || isRustAbsenceCarrier(sourceLocation),
            fromSourceExpression: operation.fromSourceExpression, toSourceExpression: operation.toSourceExpression } };
    }
    case "address-of": {
      if (operation.storageDeclaration === undefined) {
        return {
          kind: "rejected",
          reason:
            "Selected address-of operation has no exact writable storage declaration.",
        };
      }
      const root = rustTypedLocationStorageRoot(
        operation.storageExpression,
        context,
        options,
      );
      if (root === undefined) {
        return {
          kind: "rejected",
          reason:
            "Selected address-of storage has no exact local, module, or stored object-field root.",
        };
      }
      if (root.storage === "object-field" && (root.declaration !== operation.storageDeclaration ||
        !rustTargetTypeRefEquals(root.carrier, pointeeCarrier))) {
        return { kind: "rejected", reason: "Selected field address differs from its exact writable declaration or pointee carrier." };
      }
      const rootCarrier = root.carrier ??
        (root.expression === operation.storageExpression
          ? pointeeCarrier
          : undefined);
      if (rootCarrier === undefined) {
        return {
          kind: "rejected",
          reason:
            "Selected address-of storage root has no closed Rust value carrier.",
        };
      }
      if (root.storage === "local-location") {
        requireRustRecord(context.requiredRecords, "bindingStorage", root.declaration, "local-location", "analysis/operations/typed-locations.ts");
        if (!context.records.bindingStoragePlans.requireLocation(context, root.declaration, rootCarrier)) {
          return { kind: "rejected", reason: "Selected address-of storage requires its exact native location and value carrier." };
        }
      }
      return {
        kind: "selected",
        value: {
          operation: "address-of",
          storageExpression: operation.storageExpression,
          storageDeclaration: operation.storageDeclaration,
          rootExpression: root.expression,
          rootDeclaration: root.declaration,
          locationIdentity: operation.locationIdentity,
        },
      };
    }
    case "allocate":
      return {
        kind: "selected",
        value: {
          operation: "allocate",
          initialExpression: operation.initialExpression,
          locationIdentity: operation.locationIdentity,
        },
      };
    case "load":
      return {
        kind: "selected",
        value: {
          operation: "load",
          pointerExpression: operation.pointerExpression,
        },
      };
    case "store":
      return {
        kind: "selected",
        value: {
          operation: "store",
          pointerExpression: operation.pointerExpression,
          valueExpression: operation.valueExpression,
        },
      };
    case "equal-pointer":
      return {
        kind: "selected",
        value: {
          operation: "equal-pointer",
          leftExpression: operation.leftExpression,
          rightExpression: operation.rightExpression,
        },
      };
  }
}

function rustTypedLocationStorageRoot(
  storage: Node,
  context: RustOperationAnalysisContext,
  options: RustTargetTypeResolutionOptions,
): {
  readonly expression: Node;
  readonly declaration: Node;
  readonly storage: "local-location" | "module-cell" | "object-field";
  readonly carrier?: TargetTypeRef;
} | undefined {
  const field = context.records.targetOperation.get(storage);
  if (field?.kind === "source-field" && field.storage === "project-object" &&
    field.declaration !== undefined && field.valueSemantics.kind === "stored") {
    return { expression: storage, declaration: field.declaration, storage: "object-field", carrier: field.resultCarrier };
  }
  const root = rustTypedLocationStorageRootReference(
    storage,
    context.ast,
    context.source.navigation,
  );
  const expression = root?.expression;
  const declaration = root?.declaration;
  if (expression === undefined || declaration === undefined ||
    (context.ast.kindName(declaration) !== "KindVariableDeclaration" &&
      context.ast.kindName(declaration) !== "KindBindingElement" &&
      context.ast.kindName(declaration) !== "KindParameter")) {
    return undefined;
  }
  let owner = context.ast.parent(declaration);
  let functionLocal = false;
  const moduleBinding = sourceDeclarationIsModuleScoped(declaration, context.ast);
  while (owner !== undefined) {
    const kind = context.ast.kindName(owner);
    if (kind === "KindFunctionDeclaration" ||
      kind === "KindMethodDeclaration" ||
      kind === "KindConstructor" ||
      kind === "KindArrowFunction" ||
      kind === "KindFunctionExpression") {
      functionLocal = true;
      break;
    }
    if (kind === "KindSourceFile") {
      break;
    }
    owner = context.ast.parent(owner);
  }
  if (!functionLocal && !moduleBinding) {
    return undefined;
  }
  if (moduleBinding) {
    const binding = context.records.moduleBinding.get(declaration);
    if (binding?.storage !== "module-cell" &&
      !(binding?.storage === "native-callable" && binding.value !== undefined)) {
      return undefined;
    }
  }
  return {
    expression,
    declaration,
    storage: functionLocal ? "local-location" : "module-cell",
    carrier: resolveRustTargetTypeRef(
      Node_Type(context.ast, declaration) ?? declaration,
      context,
      options,
    ),
  };
}

export function rustTypedLocationStorageRootReference(
  storage: Node,
  ast: AstReader,
  navigation: SourceProgramNavigation,
): { readonly expression: Node; readonly declaration: Node } | undefined {
  let expression = storage;
  while (true) {
    const kind = ast.kindName(expression);
    if (kind !== "KindPropertyAccessExpression" &&
      kind !== "KindElementAccessExpression" &&
      kind !== "KindParenthesizedExpression") {
      break;
    }
    const receiver = Node_Expression(ast, expression);
    if (receiver === undefined) {
      return undefined;
    }
    expression = receiver;
  }
  if (ast.kindName(expression) !== "KindIdentifier") {
    return undefined;
  }
  const reference = navigation.sourceReferenceFor(expression);
  return reference?.project === true
    ? { expression, declaration: reference.declaration }
    : undefined;
}

function rejectRustTypedLocation<T>(
  node: Node,
  context: RustOperationAnalysisContext,
  extensionCode: string,
  message: string,
): RustPolicySelection<T> {
  return rejectRustPolicy({
    extensionId: context.extensionId,
    extensionCode,
    numericCode: 0,
    category: "error",
    message,
    nodeOrSpan: node,
    evidence: [{ message: "target.capability=rust.selected-operation" }],
  });
}
