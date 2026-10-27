import type { RustNativeCallableProtocol } from "../../../../target-model/records/native-protocols.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type {
  RustBlock, RustFunctionParam, RustGenericArgument, RustItem, RustImplFunction, RustType,
  RustWherePredicate,
} from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { registerAliasFromPath } from "../../program/plan-context.js";
import { rustLifetimeBinderToAst } from "../../types/carrier-syntax.js";
import { rustTypeFromCarrierInContext, rustTargetGenericArgumentToAstInContext } from "../../types/render.js";
import { planRustNativeCallableMethodGenerics } from "./native-method-generics.js";
import { planRustNativeProtocolObligations } from "./native-protocol-obligations.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustGenericCallableEnvironmentGenerics } from "./generic-signatures.js";

export function planRustNativeProducerBridge(protocol: RustNativeCallableProtocol, context: RustPlanContext): readonly RustItem[] {
  const emission = context.input.program.records.nativeProtocol.get(protocol);
  if (emission === undefined) failRustPlannerInvariant("An admitted native protocol requires its producer emission record.");
  const bridge = emission.producer;
  if (bridge === undefined) return [];
  const { invoked } = emission;
  const higherRanked = bridge.higherRanked;
  const lifetimes = rustLifetimeBinderToAst(protocol.method.binder);
  const genericParameters = rustGenericCallableEnvironmentGenerics(bridge.genericArguments, context).parameters;
  const environmentParameters = rustGenericCallableEnvironmentGenerics(protocol.environmentParameters, context).parameters;
  const lifetimeArguments: readonly RustGenericArgument[] = lifetimes.map(lifetime => ({ kind: "lifetime", lifetime: { kind: "named", name: lifetime.name } }));
  const environmentArguments = protocol.environmentParameters.map(argument =>
    rustTargetGenericArgumentToAstInContext(argument, context)
      ?? failRustPlannerInvariant("An admitted native protocol requires its exact rendered environment argument."));
  const boundArguments = bridge.boundTypes.map(type => typeArgument(named(type.name)));
  const protocolType = named(protocol.targetName, environmentArguments);
  const implementationType = named(bridge.implementation.name);
  const render = (carrier: TargetTypeRef, position: "general" | "parameter" | "return" = "general"): RustType =>
    rustTypeFromCarrierInContext(carrier, context, position) ?? failRustPlannerInvariant("An admitted native producer requires its renderable selected carrier.");
  const parameters: readonly RustFunctionParam[] = protocol.method.parameters.map((carrier, index) => ({ name: `argument_${index}`, type: render(carrier, "parameter") }));
  const channels = ["InvocationError", ...bridge.errors.map(error => `AwaitError${error.ordinal}`)];
  const errorTypes = [bridge.invocationError, ...bridge.errors.map(error => error.parameter)];
  const concreteResult = render(bridge.concreteResult);
  const inputTuple: RustType = { kind: "tuple", elements: parameters.map(parameter => parameter.type) };
  const argumentsType = higherRanked === undefined ? inputTuple : named(bridge.arguments.name);
  const callable = named("rt::CallableImplementation", [typeArgument(argumentsType),
    { kind: "associated-equality", name: "Output", genericArguments: [], type: concreteResult }]);
  const predicates: RustWherePredicate[] = [{ kind: "type", type: implementationType, bounds: [{ kind: "trait-type", reference: { trait: callable } }] },
    ...planRustNativeProtocolObligations(protocol, context)];
  for (const future of bridge.futureBounds) predicates.push({ kind: "type", type: named(future.parameter.name), bounds: [{ kind: "trait-type", reference: {
    trait: named("core::future::Future", [{ kind: "associated-equality", name: "Output", genericArguments: [],
      type: named("Result", [typeArgument(render(future.output)), typeArgument(named(future.error.name))]) }]),
  } }] });
  const implementationResult = render(bridge.implementationResult, "return");
  registerAliasFromPath(context, "rt::CallableImplementation");
  const directParameters = higherRanked === undefined ? parameters : [{ name: "arguments", type: argumentsType }];
  const invokeBody: RustBlock = { statements: [{ kind: "tail", expr: { kind: "associated-call", owner: implementationType,
    trait: named("rt::CallableImplementation", [typeArgument(argumentsType)]), method: "invoke", args: [
      { kind: "path", path: "self" }, higherRanked === undefined ? { kind: "tuple-literal", elements: parameters.map(parameter => ({ kind: "path", path: parameter.name })) }
        : { kind: "path", path: "arguments" },
    ] } }] };
  if (higherRanked !== undefined && protocol.boundProducerName === undefined) failRustPlannerInvariant("An admitted higher-ranked producer requires its bound native trait name.");
  const direct: RustItem = { kind: "impl", trait: higherRanked === undefined ? protocolType : named(protocol.boundProducerName!, [...lifetimeArguments, ...boundArguments]),
    target: implementationType, generics: { parameters: [...lifetimes, ...genericParameters], wherePredicates: predicates },
    members: [...channels.map((name, index) => ({ kind: "type" as const, name, generics: emptyRustGenerics, type: named(errorTypes[index]!.name) })),
      ...(invoked ? [{ kind: "function" as const, name: "invoke", visibility: "private" as const, generics: emptyRustGenerics,
        selfParam: { kind: "reference" as const, mutable: false }, params: directParameters, returnType: implementationResult, body: invokeBody }] : [])],
  };
  if (higherRanked === undefined) return [direct];
  const helperResult = render(higherRanked.helperResult, "return");
  const publicResult = render(higherRanked.publicResult, "return");
  const methodGenerics = planRustNativeCallableMethodGenerics(protocol, context);
  const helperType = named(protocol.boundProducerName!, [...lifetimeArguments, typeArgument(inputTuple), ...higherRanked.outputs.map(output => typeArgument(render(output)))]);
  return [{ kind: "trait", name: protocol.boundProducerName!, visibility: "public", generics: { ...emptyRustGenerics,
    parameters: [...lifetimes, ...bridge.boundTypes.map(type => ({ kind: "type" as const, name: type.name, bounds: [] }))] },
    members: [...channels.map(name => ({ kind: "type" as const, name, generics: emptyRustGenerics, bounds: [] })),
      ...(invoked ? [{ kind: "function" as const, name: "invoke", generics: emptyRustGenerics,
        selfParam: { kind: "reference" as const, mutable: false }, params: directParameters, returnType: helperResult }] : [])],
  }, direct, { kind: "impl", trait: protocolType, target: implementationType,
    generics: { parameters: [...environmentParameters.filter(parameter => parameter.kind === "lifetime"),
      { kind: "type", name: bridge.implementation.name, bounds: [] },
      ...environmentParameters.filter(parameter => parameter.kind !== "lifetime")],
      wherePredicates: [{ kind: "type", type: implementationType, binder: lifetimes, bounds: [{ kind: "trait-type", reference: { trait: helperType } }] },
        ...planRustNativeProtocolObligations(protocol, context)] },
    members: [...channels.map(name => ({ kind: "type" as const, name, generics: methodGenerics,
      type: { kind: "qualified" as const, owner: implementationType, trait: helperType, member: name } })),
      ...(invoked ? [{ kind: "function" as const, name: "invoke", visibility: "private" as const, generics: methodGenerics,
        selfParam: { kind: "reference" as const, mutable: false }, params: parameters, returnType: publicResult,
        body: { statements: [{ kind: "tail", expr: { kind: "associated-call", owner: implementationType, trait: helperType, method: "invoke", args: [
          { kind: "path", path: "self" }, { kind: "tuple-literal", elements: parameters.map(parameter => ({ kind: "path", path: parameter.name })) },
        ] } }] } } satisfies RustImplFunction] : [])],
  }];
}

function named(path: string, genericArguments: readonly RustGenericArgument[] = []): RustType {
  return { kind: "named", path, ...(genericArguments.length === 0 ? {} : { genericArguments }) };
}

function typeArgument(type: RustType): RustGenericArgument {
  return { kind: "type", type };
}
