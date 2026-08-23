import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustFutureOutputCarrier, rustFutureTargetType } from "../../target-model/types/index.js";
import { validateRustFinalizedOperationAbi } from "./finalized-operation-abi.js";
import {
  KindIdentifier,
  KindParenthesizedExpression,
  KindVariableDeclaration,
  Node_Expression,
  Node_Initializer,
} from "@tsonic/target-api/source";
import {
  rustFutureValueFactKey,
  rustMutatedBindingFactKey,
  rustSourceCallEffectsFactKey,
  rustTargetOperationFactKey,
} from "./keys.js";
import type {
  RustFutureValueFact,
  RustSourceCallEffectsFact,
  RustTargetOperationFact,
} from "./keys.js";
import type { AstReader, Node } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";

export function rustFutureValueForOperation(
  operation: RustTargetOperationFact | undefined,
  sourceCallEffects?: RustSourceCallEffectsFact,
): RustFutureValueFact | undefined {
  if (operation?.kind === "provider-operation") {
    if (!validateRustFinalizedOperationAbi(operation.abi) || operation.abi.result.kind !== "async") {
      return undefined;
    }
    const awaiting = operation.abi.effects.awaiting;
    if (awaiting === "not-applicable") {
      return undefined;
    }
    return {
      outputCarrier: operation.abi.result.awaitedCarrier,
      awaitedConversion: operation.abi.result.awaitedConversion,
      awaiting,
      errorBoundary: operation.abi.effects.errorBoundary,
      ...(operation.abi.effects.errorCarrier === undefined
        ? {}
        : { errorCarrier: operation.abi.effects.errorCarrier }),
    };
  }
  if (operation?.kind !== "source-call" || sourceCallEffects === undefined ||
    sourceCallEffects.invocation !== "infallible" ||
    sourceCallEffects.awaiting === "not-applicable") {
    return undefined;
  }
  const outputCarrier = rustFutureOutputCarrier(operation.resultCarrier);
  if (outputCarrier === undefined) {
    return undefined;
  }
  return {
    outputCarrier,
    awaitedConversion: {
      kind: "identity",
      sourceCarrier: outputCarrier,
      targetCarrier: outputCarrier,
      fallible: false,
    },
    awaiting: sourceCallEffects.awaiting,
    errorBoundary: sourceCallEffects.awaiting === "fallible" ? "source-program" : "none",
  };
}

export function rustFutureValueForSubject(
  subject: Node,
  input: {
    readonly ast: AstReader;
    readonly facts: RustPlanQueries;
    readonly sourceDeclarationFor: (reference: Node) => Node | undefined;
  },
  resolving: Set<Node> = new Set(),
): RustFutureValueFact | undefined {
  const existing = input.facts.getFact(subject, rustFutureValueFactKey);
  if (existing !== undefined || resolving.has(subject)) {
    return existing;
  }
  resolving.add(subject);
  try {
    const operation = input.facts.getFact(subject, rustTargetOperationFactKey);
    const effects = operation?.kind === "source-call"
      ? input.facts.getFact(subject, rustSourceCallEffectsFactKey)
      : undefined;
    const direct = rustFutureValueForOperation(operation, effects);
    if (direct !== undefined) {
      return direct;
    }
    const kind = input.ast.kindName(subject);
    if (kind === KindParenthesizedExpression || kind === "KindAsExpression" ||
      kind === "KindTypeAssertionExpression") {
      const operand = Node_Expression(input.ast, subject);
      return operand === undefined
        ? undefined
        : rustFutureValueForSubject(operand, input, resolving);
    }
    if (kind === KindVariableDeclaration) {
      const initializer = Node_Initializer(input.ast, subject);
      return input.facts.getFact(subject, rustMutatedBindingFactKey) !== undefined ||
          initializer === undefined
        ? undefined
        : rustFutureValueForSubject(initializer, input, resolving);
    }
    if (kind === KindIdentifier) {
      const declaration = input.sourceDeclarationFor(subject);
      return declaration === undefined
        ? undefined
        : rustFutureValueForSubject(declaration, input, resolving);
    }
    return undefined;
  } finally {
    resolving.delete(subject);
  }
}

export function rustFutureValueMatchesCarrier(
  fact: RustFutureValueFact,
  carrier: TargetTypeRef | undefined,
): boolean {
  return carrier !== undefined &&
    ((fact.awaiting === "infallible" && fact.errorBoundary === "none") ||
      (fact.awaiting === "fallible" && fact.errorBoundary !== "none")) &&
    (fact.errorBoundary === "provider-native"
      ? fact.errorCarrier !== undefined
      : fact.errorCarrier === undefined) &&
    rustTargetTypeRefEquals(carrier, rustFutureTargetType(fact.awaitedConversion.sourceCarrier)) &&
    rustTargetTypeRefEquals(fact.awaitedConversion.targetCarrier, fact.outputCarrier);
}
