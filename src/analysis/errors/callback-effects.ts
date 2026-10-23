import type { Node } from "@tsonic/tsts";
import { KindParenthesizedExpression, Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { RustPreparedDeferredCheckedCall } from "../../target-model/records/deferred-callbacks.js";
import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import type { RustEffectsWorkBudget } from "./effects-work-budget.js";
import { rustCallbackProtocol } from "../../policy/operations/members/callbacks.js";
import { mergeRustErrorEffects, rustErrorEffectsAreFallible, rustLocalErrorEffects, rustPureErrorEffects } from "./error-effects.js";

interface CallbackValueAnalysis {
  readonly fallible: boolean;
  readonly implementationFallible: boolean;
  readonly implementationEffects: RustErrorEffectsFact;
  readonly subjects: readonly Node[];
}

export function createRustCallbackEffectAnalysis(input: {
  readonly walk: RustFactWalk;
  readonly budget: RustEffectsWorkBudget;
  readonly isFallible: (declaration: Node) => boolean;
  readonly declarationEffects: (declaration: Node) => RustErrorEffectsFact;
  readonly expressionRegionEffects: (root: Node) => RustErrorEffectsFact | undefined;
}) {
  const { walk, budget, isFallible, declarationEffects, expressionRegionEffects } = input;
  const { ast } = walk.context;
  const callbackExpression = (
    pending: { readonly request: import("../../policy/model/contracts.js").RustCheckedCallSelectionInput; readonly prepared: RustPreparedDeferredCheckedCall },
  ): Node | undefined => pending.request.source.sourceArguments[
    pending.prepared.callback.sourceArgumentIndex
  ]?.expression;
  const callbackValueExpression = (expression: Node | undefined): Node | undefined => {
    let current = expression;
    while (current !== undefined && ast.kindName(current) === KindParenthesizedExpression) {
      budget.step();
      current = Node_Expression(ast, current);
    }
    return current;
  };
  const callbackValueAnalysis = (
    expression: Node | undefined,
    resolving: Set<Node>,
  ): CallbackValueAnalysis | undefined => {
    budget.step();
    const value = callbackValueExpression(expression);
    if (value === undefined || resolving.has(value)) {
      return undefined;
    }
    resolving.add(value);
    try {
      const carrier = walk.context.records.runtimeCarrier.get(value)?.carrier;
      const invocationFallible = rustCallbackProtocol(carrier)?.fallible === true;
      const body = ast.body(value);
      if (body !== undefined) {
        const implementationEffects = expressionRegionEffects(body);
        if (implementationEffects === undefined) return undefined;
        const implementationFallible = rustErrorEffectsAreFallible(implementationEffects);
        return {
          fallible: invocationFallible || implementationFallible,
          implementationFallible,
          implementationEffects,
          subjects: [value],
        };
      }
      const declaration = walk.context.source.navigation.sourceReferenceFor(value)?.declaration;
      if (declaration === undefined) {
        return undefined;
      }
      if (isFallible(declaration)) {
        return { fallible: true, implementationFallible: true, implementationEffects: declarationEffects(declaration), subjects: [value, declaration] };
      }
      const declarationBody = ast.body(declaration);
      if (declarationBody !== undefined) {
        const implementationEffects = expressionRegionEffects(declarationBody);
        if (implementationEffects === undefined) return undefined;
        const implementationFallible = rustErrorEffectsAreFallible(implementationEffects);
        return {
          fallible: invocationFallible || implementationFallible,
          implementationFallible,
          implementationEffects,
          subjects: [value, declaration],
        };
      }
      const initialized = callbackValueAnalysis(Node_Initializer(ast, declaration), resolving);
      return initialized === undefined
        ? undefined
        : {
            fallible: invocationFallible || initialized.fallible,
            implementationFallible: initialized.implementationFallible,
            implementationEffects: initialized.implementationEffects,
            subjects: [value, declaration, ...initialized.subjects],
          };
    } finally {
      resolving.delete(value);
    }
  };
  const preparedCallbackOperationEffects = (node: Node): RustErrorEffectsFact | undefined => {
    const pending = walk.preparedCallbackCalls.get(node);
    if (pending === undefined) return rustPureErrorEffects;
    const callback = callbackValueAnalysis(callbackExpression(pending), new Set());
    return callback === undefined ? undefined : mergeRustErrorEffects([
      pending.prepared.template.isFallible ? rustLocalErrorEffects : rustPureErrorEffects,
      callback.implementationEffects,
    ]);
  };
  return Object.freeze({ callbackExpression, callbackValueExpression, callbackValueAnalysis, preparedCallbackOperationEffects });
}
