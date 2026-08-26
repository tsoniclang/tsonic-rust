import type { Node } from "@tsonic/tsts";
import {
  Node_Expression,
  Node_Initializer,
} from "@tsonic/target-api/source";
import {
  rustAsyncFunctionFactKey,
  rustResourceManagementFactKey,
  rustSelfModeFactKey,
  rustTargetOperationFactKey,
  type RustTargetOperationFact,
} from "../facts/keys.js";
import type {
  RustProviderTypeRequirement,
  RustResolvedProviderRequirementSourceInput,
  RustResolvedProviderTypeParameterRequirement,
  RustSourceCallParameterPlan,
} from "../../target-model/operations/model.js";
import type {
  RustCapture,
  RustLifetimeRef,
  RustTraitRef,
  RustTypeRef,
} from "../../target-model/semantics/index.js";
import { rustSemanticIdentitiesEqual } from "../../target-model/semantics/index.js";
import {
  rustFutureOutputCarrier,
  rustInferredLifetime,
  rustReferenceTargetType,
  rustSendTrait,
  rustSyncTrait,
} from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustCaptureAnalysis } from "./captures.js";
import type {
  RustOwnershipAnalysisInput,
  RustOwnershipEnvironment,
} from "./context.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";

type RustFutureStateRequirement =
  | { readonly kind: "trait"; readonly trait: RustTraitRef }
  | { readonly kind: "outlives"; readonly lifetime: RustLifetimeRef };

interface RustSourceFutureOrigin {
  readonly call: Node;
  readonly callable: Node;
  readonly operation: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>;
}

export function rustFutureProviderRequirementIsProven(
  operationNode: Node,
  requirement: RustResolvedProviderTypeParameterRequirement,
  bound: RustProviderTypeRequirement,
  captures: RustCaptureAnalysis,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
): boolean {
  if (rustFutureOutputCarrier(requirement.carrier) === undefined) return false;
  const stateRequirement = futureStateRequirement(requirement, bound);
  if (stateRequirement === undefined || requirement.sourceInputs.length === 0) return false;
  const resolving = new Set<Node>();
  return requirement.sourceInputs.every((sourceInput) => {
    const expression = sourceInputExpression(operationNode, sourceInput, input);
    return expression !== undefined && futureExpressionRequirementIsProven(
      expression,
      requirement.carrier,
      stateRequirement,
      captures,
      input,
      environment,
      resolving,
    );
  });
}

function futureStateRequirement(
  requirement: RustResolvedProviderTypeParameterRequirement,
  bound: RustProviderTypeRequirement,
): RustFutureStateRequirement | undefined {
  if (bound.kind === "trait" && bound.polarity === "required" &&
    (rustSemanticIdentitiesEqual(bound.trait.identity, rustSendTrait.identity) ||
      rustSemanticIdentitiesEqual(bound.trait.identity, rustSyncTrait.identity))) {
    return Object.freeze({ kind: "trait", trait: bound.trait });
  }
  return bound.kind === "type-outlives" &&
      rustTargetTypeRefEquals(bound.type, requirement.carrier)
    ? Object.freeze({ kind: "outlives", lifetime: bound.lifetime })
    : undefined;
}

function sourceInputExpression(
  operationNode: Node,
  sourceInput: RustResolvedProviderRequirementSourceInput,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  if (sourceInput.kind === "argument") {
    return input.ast.arguments(operationNode)[sourceInput.sourceIndex];
  }
  const callee = Node_Expression(input.ast, operationNode);
  if (callee === undefined) return undefined;
  const kind = input.ast.kindName(callee);
  return kind === "KindPropertyAccessExpression" || kind === "KindElementAccessExpression"
    ? Node_Expression(input.ast, callee)
    : undefined;
}

function futureExpressionRequirementIsProven(
  expression: Node,
  expectedCarrier: RustTypeRef,
  requirement: RustFutureStateRequirement,
  captures: RustCaptureAnalysis,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  resolving: Set<Node>,
): boolean {
  const selected = transparentExpression(expression, input);
  if (resolving.has(selected)) return false;
  resolving.add(selected);
  try {
    const origin = sourceFutureOrigin(selected, input, new Set());
    if (origin === undefined ||
      !rustTargetTypeRefEquals(origin.operation.resultCarrier, expectedCarrier)) {
      return false;
    }
    const callArguments = input.ast.arguments(origin.call);
    if (!origin.operation.parameters.every((parameter) =>
      sourceParameterRequirementIsProven(
        parameter,
        callArguments,
        requirement,
        captures,
        input,
        environment,
        resolving,
      ))) {
      return false;
    }
    const receiverCarrier = origin.operation.target.form === "method"
      ? futureMethodReceiverCarrier(origin, input)
      : undefined;
    if (origin.operation.target.form === "method" &&
      (receiverCarrier === undefined || !carrierRequirementIsProven(
        receiverCarrier,
        requirement,
        environment,
      ))) {
      return false;
    }
    return sourceCallableFutureRequirementIsProven(
      origin.callable,
      requirement,
      captures,
      input,
      environment,
      resolving,
    );
  } finally {
    resolving.delete(selected);
  }
}

