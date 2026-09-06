import type {
  AstReader,
  Node,
  ProviderDeclarationIdentity,
  SourceCallMarkerKind,
} from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import {
  acceptRustPolicy,
  rejectRustPolicy,
} from "../../policy/operations/contracts.js";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedCallSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../policy/operations/contracts.js";
import {
  rustArgumentPassingKey,
  rustSelectedCallKey,
  rustSelectedOperationKey,
} from "../../target-model/facts/selections.js";
import type {
  RustSelectedTargetSignature,
  RustTargetMember,
  TargetTypeRef,
} from "../../target-model/types/model.js";
import {
  Node_Expression,
  Node_Type,
} from "@tsonic/target-api/source";
import {
  rustLocationStorageFactKey,
  rustModuleBindingFactKey,
  rustTargetOperationFactKey,
  rustTypedLocationPlanKey,
} from "../facts/keys.js";
import type {
  RustTypedLocationPlan,
} from "../facts/keys.js";
import {
  rustLocationTargetType,
  rustOptionalLocationPointeeCarrier,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustUnitTargetType,
  rustCallableProtocol,
  rustClosureProtocol,
  rustClosureTargetType,
  rustCarrierSupportsObjectIdentity,
  rustOptionElementCarrier,
  isRustDefinitelyNullishCarrier,
} from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustOperationsProviderOptions } from "./provider/model.js";
import {
  resolveRustTargetTypeRef,
} from "../../policy/types/resolution.js";
import type {
  RustTargetTypeResolutionOptions,
} from "../../policy/types/resolution.js";
import {
  selectRustTypedLocationSourceOperation,
} from "../../policy/operations/typed-location-source.js";
import type {
  RustTypedLocationSourceFact,
} from "../../policy/operations/typed-location-source.js";

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

function typedLocationCallCalleeDeclaration(
  request: RustCheckedCallSelectionInput,
): Node | undefined {
  return request.source.sourceCallee.selectedDeclaration ??
    request.source.sourceCallee.declaration;
}

export function selectRustTypedLocationCall(
  request: RustCheckedCallSelectionInput,
  provider: ProviderDeclarationIdentity,
  marker: SourceCallMarkerKind,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  const selection = selectRustTypedLocationSourceOperation(
    request.source.call,
    marker,
    (subject, key) => context.facts.resolve(subject, key),
    (subject, key) => context.facts.get(subject, key),
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
  context: RustOperationPolicyContext,
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
  const locationCarrier = rustLocationTargetType(pointeeCarrier);
  const optionLocationCarrier = rustOptionTargetType(locationCarrier);
  const boolCarrier = rustSourcePrimitiveTargetType("bool");
  const unitCarrier = rustUnitTargetType();
  const plan = rustTypedLocationPlan(sourceOperation, pointeeCarrier, locationCarrier, context, options);
  if (plan.kind === "rejected") {
    return rejectRustTypedLocation(request.source.call, context,
      "RUST_POINTER_STORAGE_NOT_REPRESENTABLE", plan.reason);
  }
  let parameterCarriers: readonly TargetTypeRef[] =
    sourceOperation.operation === "address-of" ||
      sourceOperation.operation === "allocate"
      ? [pointeeCarrier]
      : sourceOperation.operation === "load"
        ? [locationCarrier]
        : sourceOperation.operation === "store"
          ? [locationCarrier, pointeeCarrier]
          : sourceOperation.operation === "hash-pointer"
            ? [optionLocationCarrier]
            : [optionLocationCarrier, optionLocationCarrier];
  if (sourceOperation.operation === "bind-pointer") {
    const identity = resolveRustTargetTypeRef(sourceOperation.identityExpression, context, options);
    if (identity === undefined || !(rustCarrierSupportsObjectIdentity(identity) ||
      options.projectCarrierSupportsObjectIdentity(identity))) {
      return rejectRustTypedLocation(request.source.call, context,
        "RUST_POINTER_IDENTITY_NOT_PROVEN", "Pointer binding requires a closed reference identity carrier.");
    }
    parameterCarriers = [identity,
      rustClosureTargetType([], pointeeCarrier),
      rustClosureTargetType([pointeeCarrier], unitCarrier)];
  } else if (plan.value.operation === "project-pointer") {
    const sourceCarrier = rustLocationTargetType(plan.value.sourcePointeeCarrier);
    parameterCarriers = [plan.value.optional ? rustOptionTargetType(sourceCarrier) : sourceCarrier,
      rustClosureTargetType([plan.value.sourcePointeeCarrier], pointeeCarrier),
      rustClosureTargetType([pointeeCarrier], plan.value.sourcePointeeCarrier)];
  }
  const resultCarrier = sourceOperation.operation === "load"
    ? pointeeCarrier
    : sourceOperation.operation === "store"
      ? unitCarrier
      : sourceOperation.operation === "equal-pointer"
        ? boolCarrier
        : sourceOperation.operation === "hash-pointer"
          ? rustSourcePrimitiveTargetType("float64")
          : plan.value.operation === "project-pointer" && plan.value.optional
            ? optionLocationCarrier : locationCarrier;
  const operationId = `tsonic.rust.location.${sourceOperation.operation}`;
  const evidence = [{
    message: `rust selected exact typed-location operation ${sourceOperation.operation}`,
  }];
  context.facts.set(request.source.call, rustTypedLocationPlanKey, plan.value, evidence);
  context.facts.set(request.source.call, rustTargetOperationFactKey, {
    kind: "typed-location",
    operationId,
    operation: sourceOperation.operation,
    pointeeCarrier,
    locationCarrier,
    resultCarrier,
  }, evidence);
  context.facts.set(request.source.call, rustSelectedOperationKey, {
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
  }, evidence);
  for (const argument of typedLocationCallArguments(request)) {
    context.facts.set(argument, rustArgumentPassingKey, {
      mode: "by-value",
    }, evidence);
  }
  const genericCarriers = plan.value.operation === "project-pointer"
    ? [plan.value.sourcePointeeCarrier, pointeeCarrier] : [pointeeCarrier];
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
    genericParameters: selectedGenericParameters.map(parameter => ({
      kind: "type",
      sourceName: parameter.typeParameterName,
    })),
    providerDeclaration: provider,
  };
  const selectedSignature: RustSelectedTargetSignature = {
    member,
    providerDeclaration: provider,
    ...(request.source.selectedSignature === undefined
      ? {}
      : { sourceSignature: request.source.selectedSignature }),
    ...(request.sourceSelectedDeclaration === undefined
      ? {}
      : { sourceDeclaration: request.sourceSelectedDeclaration }),
    ...(typedLocationCallCalleeSymbol(request) === undefined
      ? {}
      : { sourceCalleeSymbol: typedLocationCallCalleeSymbol(request) }),
    ...(typedLocationCallCalleeDeclaration(request) === undefined
      ? {}
      : { sourceCalleeDeclaration: typedLocationCallCalleeDeclaration(request) }),
    ...(request.source.sourceResultType === undefined
      ? {}
      : { sourceReturnType: request.source.sourceResultType }),
    sourceArgumentBindings: request.source.sourceArgumentBindings,
    sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    ...(request.source.sourceSelectedMethodTypeArguments === undefined
      ? {}
      : {
          sourceSelectedMethodTypeArguments:
            request.source.sourceSelectedMethodTypeArguments,
        }),
    targetGenericArguments: genericCarriers.map(type => ({ kind: "type", type })),
  };
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature, evidence);
  return acceptRustPolicy({ selectedSignature }, evidence);
}

