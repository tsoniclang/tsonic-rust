import {
  inferRustTargetGenericBindings,
  inferRustTargetTypeParameterBindings,
  isRustNumericCarrier,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustJsArrayLikeElementTargetType,
  rustFixedArrayCarrierValue,
  rustTargetGenericBindingsForArguments,
  rustTargetGenericReferences,
  substituteRustTargetGenerics,
} from "../../target-model/types/index.js";
import {
  KindArrayLiteralExpression,
  KindObjectLiteralExpression,
  KindParenthesizedExpression,
  KindSatisfiesExpression,
  KindSpreadElement,
  Node_Expression,
  ObjectLiteralProperty_Value,
  asSourceNode,
} from "@tsonic/target-api/source";
import { rustOperationContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isUnannotatedRustNumericLiteral, selectedSourceLiteralIsRepresentable } from "../../policy/types/selected-numeric-literal.js";
import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { rustSourceCallGenericLifetimeArguments } from "../facts/source-call-lifetimes.js";
import { selectRustIndexedCallKeys } from "./indexed-call-keys.js";
import { rustIndexedFieldKeyArgument } from "../facts/indexed-field-keys.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustOptionalStorageValue, rustSourceOptionalTargetType } from "../../target-model/types/projections.js";
import { resolveParameterAbi } from "../declarations/types-and-bindings.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
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
  if (!selectRustIndexedCallKeys(walk, selected, callArguments, finalized)) return undefined;
  const initialSubstitutions = rustTargetGenericBindingsForArguments(
    parameters,
    finalized,
  );
  if (initialSubstitutions === undefined) return undefined;
  const typeParameterNames = new Set(parameters.flatMap((parameter) =>
    parameter.kind === "type" ? [parameter.targetIdentity] : []));
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
    const target = inferred.get(parameter.targetIdentity);
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
        const contextualTarget = contextual.get(parameter.targetIdentity);
        if (contextualTarget === undefined ||
          rustTargetTypeRefEquals(selectedTarget.type, contextualTarget)) {
          continue;
        }
        const argumentTarget = inferred.get(parameter.targetIdentity);
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
            parameter.targetIdentity,
            callArguments,
            contextualTarget,
          )) {
          continue;
        }
        finalized[index] = Object.freeze({ kind: "type", type: contextualTarget });
      }
    }
  }
  const finalizedArguments = rustSourceCallGenericLifetimeArguments(selected, finalized, callArguments.map(argument =>
    walk.context.facts.getRuntimeCarrierFact(argument)?.carrier ?? resolveProjectSourceInferenceCarrier(walk, argument)));
  const substitutions = finalizedArguments === undefined ? undefined : rustTargetGenericBindingsForArguments(parameters, finalizedArguments);
  return substitutions === undefined
    ? undefined
    : Object.freeze({
        targetGenericArguments: finalizedArguments!,
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
    if (isUnannotatedRustNumericLiteral(argument, walk.context.ast)) continue;
    const matches = bindings.filter((binding) =>
      binding.sourceArgumentIndex === argumentIndex);
    const actual = walk.context.facts.getFact(argument, rustIndexedFieldKeyArgument)?.carrier ??
      walk.context.facts.getRuntimeCarrierFact(argument)?.carrier ??
      resolveProjectSourceInferenceCarrier(walk, argument);
    if (matches.length === 0) continue;
    for (const binding of matches) {
      const parameter = selected.member.parameters[binding.sourceParameterIndex];
      const sourceParameter = selected.sourceSelectedSignatureParameters?.find(selectedParameter =>
        selectedParameter.parameterIndex === binding.sourceParameterIndex);
      const declaration = asSourceNode(sourceParameter?.parameterDeclaration, walk.context.ast);
      const abi = declaration === undefined ? undefined : resolveParameterAbi(walk, declaration);
      if (abi === undefined) return undefined;
      const valueCarrier = abi.form === "optional" || abi.form === "default" ? parameter?.type : abi.valueCarrier;
      const parameterCarrier = parameter === undefined || valueCarrier === undefined
        ? undefined
        : binding.sourceParameterForm === "rest-element"
          ? valueCarrier.kind === "array" ? valueCarrier.element : rustJsArrayLikeElementTargetType(valueCarrier)
          : valueCarrier;
      const instantiatedParameterCarrier = parameterCarrier === undefined
        ? undefined
        : mapRustTargetTypes(substituteRustTargetGenerics(
            parameterCarrier,
            new Map(),
            initialSubstitutions.lifetimes,
            initialSubstitutions.consts,
          ), carrier => {
            const value = rustOptionalStorageValue(carrier);
            if (value === undefined) return carrier;
            const selected = substituteRustTargetGenerics(value, initialSubstitutions.types,
              initialSubstitutions.lifetimes, initialSubstitutions.consts);
            return rustTargetTypeRefEquals(selected, rustSourceOptionalTargetType(selected))
              ? value : rustOptionTargetType(value);
          });
      const actualCarrier = actual === undefined ? undefined : binding.sourceForm === "spread-element"
        ? binding.spreadElementIndex === undefined
          ? undefined
          : rustSpreadElementCarrier(actual, binding.spreadElementIndex)
        : actual;
      if (instantiatedParameterCarrier === undefined) {
        continue;
      }
      const pairs = projectSourceArgumentInferencePairs(walk, argument, instantiatedParameterCarrier, actualCarrier);
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
            typeIdentities: parameterNames,
            lifetimeIdentities: new Set(callScopedElisions.keys()),
            constIdentities: new Set(),
          },
          { callScopedElisionBindings: callScopedElisions },
        );
        if (candidate === undefined) continue;
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

function projectSourceArgumentInferencePairs(
  walk: RustFactWalk,
  argument: Node,
  pattern: TargetTypeRef,
  actualCarrier?: TargetTypeRef,
): readonly { readonly pattern: TargetTypeRef; readonly actual: TargetTypeRef }[] | undefined {
  const { ast } = walk.context;
  if (isUnannotatedRustNumericLiteral(argument, ast)) return [];
  if (ast.kindName(argument) === KindParenthesizedExpression || ast.kindName(argument) === KindSatisfiesExpression) {
    const inner = Node_Expression(ast, argument);
    return inner === undefined ? undefined : projectSourceArgumentInferencePairs(walk, inner, pattern);
  }
  if (ast.kindName(argument) === KindArrayLiteralExpression) {
    const element = rustJsArrayLikeElementTargetType(pattern) ?? rustFixedArrayCarrierValue(pattern)?.element ??
      (pattern.kind === "array" ? pattern.element : undefined);
    const pairs: { readonly pattern: TargetTypeRef; readonly actual: TargetTypeRef }[] = [];
    for (const [index, expression] of ast.elements(argument).entries()) {
      const selected = pattern.kind === "tuple" ? pattern.elements[index] : element;
      if (expression === undefined || selected === undefined) return undefined;
      const spread = ast.kindName(expression) === KindSpreadElement;
      const value = spread ? Node_Expression(ast, expression) : expression;
      if (value === undefined || spread && element === undefined) return undefined;
      const children = projectSourceArgumentInferencePairs(walk, value, spread ? pattern : selected);
      if (children === undefined) return undefined;
      pairs.push(...children);
    }
    return pairs;
  }
  if (ast.kindName(argument) !== KindObjectLiteralExpression) {
    const actual = actualCarrier ?? resolveProjectSourceInferenceCarrier(walk, argument);
    return actual === undefined ? undefined : [{ pattern, actual }];
  }
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
  if (walk.context.projectTypes.definitionForCarrier(carrier) !== undefined) {
    const pairs: { readonly pattern: TargetTypeRef; readonly actual: TargetTypeRef }[] = [];
    for (const element of elements) {
      const selected = element!.selected.sourceSelectedDeclarations.map(declaration => {
        const declared = resolveRustTargetTypeRef(declaration, rustOperationContext(walk, declaration), walk.operationOptions);
        return declared === undefined ? undefined : walk.context.projectTypes.instantiateMemberCarrier(declaration, carrier, declared);
      });
      const field = selected[0];
      if (field === undefined || selected.some(candidate => !rustTargetTypeRefEquals(candidate, field))) return undefined;
      const children = projectSourceArgumentInferencePairs(walk, element!.initializer, field);
      if (children === undefined) return undefined;
      pairs.push(...children);
    }
    return pairs;
  }
  const matches = shapes.flatMap(shape => {
    if (shape === undefined) return [];
    const fields = elements.map(element => shape.fields.filter(field =>
      field.declarations.some(declaration => element!.selected.sourceSelectedDeclarations.includes(declaration))));
    if (fields.some(field => field.length !== 1) || new Set(fields.map(field => field[0])).size !== fields.length) return [];
    return [fields.map((field, index) => ({ field: field[0]!, initializer: elements[index]!.initializer }))];
  });
  if (matches.length !== 1) return undefined;
  const pairs: { readonly pattern: TargetTypeRef; readonly actual: TargetTypeRef }[] = [];
  for (const { field, initializer } of matches[0]!) {
    const children = projectSourceArgumentInferencePairs(walk, initializer, field.resultCarrier);
    if (children === undefined) return undefined;
    pairs.push(...children);
  }
  return pairs;
}

function resolveProjectSourceInferenceCarrier(
  walk: RustFactWalk,
  argument: Node,
): TargetTypeRef | undefined {
  const kind = walk.context.ast.kindName(argument);
  if (walk.context.ast.is.IsArrowFunction(argument) || walk.context.ast.is.IsFunctionExpression(argument)) {
    const sourceFile = walk.context.ast.getSourceFile(argument);
    return sourceFile === undefined ? undefined : resolveExpressionCarrier(walk, argument, sourceFile, undefined);
  }
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
  if (kind === KindArrayLiteralExpression || kind === KindObjectLiteralExpression) {
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
  typeParameterIdentity: string,
  callArguments: readonly Node[],
  target: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>,
): boolean {
  let proven = false;
  for (let index = 0; index < member.parameters.length; index += 1) {
    const parameter = member.parameters[index];
    if (parameter?.type.kind !== "type-parameter" ||
      parameter.type.identity !== typeParameterIdentity) {
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
