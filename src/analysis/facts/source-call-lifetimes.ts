import type { RustSelectedTargetSignature, RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { rustLifetimeKey, rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { instantiateRustElidedCallResult } from "../../target-model/types/carriers/lifetime-elision.js";
import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import type { AstReader, Node } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { KindSpreadElement, Node_Expression } from "@tsonic/target-api/source";
import type { RustSourceCallParameterPlan } from "../../target-model/operations/model.js";
import { rustCallableInputMatches } from "../../target-model/conversions/callable-input.js";
import { rustPlaceholderLifetime } from "../../target-model/lifetimes/index.js";

export function rustSourceCallArgumentCarriers(
  call: Node, ast: AstReader, facts: Pick<RustPlanQueries, "getRuntimeCarrierFact">,
): readonly (TargetTypeRef | undefined)[] {
  return ast.arguments(call).map(argument => {
    const source = argument !== undefined && ast.kindName(argument) === KindSpreadElement ? Node_Expression(ast, argument) : argument;
    return facts.getRuntimeCarrierFact(source)?.carrier;
  });
}

export function rustSourceCallResultWithInputLifetimes(
  result: TargetTypeRef,
  parameters: readonly TargetTypeRef[],
  bindings: RustSelectedTargetSignature["sourceArgumentBindings"],
  arguments_: readonly (TargetTypeRef | undefined)[],
  physicalParameters: readonly Pick<RustSourceCallParameterPlan, "inputLifetime">[] = [],
): TargetTypeRef {
  const inputs = (bindings ?? []).flatMap(binding => {
    const argument = arguments_[binding.sourceArgumentIndex];
    if (argument === undefined || binding.sourceForm === "spread-sequence" ||
      binding.sourceParameterForm === "rest-element") return [];
    const carrier = binding.sourceForm === "spread-element"
      ? binding.spreadElementIndex === undefined ? undefined : rustSpreadElementCarrier(argument, binding.spreadElementIndex)
      : argument;
    return carrier === undefined ? [] : [{ parameterIndex: binding.sourceParameterIndex, carrier }];
  });
  const inferred = new Map<string, RustLifetimeRef>();
  for (const [index, physical] of physicalParameters.entries()) {
    const lifetime = physical.inputLifetime;
    const parameter = parameters[index];
    if (lifetime === undefined || parameter?.kind !== "reference" || !rustLifetimesEqual(parameter.lifetime, lifetime)) continue;
    const actual = inputs.filter(input => input.parameterIndex === index);
    if (actual.length !== 1 || !rustCallableInputMatches(actual[0]!.carrier, parameter)) continue;
    const carrier = actual[0]!.carrier;
    const identity = rustLifetimeKey(lifetime);
    const candidate = carrier.kind === "reference" ? carrier.lifetime ?? rustPlaceholderLifetime : rustPlaceholderLifetime;
    const previous = inferred.get(identity);
    inferred.set(identity, previous === undefined || rustLifetimesEqual(previous, candidate) || previous.kind === "static"
      ? candidate : candidate.kind === "static" ? previous : rustPlaceholderLifetime);
  }
  return instantiateRustElidedCallResult(substituteRustTargetGenerics(result, new Map(), inferred), parameters, inputs);
}

export function rustSourceCallGenericLifetimeArguments(
  selected: RustSelectedTargetSignature,
  finalized: readonly RustTargetGenericArgument[],
  argumentCarrier: (index: number) => TargetTypeRef | undefined,
): readonly RustTargetGenericArgument[] | undefined {
  const parameters = selected.member.genericParameters ?? [];
  const selectedArguments = selected.targetGenericArguments ?? [];
  const sourceArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  if (parameters.length !== finalized.length || selectedArguments.length !== finalized.length ||
    sourceArguments.length !== finalized.length) return undefined;
  const initial = finalized.map((argument, index) => parameters[index]?.kind === "lifetime"
    ? selectedArguments[index]! : argument);
  const substitutions = rustTargetGenericBindingsForArguments(parameters, initial);
  if (substitutions === undefined) return undefined;
  const inferredParameters = initial.flatMap((argument, index) => argument.kind === "lifetime" &&
    argument.lifetime.kind === "call-scoped-elision" && sourceArguments[index]?.explicitTypeNode === undefined
    ? [{ index, lifetime: argument.lifetime }] : []);
  if (inferredParameters.length === 0) return initial;
  if (selected.sourceArgumentBindings === undefined) return undefined;
  const inferenceVariables = new Map(inferredParameters.map(parameter => [rustLifetimeKey(parameter.lifetime), parameter.lifetime]));
  const inferred = new Map<string, RustLifetimeRef>();
  for (const binding of selected.sourceArgumentBindings) {
    const parameter = selected.member.parameters[binding.sourceParameterIndex];
    const argument = argumentCarrier(binding.sourceArgumentIndex);
    if (parameter === undefined || argument === undefined || binding.sourceForm === "spread-sequence") continue;
    const actual = binding.sourceForm === "spread-element"
      ? binding.spreadElementIndex === undefined ? undefined : rustSpreadElementCarrier(argument, binding.spreadElementIndex)
      : argument;
    let pattern = substituteRustTargetGenerics(parameter.type, substitutions.types, substitutions.lifetimes, substitutions.consts);
    if (parameter.passingMode === "borrow-shared" || parameter.passingMode === "borrow-mut") {
      if (pattern.kind !== "reference") return undefined;
      pattern = pattern.referent;
    }
    if (binding.sourceParameterForm === "rest-element") {
      if (pattern.kind !== "array") continue;
      pattern = pattern.element;
    }
    if (actual === undefined) continue;
    const candidate = inferRustTargetGenericBindings(pattern, actual, {
      typeIdentities: new Set(), lifetimeIdentities: new Set(inferenceVariables.keys()), constIdentities: new Set(),
    }, { callScopedElisionBindings: inferenceVariables });
    if (candidate === undefined) continue;
    for (const [identity, lifetime] of candidate.lifetimes) {
      if (lifetime.kind === "placeholder" || rustLifetimesEqual(lifetime, inferenceVariables.get(identity))) continue;
      const previous = inferred.get(identity);
      if (previous !== undefined && !rustLifetimesEqual(previous, lifetime)) return undefined;
      inferred.set(identity, lifetime);
    }
  }
  return Object.freeze(initial.map((argument, index) => {
    const parameter = inferredParameters.find(parameter => parameter.index === index);
    const lifetime = parameter === undefined ? undefined : inferred.get(rustLifetimeKey(parameter.lifetime));
    return lifetime === undefined ? argument : Object.freeze({ kind: "lifetime" as const, lifetime });
  }));
}