function resolveRustTypedLocationPointee(
  operation: RustTypedLocationSourceFact,
  context: RustOperationPolicyContext,
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
  context: RustOperationPolicyContext,
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
  | { readonly kind: "selected"; readonly value: RustTypedLocationPlan }
  | { readonly kind: "rejected"; readonly reason: string };

function rustTypedLocationPlan(
  operation: RustTypedLocationSourceFact,
  pointeeCarrier: TargetTypeRef,
  locationCarrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustTargetTypeResolutionOptions,
): RustTypedLocationPlanSelection {
  const base = {
    call: operation.call,
    pointeeCarrier,
    locationCarrier,
  } as const;
  switch (operation.operation) {
    case "hash-pointer":
      return { kind: "selected", value: { ...base, operation: operation.operation,
        pointerExpression: operation.pointerExpression } };
    case "bind-pointer":
      return { kind: "selected", value: { ...base, operation: operation.operation,
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
          ? !isRustDefinitelyNullishCarrier(sourceLocation)
          : !rustTargetTypeRefEquals(sourcePointeeCarrier, operandPointeeCarrier))
        ? { kind: "rejected", reason: "Pointer projection requires the exact source location carrier." }
        : { kind: "selected", value: { ...base, operation: operation.operation,
            pointerExpression: operation.pointerExpression, sourcePointeeCarrier,
            optional: rustOptionElementCarrier(sourceLocation) !== undefined || isRustDefinitelyNullishCarrier(sourceLocation),
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
            "Selected address-of storage has no exact function-local variable or parameter root.",
        };
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
        context.facts.set(root.declaration, rustLocationStorageFactKey, {
          valueCarrier: rootCarrier,
        }, [{ message: "rust selected canonical typed-location storage root" }]);
      }
      return {
        kind: "selected",
        value: {
          ...base,
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
          ...base,
          operation: "allocate",
          initialExpression: operation.initialExpression,
          locationIdentity: operation.locationIdentity,
        },
      };
    case "load":
      return {
        kind: "selected",
        value: {
          ...base,
          operation: "load",
          pointerExpression: operation.pointerExpression,
        },
      };
    case "store":
      return {
        kind: "selected",
        value: {
          ...base,
          operation: "store",
          pointerExpression: operation.pointerExpression,
          valueExpression: operation.valueExpression,
        },
      };
    case "equal-pointer":
      return {
        kind: "selected",
        value: {
          ...base,
          operation: "equal-pointer",
          leftExpression: operation.leftExpression,
          rightExpression: operation.rightExpression,
        },
      };
  }
}

function rustTypedLocationStorageRoot(
  storage: Node,
  context: RustOperationPolicyContext,
  options: RustTargetTypeResolutionOptions,
): {
  readonly expression: Node;
  readonly declaration: Node;
  readonly storage: "local-location" | "module-cell";
  readonly carrier?: TargetTypeRef;
} | undefined {
  const root = rustTypedLocationStorageRootReference(
    storage,
    context.ast,
    context.source.navigation,
  );
  const expression = root?.expression;
  const declaration = root?.declaration;
  if (expression === undefined || declaration === undefined ||
    (context.ast.kindName(declaration) !== "KindVariableDeclaration" &&
      context.ast.kindName(declaration) !== "KindParameter")) {
    return undefined;
  }
  let owner = context.ast.parent(declaration);
  let functionLocal = false;
  let moduleBinding = false;
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
      moduleBinding = context.ast.kindName(declaration) === "KindVariableDeclaration";
      break;
    }
    owner = context.ast.parent(owner);
  }
  if (!functionLocal && !moduleBinding) {
    return undefined;
  }
  if (moduleBinding) {
    const binding = context.facts.get(declaration, rustModuleBindingFactKey);
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
  context: RustOperationPolicyContext,
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
