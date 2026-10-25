import type { Node } from "@tsonic/tsts";
import { KindParenthesizedExpression, Node_Expression, Node_Initializer, asSourceNode } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { RustPreparedDeferredCheckedCall } from "../../target-model/records/deferred-callbacks.js";
import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import type { RustEffectsWorkBudget } from "./effects-work-budget.js";
import { rustCallbackProtocol } from "../../policy/operations/members/callbacks.js";
import { mergeRustErrorEffects, rustCallableInvocationErrorEffects, rustErrorEffectsAreFallible, rustLocalErrorEffects,
  rustProducerInvocationErrorEffects, rustPureErrorEffects } from "./error-effects.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustFrameCallableEnvironmentBindings } from "../callables/frame-values.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

interface CallbackValueAnalysis {
  readonly fallible: boolean;
  readonly implementationFallible: boolean;
  readonly implementationEffects: RustErrorEffectsFact;
  readonly invocationEffects: RustErrorEffectsFact;
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
  const producerContext = { producers: walk.context.callableValues.nativeProducers,
    definitions: walk.context.typeDefinitions, promiseBodies: walk.context.promiseBodies.plan,
    records: { ...walk.context.records, errorEffects: {
      get(subject: import("@tsonic/tsts").ExtensionFactSubject | undefined) {
        const node = asSourceNode(subject, ast);
        return node === undefined ? undefined : declarationEffects(node);
      },
    } } };
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
      const invocationError = rustCallableProtocol(carrier)?.error;
      let invocationEffects = invocationError === undefined ? rustPureErrorEffects : rustCallableInvocationErrorEffects(invocationError);
      const frame = carrier === undefined ? undefined : rustFrameCallableValue(carrier);
      if (frame !== undefined && carrier !== undefined) {
        const frames = walk.context.callableValues.frames;
        const definition = frames.definitionFor(carrier);
        const entry = frames.entryFor(carrier);
        const bindings = definition === undefined || entry === undefined ? undefined
          : rustFrameCallableEnvironmentBindings(definition, entry, frame.environment);
        if (entry === undefined || bindings === undefined) failTargetAnalysisInvariant("tsonic-rust",
          "A frame callback requires its original entry and exact environment correspondence.", value);
        const selected: RustErrorEffectsFact[] = [];
        for (const implementation of entry.implementations) {
          budget.step();
          const effects = rustProducerInvocationErrorEffects(implementation.declaration, producerContext);
          if (effects === undefined) failTargetAnalysisInvariant("tsonic-rust",
            "A frame callback requires its original producer invocation effects.", implementation.declaration);
          selected.push({ localErrors: effects.localErrors,
            nativeErrors: effects.nativeErrors.map(error => ({ ...error,
              errorType: substituteRustTargetGenerics(error.errorType, bindings, new Map()) })) });
        }
        const selectedEffects = mergeRustErrorEffects(selected);
        if (selectedEffects === undefined) return undefined;
        invocationEffects = selectedEffects;
      }
      const invocationFallible = frame !== undefined || invocationError !== undefined
        ? rustErrorEffectsAreFallible(invocationEffects) : rustCallbackProtocol(carrier)?.fallible === true;
      budget.metadata(invocationEffects);
      const body = ast.body(value);
      if (body !== undefined) {
        const implementationEffects = expressionRegionEffects(body);
        if (implementationEffects === undefined) return undefined;
        const implementationFallible = rustErrorEffectsAreFallible(implementationEffects);
        return {
          fallible: invocationFallible || implementationFallible,
          implementationFallible,
          implementationEffects,
          invocationEffects,
          subjects: [value],
        };
      }
      const declaration = walk.context.source.navigation.sourceReferenceFor(value)?.declaration;
      if (declaration === undefined) {
        return undefined;
      }
      if (isFallible(declaration)) {
        return { fallible: true, implementationFallible: true, implementationEffects: declarationEffects(declaration), invocationEffects, subjects: [value, declaration] };
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
          invocationEffects,
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
            invocationEffects,
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
      callback.invocationEffects,
      callback.implementationEffects,
    ]);
  };
  return Object.freeze({ callbackExpression, callbackValueExpression, callbackValueAnalysis, preparedCallbackOperationEffects });
}
