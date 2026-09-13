import {
  inferRustTargetGenericBindings,
  inferRustTargetTypeParameterBindings,
  isRustNumericCarrier,
  rustOptionElementCarrier,
  rustTargetGenericBindingsForArguments,
  rustTargetGenericReferences,
  substituteRustTargetGenerics,
} from "../../target-model/types/index.js";
import {
  KindBinaryExpression,
  KindCallExpression,
  KindElementAccessExpression,
  KindIdentifier,
  KindNewExpression,
  KindNonNullExpression,
  KindNumericLiteral,
  KindObjectLiteralExpression,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindSatisfiesExpression,
  KindSpreadElement,
  Node_Expression,
  ObjectLiteralProperty_Value,
} from "@tsonic/target-api/source";
import { rustOperationContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectedSourceLiteralIsRepresentable } from "../../policy/types/selected-numeric-literal.js";
import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import { rustLifetimeKey, rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type {
  RustTargetGenericBindings,
} from "../../target-model/types/index.js";
import type {
  RustSelectedTargetSignature,
  RustTargetGenericArgument,
  RustTargetMember,
  TargetTypeRef,
} from "../../target-model/types/model.js";

export interface FinalizedProjectSourceGenericArguments {
  readonly targetGenericArguments: readonly RustTargetGenericArgument[];
  readonly substitutions: RustTargetGenericBindings;
}

export function finalizeProjectSourceGenericArguments(
  walk: RustFactWalk,
  selected: RustSelectedTargetSignature,
  callArguments: readonly Node[],
  expected: TargetTypeRef | undefined,
): FinalizedProjectSourceGenericArguments | undefined {
  const sourceArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const parameters = selected.member.genericParameters ?? [];
  const selectedTargets = selected.targetGenericArguments ?? [];
  if (sourceArguments.length !== parameters.length ||
    parameters.length !== selectedTargets.length ||
    parameters.some((parameter, index) =>
      parameter.kind !== selectedTargets[index]?.kind ||
      parameter.sourceName !== sourceArguments[index]?.typeParameterName)) {
    return undefined;
  }
  const finalized = [...selectedTargets];
  const initialSubstitutions = rustTargetGenericBindingsForArguments(
    parameters,
    finalized,
  );
  if (initialSubstitutions === undefined) return undefined;
  const typeParameterNames = new Set(parameters.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.sourceName] : []));
  const inferred = reconcileProjectSourceArgumentTypeParameters(
    walk,
    selected,
    callArguments,
    typeParameterNames,
    initialSubstitutions,
  );
  if (inferred === undefined) return undefined;
  for (let index = 0; index < sourceArguments.length; index += 1) {
    const source = sourceArguments[index]!;
    const parameter = parameters[index]!;
    const target = inferred.get(parameter.sourceName);
    if (parameter.kind === "type" && target !== undefined &&
      source.explicitTypeNode === undefined) {
      finalized[index] = Object.freeze({ kind: "type", type: target });
    }
  }
  if (expected !== undefined && selected.member.returnType !== undefined) {
    const contextual = inferRustTargetTypeParameterBindings(
      selected.member.returnType,
      expected,
      typeParameterNames,
    );
    if (contextual !== undefined) {
      for (let index = 0; index < sourceArguments.length; index += 1) {
        const source = sourceArguments[index]!;
        const parameter = parameters[index]!;
        const selectedTarget = finalized[index];
        if (parameter.kind !== "type" || selectedTarget?.kind !== "type") continue;
        const contextualTarget = contextual.get(parameter.sourceName);
        if (contextualTarget === undefined ||
          rustTargetTypeRefEquals(selectedTarget.type, contextualTarget)) {
          continue;
        }
        const argumentTarget = inferred.get(parameter.sourceName);
        if (argumentTarget !== undefined &&
          !rustTargetTypeRefEquals(argumentTarget, contextualTarget)) {
          continue;
        }
        if (source.explicitTypeNode !== undefined ||
          !isRustNumericCarrier(selectedTarget.type) ||
          contextualTarget.kind !== "source-primitive" ||
          !isRustNumericCarrier(contextualTarget) ||
          !projectSourceTypeArgumentHasLiteralProof(
            walk,
            selected.member,
            parameter.sourceName,
            callArguments,
            contextualTarget,
          )) {
          continue;
        }
        finalized[index] = Object.freeze({ kind: "type", type: contextualTarget });
      }
    }
  }
  const substitutions = rustTargetGenericBindingsForArguments(parameters, finalized);
  return substitutions === undefined
    ? undefined
    : Object.freeze({
        targetGenericArguments: Object.freeze(finalized),
        substitutions,
      });
}

