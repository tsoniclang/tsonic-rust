import { inferRustTargetGenericBindings, inferRustTargetTypeParameterBindings, isRustNumericCarrier, rustOptionElementCarrier, rustJsArrayLikeElementTargetType, rustFixedArrayCarrierValue, rustTargetGenericBindingsForArguments, rustTargetGenericReferences, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { KindArrayLiteralExpression, KindObjectLiteralExpression, KindParenthesizedExpression, KindSatisfiesExpression, KindSpreadElement, Node_Expression, Node_Type, ObjectLiteralProperty_Value, asSourceNode } from "@tsonic/target-api/source";
import { rustOperationContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isUnannotatedRustNumericLiteral, selectedSourceLiteralIsRepresentable } from "../../policy/conversions/literals.js";
import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { rustSourceCallGenericLifetimeArguments } from "../callables/ownership/source-call-lifetimes.js";
import { selectRustIndexedCallKeys } from "./indexed-call-keys.js";

import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustOptionalStorageValue, rustSourceOptionalTargetType } from "../../target-model/types/projections.js";
import { resolveParameterAbi } from "../callables/values/parameter-facts.js";
import { resolveFunctionExpressionSignature } from "../callables/values/closures.js";
import { createRustCarrierProbe } from "../program/carrier-probe.js";
import { recordCallableParameterSignatureFacts } from "../callables/values/parameter-signature.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { rustCallableProtocol, rustClosureProtocol } from "../../target-model/types/carriers/callables.js";
import type { Node } from "@tsonic/tsts";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetGenericBindings } from "../../target-model/types/index.js";
import type { RustTargetGenericArgument, RustTargetMember, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetSignature } from "../../target-model/records/operations/member-selections.js";

export interface FinalizedProjectSourceGenericArguments {
  readonly targetGenericArguments: readonly RustTargetGenericArgument[];
  readonly substitutions: RustTargetGenericBindings;
}

type ProjectSourceInference<Value> =
  | { readonly kind: "complete"; readonly value: Value }
  | { readonly kind: "pending" };

