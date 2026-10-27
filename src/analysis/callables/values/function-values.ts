import type { RustSourceParameterAbiFact } from "../../../target-model/records/callables/callables-and-resources.js";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../../program/walk.js";
import { KindNonNullExpression, KindParenthesizedExpression, KindSatisfiesExpression, KindVariableDeclaration, Node_Expression, Node_Initializer } from "@tsonic/target-api/source";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCallableTargetType, rustCallableProtocol, rustCallableInputProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustGenericCallableTargetType, rustNativeFutureCallableResult } from "../../../target-model/types/carriers/generic-callables.js";
import { rustCallableOrigin } from "../../../policy/types/callables/callable-origins.js";
import { resolveRustCallableEnvironment, bindRustCallableEnvironment } from "../../source-evidence/types/resolution/callable-environments.js";
import { rustTypeParameterFromSourceContract } from "../../../target-model/types/carriers/generic-references.js";
import { rustHigherRankedNativeFunctionCarrier } from "../generics/higher-ranked-function.js";
import { rustResolutionContext } from "../../program/walk.js";
import { resolveRustCallableStorageCarrier } from "../../source-evidence/types/resolution/source-evidence.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";

export function rustSourceClosureValueCarrier(
  walk: RustFactWalk, declaration: Node, selected: TargetTypeRef, captures?: readonly TargetTypeRef[],
): TargetTypeRef | undefined {
  if (walk.context.ast.body(declaration) === undefined ||
    walk.context.callableOwnership.failureReason() !== undefined) return undefined;
  const lexical = walk.context.retainedEnvironments.lexicalFor(declaration);
  if (lexical.kind === "unresolved") return undefined;
  const context = rustResolutionContext(walk, declaration, "value");
  const protocol = rustCallableProtocol(selected);
  const construction = rustCallableInputProtocol(selected) === undefined ? selected : protocol === undefined ? undefined
    : rustCallableTargetType(protocol.parameters, protocol.result, undefined, protocol.error);
  const storage = resolveRustCallableStorageCarrier(construction, { ...context, callableRepresentation: "construction" },
    walk.operationOptions, new Set());
  const stored = rustCallableProtocol(storage);
  if (storage === undefined || rustFrameCallableValue(storage) !== undefined) return storage;
  // A recursive closure reads its own unwritten binding through its recursion slot, not its environment (as captures do).
  const self = rustCallableExpressionValueDeclaration(declaration, walk.context.ast);
  const excluded = self !== undefined && !walk.context.source.navigation.declarationUseSummary(self).bindingWritten ? new Set([self]) : new Set<Node>();
  const environment = captures ?? resolveRustCallableEnvironment(declaration, context, walk.operationOptions, new Set(), excluded);
  if (environment === undefined) return undefined;
  if (stored?.lifetime === undefined) return storage;
  const lifetime = walk.operationOptions.callableValueLifetime(declaration, environment, "construction");
  return lifetime === undefined ? undefined : rustCallableTargetType(stored.parameters, stored.result, lifetime, stored.error);
}

export function rustSourceFunctionValueCarrier(
  walk: RustFactWalk, declaration: Node, parameters: readonly RustSourceParameterAbiFact[], result: TargetTypeRef,
): TargetTypeRef | undefined {
  const contract = walk.context.sourceLifetimes.contractFor(declaration);
  const quantified = contract?.parameters.filter(parameter => parameter.kind === "type") ?? [];
  if (quantified.length !== 0 || rustNativeFutureCallableResult(result) !== undefined) {
    const context = rustResolutionContext(walk, declaration);
    const origin = rustCallableOrigin(walk.context.ast, declaration);
    const environment = resolveRustCallableEnvironment(declaration, context, walk.operationOptions, new Set());
    return origin === undefined || environment === undefined ? undefined : bindRustCallableEnvironment(
      rustGenericCallableTargetType(quantified.map(rustTypeParameterFromSourceContract),
        parameters.map(parameter => parameter.parameterCarrier), result, origin, environment), context);
  }
  const quantifiedCarrier = rustHigherRankedNativeFunctionCarrier(walk, declaration, parameters, result);
  if (quantifiedCarrier !== undefined) return quantifiedCarrier;
  const context = rustResolutionContext(walk, declaration);
  const environment = resolveRustCallableEnvironment(declaration, context, walk.operationOptions, new Set());
  const lifetime = environment === undefined ? undefined : walk.operationOptions.callableValueLifetime(declaration, environment, "construction");
  return lifetime === undefined ? undefined
    : rustCallableTargetType(parameters.map(parameter => parameter.parameterCarrier), result, lifetime);
}

// The variable a callable expression initializes (through parentheses and type assertions): its self binding.
export function rustCallableExpressionValueDeclaration(
  expression: Node,
  ast: RustFactWalk["context"]["ast"],
): Node | undefined {
  let current = expression;
  let parent = ast.parent(current);
  while (parent !== undefined) {
    const kind = ast.kindName(parent);
    if (kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
      kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
      kind !== "KindTypeAssertionExpression") {
      break;
    }
    if (Node_Expression(ast, parent) !== current) {
      return undefined;
    }
    current = parent;
    parent = ast.parent(current);
  }
  return parent !== undefined && ast.kindName(parent) === KindVariableDeclaration &&
      Node_Initializer(ast, parent) === current
    ? parent
    : undefined;
}
