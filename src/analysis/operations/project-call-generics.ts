import {
  inferRustTargetGenericSubstitutions,
  isRustNumericCarrier,
  rustGenericParameterIdentityKey,
  rustGenericSubstitutionsForArguments,
} from "../../target-model/types/index.js";
import { rustSemanticIdentityKey } from "../../target-model/semantics/index.js";
import {
  KindBinaryExpression,
  KindCallExpression,
  KindElementAccessExpression,
  KindIdentifier,
  KindNewExpression,
  KindNonNullExpression,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindSatisfiesExpression,
} from "@tsonic/target-api/source";
import { rustOperationContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectedSourceLiteralIsRepresentable } from "../../policy/types/selected-numeric-literal.js";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type {
  RustSelectedTargetSignature,
  RustTargetMember,
  TargetTypeRef,
} from "../../target-model/types/model.js";
import type { RustGenericArgument } from "../../target-model/semantics/index.js";
import type { RustGenericSubstitutions } from "../../target-model/types/index.js";

export interface FinalizedProjectSourceGenericArguments {
  readonly targetGenericArguments: readonly RustGenericArgument[];
  readonly substitutions: RustGenericSubstitutions;
}

export function finalizeProjectSourceGenericArguments(
  walk: RustFactWalk,
  selected: RustSelectedTargetSignature,
  callArguments: readonly Node[],
  expected: TargetTypeRef | undefined,
): FinalizedProjectSourceGenericArguments | undefined {
  const sourceArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const parameters = selected.member.generics.parameters;
  const selectedTargets = selected.targetGenericArguments ?? [];
  if (sourceArguments.length !== parameters.length || parameters.length !== selectedTargets.length) {
    return undefined;
  }
  const parameterKeys = parameters.map(rustGenericParameterIdentityKey);
  if (parameterKeys.some((key) => key === undefined) || parameters.some((parameter, index) =>
    selectedTargets[index]?.kind !== parameter.kind)) {
    return undefined;
  }
  const finalized = [...selectedTargets];
  const typeParameterKeys = new Set(parameters.flatMap((parameter, index) =>
    parameter.kind === "type" ? [parameterKeys[index]!] : []));
  const inferred = reconcileProjectSourceArgumentTypeParameters(
    walk,
    selected,
    callArguments,
    typeParameterKeys,
  );
  if (inferred === undefined) {
    return undefined;
  }
  for (let index = 0; index < sourceArguments.length; index += 1) {
    const source = sourceArguments[index]!;
    const parameter = parameters[index]!;
    const target = inferred.get(parameterKeys[index]!);
    if (parameter.kind === "type" && target !== undefined && source.explicitTypeNode === undefined) {
      finalized[index] = Object.freeze({ kind: "type", value: target });
    }
  }
  if (expected !== undefined && selected.member.returnType !== undefined) {
    const contextual = inferRustTargetGenericSubstitutions(
      selected.member.returnType,
      expected,
      {
        lifetimes: new Set(),
        types: typeParameterKeys,
        consts: new Set(),
        associatedTypes: new Set(),
      },
    )?.types;
    if (contextual !== undefined) {
      for (let index = 0; index < sourceArguments.length; index += 1) {
        const source = sourceArguments[index]!;
        const parameter = parameters[index]!;
        const selectedTarget = finalized[index];
        if (parameter.kind !== "type" || selectedTarget?.kind !== "type") continue;
        const key = parameterKeys[index]!;
        const contextualTarget = contextual.get(key);
        if (contextualTarget === undefined || rustTargetTypeRefEquals(selectedTarget.value, contextualTarget)) {
          continue;
        }
        const argumentTarget = inferred.get(key);
        if (argumentTarget !== undefined && !rustTargetTypeRefEquals(argumentTarget, contextualTarget)) {
          continue;
        }
        if (source.explicitTypeNode !== undefined || !isRustNumericCarrier(selectedTarget.value) ||
          contextualTarget.kind !== "source-primitive" || !isRustNumericCarrier(contextualTarget) ||
          !projectSourceTypeArgumentHasLiteralProof(
            walk,
            selected.member,
            key,
            callArguments,
            contextualTarget,
          )) {
          continue;
        }
        finalized[index] = Object.freeze({ kind: "type", value: contextualTarget });
      }
    }
  }
  const substitutions = rustGenericSubstitutionsForArguments(
    selected.member.generics,
    finalized,
  );
  if (substitutions === undefined) return undefined;
  return Object.freeze({
    targetGenericArguments: Object.freeze(finalized),
    substitutions,
  });
}

function reconcileProjectSourceArgumentTypeParameters(
  walk: RustFactWalk,
  selected: RustSelectedTargetSignature,
  callArguments: readonly Node[],
  parameterIdentityKeys: ReadonlySet<string>,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  const reconciled = new Map<string, TargetTypeRef>();
  const bindings = selected.sourceArgumentBindings;
  if (bindings === undefined) {
    return reconciled;
  }
  for (const [argumentIndex, argument] of callArguments.entries()) {
    if (walk.context.ast.kindName(argument) === KindNumericLiteral) {
      continue;
    }
    const matches = bindings.filter((binding) =>
      binding.sourceArgumentIndex === argumentIndex);
    const first = matches[0];
    if (first === undefined || matches.some((binding) =>
      binding.sourceParameterIndex !== first.sourceParameterIndex ||
      binding.sourceForm !== first.sourceForm)) {
      return undefined;
    }
    const parameter = selected.member.parameters[first.sourceParameterIndex];
    const actual = walk.context.facts.getRuntimeCarrierFact(argument)?.carrier ??
      resolveProjectSourceInferenceCarrier(walk, argument);
    if (parameter === undefined || actual === undefined) {
      continue;
    }
    const candidate = inferRustTargetGenericSubstitutions(
      parameter.type,
      actual,
      {
        lifetimes: new Set(),
        types: parameterIdentityKeys,
        consts: new Set(),
        associatedTypes: new Set(),
      },
    )?.types;
    if (candidate === undefined) {
      continue;
    }
    for (const [name, carrier] of candidate) {
      const existing = reconciled.get(name);
      if (existing !== undefined && !rustTargetTypeRefEquals(existing, carrier)) {
        return undefined;
      }
      reconciled.set(name, carrier);
    }
  }
  return reconciled;
}

function resolveProjectSourceInferenceCarrier(
  walk: RustFactWalk,
  argument: Node,
): TargetTypeRef | undefined {
  const kind = walk.context.ast.kindName(argument);
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
  typeParameterIdentityKey: string,
  callArguments: readonly Node[],
  target: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>,
): boolean {
  let proven = false;
  for (let index = 0; index < member.parameters.length; index += 1) {
    const parameter = member.parameters[index];
    if (parameter?.type.kind !== "type-parameter" ||
      rustSemanticIdentityKey(parameter.type.identity) !== typeParameterIdentityKey) {
      continue;
    }
    const argument = callArguments[index];
    if (argument === undefined) {
      return false;
    }
    if (!selectedSourceLiteralIsRepresentable(argument, target.name, walk.context.ast)) {
      return false;
    }
    proven = true;
  }
  return proven;
}
