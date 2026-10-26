import type { Node } from "@tsonic/tsts";
import { KindParenthesizedExpression, Node_Expression, Node_Initializer, asSourceNode } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { RustPreparedDeferredCheckedCall } from "../../target-model/records/deferred-callbacks.js";
import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import type { RustEffectsWorkBudget } from "./effects-work-budget.js";
import { mergeRustErrorEffects, rustCallableInvocationErrorEffects, rustLocalErrorEffects,
  rustProducerInvocationErrorEffects, rustPureErrorEffects } from "./error-effects.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustFrameCallableEnvironmentBindings } from "../callables/frame-values.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { callbackFallibleTemplate } from "../../policy/operations/members/deferred-callbacks.js";

interface CallbackValueAnalysis {
  readonly invocationOwner: Node;
  readonly implementationEffects: RustErrorEffectsFact;
  readonly invocationEffects: RustErrorEffectsFact;
  readonly subjects: readonly Node[];
}

export function rustPreparedCallbackResultEffects(
  prepared: RustPreparedDeferredCheckedCall,
  invocationEffects: RustErrorEffectsFact,
): RustErrorEffectsFact | undefined {
  const failure = prepared.callback.failure;
  if (failure.kind === "returned-future") return prepared.template.isFallible ? rustLocalErrorEffects : rustPureErrorEffects;
  if (prepared.template.isFallible && prepared.template.errorBoundary === "provider-native" &&
    prepared.template.errorCarrier === undefined) return undefined;
  const selected = callbackFallibleTemplate(prepared, { invocationEffects });
  if (!selected.isFallible) return rustPureErrorEffects;
  if (selected.errorBoundary === "provider-native") return selected.errorCarrier === undefined
    ? undefined : rustCallableInvocationErrorEffects(selected.errorCarrier);
  if (selected.errorBoundary === "target-runtime") return rustLocalErrorEffects;
  return invocationEffects;
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
      budget.metadata(invocationEffects);
      const selectedInvocationEffects = (declaration: Node, implementation: RustErrorEffectsFact): RustErrorEffectsFact => {
        if (frame !== undefined || invocationError !== undefined) return invocationEffects;
        const producer = producerContext.producers.forDeclaration(declaration);
        if (producer !== undefined) {
          const selected = rustProducerInvocationErrorEffects(declaration, producerContext);
          if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust",
            "A source callback requires its exact original producer invocation effects.", declaration);
          budget.metadata(selected);
          return selected;
        }
        return walk.context.records.asyncFunction.get(declaration) !== undefined || walk.context.records.generator.get(declaration) !== undefined
          ? rustPureErrorEffects : implementation;
      };
      const body = ast.body(value);
      if (body !== undefined) {
        const implementationEffects = expressionRegionEffects(body);
        if (implementationEffects === undefined) return undefined;
        return {
          invocationOwner: value,
          implementationEffects,
          invocationEffects: selectedInvocationEffects(value, implementationEffects),
          subjects: [value],
        };
      }
      const declaration = walk.context.source.navigation.sourceReferenceFor(value)?.declaration;
      if (declaration === undefined) {
        return undefined;
      }
      if (isFallible(declaration)) {
        const implementationEffects = declarationEffects(declaration);
        return { invocationOwner: declaration, implementationEffects,
          invocationEffects: selectedInvocationEffects(declaration, implementationEffects), subjects: [value, declaration] };
      }
      const declarationBody = ast.body(declaration);
      if (declarationBody !== undefined) {
        const implementationEffects = expressionRegionEffects(declarationBody);
        if (implementationEffects === undefined) return undefined;
        return {
          invocationOwner: declaration,
          implementationEffects,
          invocationEffects: selectedInvocationEffects(declaration, implementationEffects),
          subjects: [value, declaration],
        };
      }
      const initialized = callbackValueAnalysis(Node_Initializer(ast, declaration), resolving);
      return initialized === undefined
        ? undefined
        : {
            invocationOwner: invocationError === undefined && frame === undefined ? initialized.invocationOwner : declaration,
            implementationEffects: initialized.implementationEffects,
            invocationEffects: invocationError === undefined && frame === undefined ? initialized.invocationEffects : invocationEffects,
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
    return callback === undefined ? undefined : rustPreparedCallbackResultEffects(pending.prepared, callback.invocationEffects);
  };
  return Object.freeze({ callbackExpression, callbackValueExpression, callbackValueAnalysis, preparedCallbackOperationEffects });
}