function reconcileProjectSourceArgumentTypeParameters(
  walk: RustFactWalk,
  selected: RustSelectedTargetSignature,
  callArguments: readonly Node[],
  parameterNames: ReadonlySet<string>,
  initialSubstitutions: RustTargetGenericBindings,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  const reconciled = new Map<string, TargetTypeRef>();
  if (parameterNames.size === 0) return reconciled;
  const bindings = selected.sourceArgumentBindings;
  if (bindings === undefined) return reconciled;
  for (const [argumentIndex, argument] of callArguments.entries()) {
    if (walk.context.ast.kindName(argument) === KindNumericLiteral) continue;
    const matches = bindings.filter((binding) =>
      binding.sourceArgumentIndex === argumentIndex);
    const actual = walk.context.facts.getRuntimeCarrierFact(argument)?.carrier ??
      resolveProjectSourceInferenceCarrier(walk, argument);
    if (matches.length === 0) continue;
    for (const binding of matches) {
      const parameter = selected.member.parameters[binding.sourceParameterIndex];
      const parameterCarrier = parameter === undefined
        ? undefined
        : binding.sourceParameterForm === "rest-element" && parameter.type.kind === "array"
          ? parameter.type.element
          : parameter.type;
      const instantiatedParameterCarrier = parameterCarrier === undefined
        ? undefined
        : substituteRustTargetGenerics(
            parameterCarrier,
            new Map(),
            initialSubstitutions.lifetimes,
            initialSubstitutions.consts,
          );
      const actualCarrier = actual === undefined ? undefined : binding.sourceForm === "spread-element"
        ? binding.spreadElementIndex === undefined
          ? undefined
          : rustSpreadElementCarrier(actual, binding.spreadElementIndex)
        : actual;
      if (instantiatedParameterCarrier === undefined) {
        continue;
      }
      const pairs = walk.context.ast.kindName(argument) === KindObjectLiteralExpression
        ? projectSourceObjectInferencePairs(walk, argument, instantiatedParameterCarrier)
        : actualCarrier === undefined ? undefined : [{ pattern: instantiatedParameterCarrier, actual: actualCarrier }];
      if (pairs === undefined) continue;
      for (const pair of pairs) {
        const references = rustTargetGenericReferences(pair.pattern);
        const callScopedElisions = new Map(references.callScopedElisions.map((lifetime) => [
          rustLifetimeKey(lifetime),
          lifetime,
        ]));
        const candidate = inferRustTargetGenericBindings(
          pair.pattern,
          pair.actual,
          {
            typeNames: parameterNames,
            lifetimeIdentities: new Set(callScopedElisions.keys()),
            constIdentities: new Set(),
          },
          { callScopedElisionBindings: callScopedElisions },
        );
        if (candidate === undefined || candidate.lifetimes.size !== callScopedElisions.size ||
          [...callScopedElisions].some(([identity, lifetime]) =>
            !rustLifetimesEqual(candidate.lifetimes.get(identity), lifetime))) {
          continue;
        }
        for (const [name, carrier] of candidate.types) {
          const existing = reconciled.get(name);
          if (existing !== undefined && !rustTargetTypeRefEquals(existing, carrier)) {
            return undefined;
          }
          reconciled.set(name, carrier);
        }
      }
    }
  }
  return reconciled;
}