interface ProjectSourceInferencePair {
  readonly pattern: TargetTypeRef;
  readonly actual: TargetTypeRef;
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
  const identitySubject = callArguments[0] ?? asSourceNode(selected.sourceDeclaration, walk.context.ast);
  // A function value's binder (analysis/callables/higher-ranked-function.ts) substitutes fresh bound lifetimes for the
  // declaration's lifetime parameters in order, so its member lifetime parameters are those binder lifetimes.
  const functionBinder = selected.sourceCallableCarrier?.kind === "function-pointer"
    ? selected.sourceCallableCarrier.lifetimeBinder : undefined;
  if (sourceArguments.length !== parameters.length || parameters.length !== selectedTargets.length ||
    parameters.some((parameter, index) => {
      const argument = sourceArguments[index];
      if (argument === undefined || identitySubject === undefined || parameter.kind !== selectedTargets[index]?.kind) return true;
      const declarations = walk.context.semanticsFor(identitySubject).declarations;
      const symbol = declarations.typeSymbol(argument.typeParameter);
      const declaration = symbol === undefined ? undefined : declarations.primarySymbolDeclaration(symbol);
      const contract = declaration === undefined ? undefined : walk.context.sourceLifetimes.parameterFor(declaration);
      if (contract === undefined || contract.kind !== parameter.kind) return true;
      const bound = functionBinder?.parameters[index]?.lifetime;
      return parameter.targetIdentity !== (contract.kind === "type" ? contract.identity
        : functionBinder !== undefined ? (bound === undefined ? undefined : rustLifetimeKey(bound)) : rustLifetimeKey(contract.lifetime));
    })) return undefined;
  const finalized = [...selectedTargets];
  if (!selectRustIndexedCallKeys(walk, selected, callArguments, finalized)) return undefined;
  const initialSubstitutions = rustTargetGenericBindingsForArguments(
    parameters,
    finalized,
  );
  if (initialSubstitutions === undefined) return undefined;
  const typeParameterNames = new Set(parameters.flatMap((parameter, index) =>
    parameter.kind === "type" && sourceArguments[index]!.explicitTypeNode === undefined
      ? [parameter.targetIdentity] : []));
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
  let pendingLifetimeInference = false;
  const finalizedArguments = rustSourceCallGenericLifetimeArguments(selected, finalized, index => {
    const argument = callArguments[index];
    if (argument === undefined) return undefined;
    const selected = resolveProjectSourceInferenceCarrier(walk, argument);
    if (selected.kind === "pending") {
      pendingLifetimeInference = true;
      return undefined;
    }
    return selected.value;
  });
  if (pendingLifetimeInference) return undefined;
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
  const contextual = (argument: Node): boolean => walk.context.ast.is.IsArrowFunction(argument) ||
    walk.context.ast.is.IsFunctionExpression(argument);
  const ordered = [...callArguments.entries()].sort((left, right) =>
    Number(contextual(left[1])) - Number(contextual(right[1])));
  for (const [argumentIndex, argument] of ordered) {
    if (isUnannotatedRustNumericLiteral(walk.context.literalValues.literalValue.get(argument))) continue;
    const matches = bindings.filter((binding) =>
      binding.sourceArgumentIndex === argumentIndex);
    if (matches.length === 0) continue;
    const indexed = walk.context.records.indexedFieldKeyArgument.get(argument)?.carrier;
    const actual = contextual(argument) ? undefined : indexed === undefined
      ? resolveProjectSourceInferenceCarrier(walk, argument) : { kind: "complete" as const, value: indexed };
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
              ? value : rustSourceOptionalTargetType(value);
          });
      if (instantiatedParameterCarrier === undefined ||
        !rustTargetGenericReferences(instantiatedParameterCarrier).typeIdentities.some(identity => parameterNames.has(identity))) {
        continue;
      }
      const selectedActual = contextual(argument)
        ? resolveProjectSourceInferenceCarrier(walk, argument, instantiatedParameterCarrier) : actual;
      if (selectedActual?.kind === "pending") return undefined;
      const actualCarrier = selectedActual?.value === undefined ? undefined : binding.sourceForm === "spread-element"
        ? binding.spreadElementIndex === undefined
          ? undefined
          : rustSpreadElementCarrier(selectedActual.value, binding.spreadElementIndex)
        : selectedActual.value;
      const pairs = projectSourceArgumentInferencePairs(walk, argument, instantiatedParameterCarrier, actualCarrier);
      if (pairs.kind === "pending") return undefined;
      if (pairs.value === undefined) continue;
      for (const pair of pairs.value) {
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
): ProjectSourceInference<readonly ProjectSourceInferencePair[] | undefined> {
  const { ast } = walk.context;
  if (isUnannotatedRustNumericLiteral(walk.context.literalValues.literalValue.get(argument))) return { kind: "complete", value: [] };
  if (ast.kindName(argument) === KindParenthesizedExpression || ast.kindName(argument) === KindSatisfiesExpression) {
    const inner = Node_Expression(ast, argument);
    return inner === undefined ? { kind: "complete", value: undefined } : projectSourceArgumentInferencePairs(walk, inner, pattern);
  }
  if (ast.is.IsArrowFunction(argument) || ast.is.IsFunctionExpression(argument)) {
    const actual = actualCarrier === undefined ? resolveProjectSourceInferenceCarrier(walk, argument, pattern)
      : { kind: "complete" as const, value: actualCarrier };
    if (actual.kind === "pending") return actual;
    const expected = rustCallableProtocol(pattern) ?? rustClosureProtocol(pattern);
    const selected = rustCallableProtocol(actual.value) ?? rustClosureProtocol(actual.value);
    const parameters = sourceCallableValueParameters(ast, argument, walk.context.semanticsFor(argument));
    if (expected === undefined || selected === undefined || expected.parameters.length !== selected.parameters.length ||
      parameters === undefined || parameters.length !== selected.parameters.length) return { kind: "complete", value: undefined };
    return { kind: "complete", value: [{ pattern: expected.result, actual: selected.result }, ...parameters.flatMap((parameter, index) =>
      Node_Type(ast, parameter) === undefined || expected.parameters[index] === undefined ? []
        : [{ pattern: expected.parameters[index]!, actual: selected.parameters[index]! }])] };
  }
  if (ast.kindName(argument) === KindArrayLiteralExpression) {
    const element = rustJsArrayLikeElementTargetType(pattern) ?? rustFixedArrayCarrierValue(pattern)?.element ??
      (pattern.kind === "array" ? pattern.element : undefined);
    const pairs: ProjectSourceInferencePair[] = [];
    for (const [index, expression] of ast.elements(argument).entries()) {
      const selected = pattern.kind === "tuple" ? pattern.elements[index] : element;
      if (expression === undefined || selected === undefined) return { kind: "complete", value: undefined };
      const spread = ast.kindName(expression) === KindSpreadElement;
      const value = spread ? Node_Expression(ast, expression) : expression;
      if (value === undefined || spread && element === undefined) return { kind: "complete", value: undefined };
      const children = projectSourceArgumentInferencePairs(walk, value, spread ? pattern : selected);
      if (children.kind === "pending" || children.value === undefined) return children;
      pairs.push(...children.value);
    }
    return { kind: "complete", value: pairs };
  }
  if (ast.kindName(argument) !== KindObjectLiteralExpression) {
    const actual = actualCarrier === undefined ? resolveProjectSourceInferenceCarrier(walk, argument)
      : { kind: "complete" as const, value: actualCarrier };
    return actual.kind === "pending" ? actual : { kind: "complete",
      value: actual.value === undefined ? undefined : [{ pattern, actual: actual.value }] };
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
  if (elements.some(element => element === undefined)) return { kind: "complete", value: undefined };
  if (walk.context.projectTypes.definitionForCarrier(carrier) !== undefined) {
    const pairs: ProjectSourceInferencePair[] = [];
    for (const element of elements) {
      const selected = element!.selected.sourceSelectedDeclarations.map(declaration => {
        const declared = resolveRustTargetTypeRef(declaration, rustOperationContext(walk, declaration), walk.operationOptions);
        return declared === undefined ? undefined : walk.context.projectTypes.instantiateMemberCarrier(declaration, carrier, declared);
      });
      const field = selected[0];
      if (field === undefined || selected.some(candidate => !rustTargetTypeRefEquals(candidate, field))) return { kind: "complete", value: undefined };
      const children = projectSourceArgumentInferencePairs(walk, element!.initializer, field);
      if (children.kind === "pending" || children.value === undefined) return children;
      pairs.push(...children.value);
    }
    return { kind: "complete", value: pairs };
  }
  const matches = shapes.flatMap(shape => {
    if (shape === undefined) return [];
    const fields = elements.map(element => shape.fields.filter(field =>
      field.declarations.some(declaration => element!.selected.sourceSelectedDeclarations.includes(declaration))));
    if (fields.some(field => field.length !== 1) || new Set(fields.map(field => field[0])).size !== fields.length) return [];
    return [fields.map((field, index) => ({ field: field[0]!, initializer: elements[index]!.initializer }))];
  });
  if (matches.length !== 1) return { kind: "complete", value: undefined };
  const pairs: ProjectSourceInferencePair[] = [];
  for (const { field, initializer } of matches[0]!) {
    const children = projectSourceArgumentInferencePairs(walk, initializer, field.resultCarrier);
    if (children.kind === "pending" || children.value === undefined) return children;
    pairs.push(...children.value);
  }
  return { kind: "complete", value: pairs };
}

function resolveProjectSourceInferenceCarrier(
  walk: RustFactWalk,
  argument: Node,
  contextualCarrier?: TargetTypeRef,
): ProjectSourceInference<TargetTypeRef | undefined> {
  const kind = walk.context.ast.kindName(argument);
  if (walk.context.ast.is.IsArrowFunction(argument) || walk.context.ast.is.IsFunctionExpression(argument)) {
    const query = createRustCarrierProbe(walk);
    recordCallableParameterSignatureFacts(query, argument, contextualCarrier);
    const selected = resolveFunctionExpressionSignature(query, argument);
    return selected?.inference.kind === "pending" ? { kind: "pending" }
      : { kind: "complete", value: selected?.carrier };
  }
  if (kind === KindSpreadElement) {
    const inner = Node_Expression(walk.context.ast, argument);
    return inner === undefined
      ? { kind: "complete", value: undefined }
      : resolveProjectSourceInferenceCarrier(walk, inner, contextualCarrier);
  }
  if (kind === KindArrayLiteralExpression || kind === KindObjectLiteralExpression) {
    return { kind: "complete", value: walk.context.records.runtimeCarrier.get(argument)?.carrier };
  }
  if (isUnannotatedRustNumericLiteral(walk.context.literalValues.literalValue.get(argument))) {
    return { kind: "complete", value: walk.context.records.runtimeCarrier.get(argument)?.carrier };
  }
  const file = walk.context.ast.getSourceFile(argument);
  return { kind: "complete", value: file === undefined ? undefined : resolveExpressionCarrier(walk, argument, file, undefined) };
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
      !selectedSourceLiteralIsRepresentable(walk.context.literalValues.literalValue.get(argument), target.name)) {
      return false;
    }
    proven = true;
  }
  return proven;
}