function sourceCallableFutureRequirementIsProven(
  callable: Node,
  requirement: RustFutureStateRequirement,
  captures: RustCaptureAnalysis,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  resolving: Set<Node>,
): boolean {
  if (resolving.has(callable) ||
    input.facts.getFact(callable, rustAsyncFunctionFactKey) === undefined) {
    return false;
  }
  resolving.add(callable);
  try {
    const execution = captures.executionContractByCallable.get(callable);
    return execution !== undefined &&
      execution.captures.every((capture) =>
        captureRequirementIsProven(capture, requirement, environment)) &&
      execution.suspendedValues.every((state) =>
        carrierRequirementIsProven(state.carrier, requirement, environment)) &&
      awaitedFutureRequirementsAreProven(
        callable,
        requirement,
        captures,
        input,
        environment,
        resolving,
      );
  } finally {
    resolving.delete(callable);
  }
}

function sourceParameterRequirementIsProven(
  parameter: RustSourceCallParameterPlan,
  callArguments: readonly (Node | undefined)[],
  requirement: RustFutureStateRequirement,
  captures: RustCaptureAnalysis,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  resolving: Set<Node>,
): boolean {
  if (rustFutureOutputCarrier(parameter.parameterCarrier) === undefined) {
    return carrierRequirementIsProven(parameter.parameterCarrier, requirement, environment);
  }
  if (parameter.inputs.length === 0) return false;
  return parameter.inputs.every((source) => {
    const argument = callArguments[source.sourceArgumentIndex];
    return argument !== undefined && futureExpressionRequirementIsProven(
      argument,
      parameter.parameterCarrier,
      requirement,
      captures,
      input,
      environment,
      resolving,
    );
  });
}

function awaitedFutureRequirementsAreProven(
  callable: Node,
  requirement: RustFutureStateRequirement,
  captures: RustCaptureAnalysis,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  resolving: Set<Node>,
): boolean {
  if (requirement.kind === "outlives") return true;
  let proven = true;
  const pending = [callable];
  while (pending.length > 0 && proven) {
    const node = pending.pop()!;
    if (node !== callable && isCallable(node, input)) continue;
    const kind = input.ast.kindName(node);
    if (kind === "KindAwaitExpression") {
      const operand = Node_Expression(input.ast, node);
      if (operand === undefined) {
        proven = false;
        break;
      }
      const carrier = input.facts.getRuntimeCarrierFact(operand)?.carrier;
      if (carrier === undefined ||
        rustFutureOutputCarrier(carrier) === undefined ||
        !futureExpressionRequirementIsProven(
          operand,
          carrier,
          requirement,
          captures,
          input,
          environment,
          resolving,
        )) {
        proven = false;
        break;
      }
    } else if (kind === "KindVariableDeclaration" &&
      input.ast.variableDeclarationKind(node) === "await using" &&
      !asyncResourceCleanupRequirementIsProven(
        node,
        requirement,
        captures,
        input,
        environment,
        resolving,
      )) {
      proven = false;
      break;
    } else {
      const operation = input.facts.getFact(node, rustTargetOperationFactKey);
      if (operation?.kind === "iteration" && operation.iterationKind === "for-await-of" &&
        operation.lowering.kind === "async-generator" &&
        !asyncIterationRequirementIsProven(node, requirement, input, environment)) {
        proven = false;
        break;
      }
    }
    input.ast.forEachChild(node, (child) => {
      if (child !== undefined) pending.push(child);
    });
  }
  return proven;
}

function asyncResourceCleanupRequirementIsProven(
  declaration: Node,
  requirement: Extract<RustFutureStateRequirement, { readonly kind: "trait" }>,
  captures: RustCaptureAnalysis,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  resolving: Set<Node>,
): boolean {
  const fact = input.facts.getFact(declaration, rustResourceManagementFactKey);
  if (fact?.disposal.kind !== "async" || fact.disposal.target.form !== "source-method") {
    return false;
  }
  const callable = captures.callableForSourceIdentity(
    fact.disposal.target.sourceDeclarationIdentity,
  );
  if (callable === undefined) return false;
  const occurrence = requireRustOwnershipSourceIdentity(input.ast, declaration);
  const receiver = rustReferenceTargetType(
    fact.resourceCarrier,
    fact.disposal.target.receiverMode === "mut-ref",
    rustInferredLifetime(`resource-cleanup-receiver\0${occurrence}`),
  );
  return carrierRequirementIsProven(receiver, requirement, environment) &&
    sourceCallableFutureRequirementIsProven(
      callable,
      requirement,
      captures,
      input,
      environment,
      resolving,
    );
}

function asyncIterationRequirementIsProven(
  statement: Node,
  requirement: Extract<RustFutureStateRequirement, { readonly kind: "trait" }>,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
): boolean {
  const iterable = Node_Expression(input.ast, statement);
  if (iterable === undefined) return false;
  const carrier = input.facts.getRuntimeCarrierFact(iterable)?.carrier;
  if (carrier === undefined) return false;
  const occurrence = requireRustOwnershipSourceIdentity(input.ast, statement);
  return carrierRequirementIsProven(
    rustReferenceTargetType(
      carrier,
      true,
      rustInferredLifetime(`async-iteration-receiver\0${occurrence}`),
    ),
    requirement,
    environment,
  );
}