function projectSourceObjectInferencePairs(
  walk: RustFactWalk,
  argument: Node,
  pattern: TargetTypeRef,
): readonly { readonly pattern: TargetTypeRef; readonly actual: TargetTypeRef }[] | undefined {
  const { ast } = walk.context;
  const sourceTypes = walk.operationOptions.sourceTypes;
  const carrier = rustOptionElementCarrier(pattern) ?? pattern;
  const union = sourceTypes.sourceUnionForCarrier(carrier);
  const shapes = union === undefined
    ? [sourceTypes.structuralObjectForCarrier(carrier)]
    : union.variants.map(variant => variant.shape);
  const elements = ast.properties(argument).map(element => {
    if (element === undefined) return undefined;
    const initializer = ObjectLiteralProperty_Value(ast, element);
    const selected = walk.context.semanticsFor(element).operations.objectLiteralElement(element);
    return initializer === undefined || selected === undefined ? undefined : { initializer, selected };
  });
  if (elements.some(element => element === undefined)) return undefined;
  const matches = shapes.flatMap(shape => {
    if (shape === undefined) return [];
    const fields = elements.map(element => shape.fields.filter(field =>
      field.declarations.some(declaration => element!.selected.sourceSelectedDeclarations.includes(declaration))));
    if (fields.some(field => field.length !== 1) || new Set(fields.map(field => field[0])).size !== fields.length) return [];
    return [fields.map((field, index) => ({ field: field[0]!, initializer: elements[index]!.initializer }))];
  });
  if (matches.length !== 1) return undefined;
  const pairs = matches[0]!.flatMap(({ field, initializer }) => {
    if (ast.kindName(initializer) === KindNumericLiteral) return [];
    const actual = resolveRustTargetTypeRef(initializer, rustOperationContext(walk, initializer), walk.operationOptions);
    return actual === undefined ? [undefined] : [{ pattern: field.resultCarrier, actual }];
  });
  return pairs.some(pair => pair === undefined) ? undefined : pairs as readonly { pattern: TargetTypeRef; actual: TargetTypeRef }[];
}

function resolveProjectSourceInferenceCarrier(
  walk: RustFactWalk,
  argument: Node,
): TargetTypeRef | undefined {
  const kind = walk.context.ast.kindName(argument);
  if (kind === KindSpreadElement) {
    const inner = Node_Expression(walk.context.ast, argument);
    return inner === undefined
      ? undefined
      : walk.context.facts.getRuntimeCarrierFact(inner)?.carrier ??
          resolveRustTargetTypeRef(
            inner,
            rustOperationContext(walk, inner),
            walk.operationOptions,
          );
  }
  if (kind !== KindIdentifier && kind !== KindCallExpression &&
    kind !== KindNewExpression && kind !== KindPropertyAccessExpression &&
    kind !== KindElementAccessExpression && kind !== KindBinaryExpression &&
    kind !== KindPrefixUnaryExpression && kind !== KindPostfixUnaryExpression &&
    kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
    kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
    kind !== "KindTypeAssertionExpression") {
    return undefined;
  }
  return resolveRustTargetTypeRef(
    argument,
    rustOperationContext(walk, argument),
    walk.operationOptions,
  );
}

function projectSourceTypeArgumentHasLiteralProof(
  walk: RustFactWalk,
  member: RustTargetMember,
  typeParameterName: string,
  callArguments: readonly Node[],
  target: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>,
): boolean {
  let proven = false;
  for (let index = 0; index < member.parameters.length; index += 1) {
    const parameter = member.parameters[index];
    if (parameter?.type.kind !== "type-parameter" ||
      parameter.type.name !== typeParameterName) {
      continue;
    }
    const argument = callArguments[index];
    if (argument === undefined ||
      !selectedSourceLiteralIsRepresentable(argument, target.name, walk.context.ast)) {
      return false;
    }
    proven = true;
  }
  return proven;
}