function captureRequirementIsProven(
  capture: RustCapture,
  requirement: RustFutureStateRequirement,
  environment: RustOwnershipEnvironment,
): boolean {
  return requirement.kind === "outlives"
    ? environment.typeOutlives(capture.representationCarrier, requirement.lifetime)
    : environment.supportsTrait(capture.representationCarrier, requirement.trait);
}

function futureMethodReceiverCarrier(
  origin: RustSourceFutureOrigin,
  input: RustOwnershipAnalysisInput,
): RustTypeRef | undefined {
  const receiver = input.facts.getSelectedTargetCall(origin.call)?.sourceSelectedReceiverCarrier;
  const selfMode = input.facts.getFact(origin.callable, rustSelfModeFactKey);
  if (receiver === undefined || selfMode === undefined) return undefined;
  const occurrence = requireRustOwnershipSourceIdentity(input.ast, origin.call);
  return rustReferenceTargetType(
    receiver,
    selfMode.mode === "mut-ref",
    rustInferredLifetime(`source-method-call-receiver\0${occurrence}`),
  );
}

function carrierRequirementIsProven(
  carrier: RustTypeRef,
  requirement: RustFutureStateRequirement,
  environment: RustOwnershipEnvironment,
): boolean {
  return requirement.kind === "trait"
    ? environment.supportsTrait(carrier, requirement.trait)
    : environment.typeOutlives(carrier, requirement.lifetime);
}

function sourceFutureOrigin(
  expression: Node,
  input: RustOwnershipAnalysisInput,
  resolving: Set<Node>,
): RustSourceFutureOrigin | undefined {
  const selected = transparentExpression(expression, input);
  if (resolving.has(selected)) return undefined;
  resolving.add(selected);
  const operation = input.facts.getFact(selected, rustTargetOperationFactKey);
  if (operation?.kind === "source-call" &&
    rustFutureOutputCarrier(operation.resultCarrier) !== undefined) {
    const callable = sourceCallableForCall(selected, input);
    return callable === undefined ? undefined : { call: selected, callable, operation };
  }
  const sourceReference = input.navigation.sourceReferenceFor(selected);
  const declaration = sourceReference?.project === true ? sourceReference.declaration : undefined;
  if (declaration === undefined || input.ast.kindName(declaration) !== "KindVariableDeclaration" ||
    input.ast.variableDeclarationKind(declaration) !== "const") {
    return undefined;
  }
  const initializer = Node_Initializer(input.ast, declaration);
  return initializer === undefined ? undefined : sourceFutureOrigin(initializer, input, resolving);
}

function sourceCallableForCall(
  call: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  const selected = input.facts.getSelectedTargetCall(call);
  for (const candidate of [
    selected?.sourceDeclaration,
    selected?.sourceCalleeDeclaration,
    Node_Expression(input.ast, call),
  ]) {
    const callable = sourceCallable(candidate, input, new Set());
    if (callable !== undefined) return callable;
  }
  return undefined;
}

function sourceCallable(
  node: Node | undefined,
  input: RustOwnershipAnalysisInput,
  resolving: Set<Node>,
): Node | undefined {
  if (node === undefined) return undefined;
  const selected = transparentExpression(node, input);
  if (resolving.has(selected)) return undefined;
  resolving.add(selected);
  if (isCallable(selected, input)) return selected;
  const implementation = input.navigation.callableImplementation(selected);
  if (implementation.kind === "resolved" &&
    isCallable(implementation.implementation.declaration, input)) {
    return implementation.implementation.declaration;
  }
  const reference = input.navigation.sourceReferenceFor(selected);
  const declaration = reference?.project === true ? reference.declaration : undefined;
  if (declaration === undefined) return undefined;
  if (isCallable(declaration, input)) return declaration;
  if (input.ast.kindName(declaration) !== "KindVariableDeclaration" ||
    input.ast.variableDeclarationKind(declaration) !== "const") {
    return undefined;
  }
  return sourceCallable(Node_Initializer(input.ast, declaration), input, resolving);
}

function transparentExpression(
  expression: Node,
  input: RustOwnershipAnalysisInput,
): Node {
  let current = expression;
  for (;;) {
    const kind = input.ast.kindName(current);
    if (kind !== "KindParenthesizedExpression" && kind !== "KindAsExpression" &&
      kind !== "KindSatisfiesExpression" && kind !== "KindNonNullExpression" &&
      kind !== "KindTypeAssertionExpression") {
      return current;
    }
    const inner = Node_Expression(input.ast, current);
    if (inner === undefined) return current;
    current = inner;
  }
}

function isCallable(node: Node, input: RustOwnershipAnalysisInput): boolean {
  const kind = input.ast.kindName(node);
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" || kind === "KindSetAccessor";
}
