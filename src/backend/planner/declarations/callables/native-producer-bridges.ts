import type { RustNativeCallableProtocol } from "../../../../analysis/callables/native-protocols.js";
import { rustNativeCallableProtocolResult } from "../../../../analysis/callables/native-protocols.js";
import type { TargetTypeRef, RustTargetGenericArgument } from "../../../../target-model/types/model.js";
import { instantiateRustNativeCompletion, rustNativeCompletionFutureType } from "../../../../target-model/types/callable-completions.js";
import { rustFutureTargetId } from "../../../../target-model/types/carriers/primitives.js";
import { rustJsPromiseTargetId } from "../../../../target-model/types/carriers/source-types.js";
import { rustNamedTargetType } from "../../../../target-model/types/carriers/native.js";
import { rustTypeGenericArguments } from "../../../../target-model/types/generic-arguments.js";
import { mapRustTargetTypes } from "../../../../target-model/types/carriers/substitution.js";
import { rustAwaitSelectionLeaves } from "../../../../target-model/types/await.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../../../target-model/names/generated.js";
import type { RustBlock, RustFunctionParam, RustGenericArgument, RustGenericParameter,
  RustItem, RustType, RustWherePredicate } from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { registerAliasFromPath } from "../../program/plan-context.js";
import { rustLifetimeBinderToAst, rustTypeFromCarrierInContext } from "../../types/render.js";
import { planRustNativeCallableMethodGenerics } from "./native-method-generics.js";

export function planRustNativeProducerBridge(
  protocol: RustNativeCallableProtocol,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const signature = protocol.binding.signature;
  if (signature.typeParameters.length !== 0) return [];
  const lifetimes = rustLifetimeBinderToAst(protocol.method.binder);
  if (lifetimes.length > 0 && protocol.boundProducerName === undefined) return undefined;
  const names = new Set(signature.environmentParameters.map(parameter => parameter.name));
  const parameter = (preferred: string): Extract<TargetTypeRef, { readonly kind: "type-parameter" }> => ({
    kind: "type-parameter", identity: `${protocol.identity}:producer:${preferred}`,
    name: allocateRustGeneratedName(names, preferred),
  });
  const implementation = parameter("Implementation");
  const invocationError = parameter("InvocationError");
  const futures = protocol.completion?.futures ?? [];
  const errors = futures.map(future => parameter(`AwaitError${future.ordinal}`));
  const pending = new Map(futures.filter(future => future.carrier.kind === "target-named" &&
    future.carrier.id === rustFutureTargetId).map(future => [future.ordinal, parameter(`Pending${future.ordinal}`)]));
  const environment = signature.environmentParameters;
  const argumentsParameter = parameter("Arguments");
  const outputs = new Map<string, { readonly source: TargetTypeRef;
    readonly parameter: Extract<TargetTypeRef, { readonly kind: "type-parameter" }> }>();
  if (lifetimes.length > 0) {
    const selected = protocol.completion === undefined ? [protocol.method.result] :
      rustAwaitSelectionLeaves(protocol.completion.selection).map(leaf => leaf.future?.outputCarrier ?? leaf.carrier);
    for (const source of selected) {
      const identity = closedMetadataKey(source);
      if (!outputs.has(identity)) outputs.set(identity, { source, parameter: parameter(`Output${outputs.size}`) });
    }
  }
  const boundTypes = [argumentsParameter, ...[...outputs.values()].map(output => output.parameter)];
  const genericTypes = [implementation, ...(lifetimes.length === 0 ? environment : boundTypes),
    invocationError, ...errors, ...pending.values()];
  const genericParameters: readonly RustGenericParameter[] = genericTypes.map(type => ({
    kind: "type", name: type.name, bounds: [],
  }));
  const environmentParameters: readonly RustGenericParameter[] = environment.map(type => ({
    kind: "type", name: type.name, bounds: [],
  }));
  const lifetimeArguments: readonly RustGenericArgument[] = lifetimes.map(lifetime => ({
    kind: "lifetime", lifetime: { kind: "named", name: lifetime.name },
  }));
  const targetLifetimes: readonly RustTargetGenericArgument[] = protocol.method.binder.parameters.map(parameter => ({
    kind: "lifetime", lifetime: parameter.lifetime,
  }));
  const environmentArguments = environment.map(type => typeArgument(named(type.name)));
  const boundArguments = boundTypes.map(type => typeArgument(named(type.name)));
  const protocolType = named(protocol.targetName, environmentArguments);
  const implementationType = named(implementation.name);
  const parameters: RustFunctionParam[] = [];
  for (const [index, carrier] of protocol.method.parameters.entries()) {
    const type = rustTypeFromCarrierInContext(carrier, context, "parameter");
    if (type === undefined) return undefined;
    parameters.push({ name: `argument_${index}`, type });
  }
  const channels = ["InvocationError", ...futures.map(future => `AwaitError${future.ordinal}`)];
  const errorTypes = [invocationError, ...errors];
  const concreteResult = result(invocationError, ordinal => errors[ordinal]!, undefined);
  if (concreteResult === undefined) return undefined;
  const inputTuple: RustType = { kind: "tuple", elements: parameters.map(parameter => parameter.type) };
  const argumentsType = lifetimes.length === 0 ? inputTuple : named(argumentsParameter.name);
  const callable = named("rt::CallableImplementation", [
    typeArgument(argumentsType),
    { kind: "associated-equality", name: "Output", genericArguments: [], type: concreteResult },
  ]);
  const predicates: RustWherePredicate[] = [{ kind: "type", type: implementationType,
    bounds: [{ kind: "trait-type", reference: { trait: callable } }],
  }];
  for (const future of futures) {
    const selected = pending.get(future.ordinal);
    if (selected === undefined) continue;
    const output = rustTypeFromCarrierInContext(bindOutputs(future.output), context);
    if (output === undefined) return undefined;
    predicates.push({ kind: "type", type: named(selected.name), bounds: [{ kind: "trait-type", reference: {
      trait: named("core::future::Future", [{ kind: "associated-equality", name: "Output", genericArguments: [],
        type: named("Result", [typeArgument(output), typeArgument(named(errors[future.ordinal]!.name))]),
      }]),
    } }] });
  }
  const implResult = result(invocationError, ordinal => errors[ordinal]!, [
    ...targetLifetimes, ...rustTypeGenericArguments(genericTypes),
  ]);
  if (implResult === undefined) return undefined;
  registerAliasFromPath(context, "rt::CallableImplementation");
  const directParameters = lifetimes.length === 0 ? parameters : [{ name: "arguments", type: argumentsType }];
  const invokeBody: RustBlock = { statements: [{ kind: "tail", expr: {
    kind: "associated-call", owner: implementationType, trait: named("rt::CallableImplementation", [
      typeArgument(argumentsType),
    ]), method: "invoke", args: [{ kind: "path", path: "self" }, lifetimes.length === 0 ? {
      kind: "tuple-literal", elements: parameters.map(parameter => ({ kind: "path", path: parameter.name })),
    } : { kind: "path", path: "arguments" }],
  } }] };
  const direct: RustItem = { kind: "impl", trait: lifetimes.length === 0 ? protocolType : named(protocol.boundProducerName!, [
    ...lifetimeArguments, ...boundArguments,
  ]), target: implementationType,
  generics: { parameters: [...lifetimes, ...genericParameters], wherePredicates: predicates },
  members: [...channels.map((name, index) => ({ kind: "type" as const, name, generics: emptyRustGenerics,
    type: named(errorTypes[index]!.name),
  })), { kind: "function", name: "invoke", visibility: "private", generics: emptyRustGenerics,
    selfParam: { kind: "reference", mutable: false }, params: directParameters, returnType: implResult, body: invokeBody,
  }],
  };
  if (lifetimes.length === 0) return [direct];
  const self: TargetTypeRef = { kind: "type-parameter", identity: `${protocol.identity}:Self`, name: "Self" };
  const associated = (name: string): TargetTypeRef => ({ kind: "associated-type", owner: self, name, genericArguments: [] });
  const helperResult = result(associated("InvocationError"), ordinal => associated(`AwaitError${ordinal}`), [
    ...targetLifetimes, ...rustTypeGenericArguments([self, ...boundTypes]),
  ]);
  const publicResult = rustNativeCallableProtocolResult(protocol, context.input.program.typeDefinitions);
  const renderedPublicResult = publicResult === undefined ? undefined : rustTypeFromCarrierInContext(
    mapRustTargetTypes(publicResult, type => type.kind !== "impl-trait" ? type : { ...type,
      captures: type.captures?.map(argument => argument.kind === "type" && argument.type.kind === "type-parameter" &&
        argument.type.identity === self.identity ? { kind: "type", type: implementation } : argument),
    }), context, "return");
  if (helperResult === undefined || renderedPublicResult === undefined) return undefined;
  const methodGenerics = planRustNativeCallableMethodGenerics(protocol, context);
  if (methodGenerics === undefined) return undefined;
  const outputTypes: RustType[] = [];
  for (const output of outputs.values()) {
    const type = rustTypeFromCarrierInContext(output.source, context);
    if (type === undefined) return undefined;
    outputTypes.push(type);
  }
  const helperType = named(protocol.boundProducerName!, [...lifetimeArguments,
    typeArgument(inputTuple), ...outputTypes.map(typeArgument)]);
  return [
    { kind: "trait", name: protocol.boundProducerName!, visibility: "public",
      generics: { ...emptyRustGenerics, parameters: [...lifetimes, ...boundTypes.map(type => ({
        kind: "type" as const, name: type.name, bounds: [],
      }))] },
      members: [...channels.map(name => ({ kind: "type" as const, name, generics: emptyRustGenerics, bounds: [] })),
        { kind: "function", name: "invoke", generics: emptyRustGenerics,
          selfParam: { kind: "reference", mutable: false }, params: directParameters, returnType: helperResult,
        }],
    },
    direct,
    { kind: "impl", trait: protocolType, target: implementationType,
      generics: { parameters: [{ kind: "type", name: implementation.name, bounds: [] }, ...environmentParameters],
        wherePredicates: [{ kind: "type", type: implementationType, binder: lifetimes,
          bounds: [{ kind: "trait-type", reference: { trait: helperType } }],
        }],
      },
      members: [...channels.map(name => ({ kind: "type" as const, name, generics: methodGenerics,
        type: { kind: "qualified" as const, owner: implementationType, trait: helperType, member: name },
      })), { kind: "function", name: "invoke", visibility: "private", generics: methodGenerics,
        selfParam: { kind: "reference", mutable: false }, params: parameters, returnType: renderedPublicResult,
        body: { statements: [{ kind: "tail", expr: { kind: "associated-call", owner: implementationType,
          trait: helperType, method: "invoke", args: [{ kind: "path", path: "self" },
            { kind: "tuple-literal", elements: parameters.map(parameter => ({ kind: "path", path: parameter.name })) }],
        } }] },
      }],
    },
  ];

  function result(
    error: TargetTypeRef,
    awaitError: (ordinal: number) => TargetTypeRef,
    captures: readonly RustTargetGenericArgument[] | undefined,
  ): RustType | undefined {
    const completion = protocol.completion === undefined ? protocol.method.result :
      instantiateRustNativeCompletion(protocol.completion, future => {
        if (future.carrier.kind !== "target-named") return undefined;
        if (future.carrier.id === rustJsPromiseTargetId) {
          const arguments_ = future.carrier.genericArguments;
          return arguments_?.length !== 3 ? undefined : { ...future.carrier,
            genericArguments: [arguments_[0]!, arguments_[1]!, { kind: "type", type: awaitError(future.ordinal) }],
          };
        }
        if (future.carrier.id !== rustFutureTargetId) return undefined;
        return captures === undefined ? pending.get(future.ordinal) : rustNativeCompletionFutureType({
          identity: `${protocol.identity}:producer:future:${future.ordinal}`, output: future.output,
          error: awaitError(future.ordinal), captures,
        });
      }, context.input.program.typeDefinitions);
    return completion === undefined ? undefined : rustTypeFromCarrierInContext(rustNamedTargetType(
      "rust.core.Result", "Result", rustTypeGenericArguments([bindOutputs(completion), error]),
    ), context, captures === undefined ? "general" : "return");
  }

  function bindOutputs(carrier: TargetTypeRef): TargetTypeRef {
    return outputs.size === 0 ? carrier : mapRustTargetTypes(carrier, (type, source) =>
      outputs.get(closedMetadataKey(source))?.parameter ?? type);
  }
}

function named(path: string, genericArguments: readonly RustGenericArgument[] = []): RustType {
  return { kind: "named", path, ...(genericArguments.length === 0 ? {} : { genericArguments }) };
}

function typeArgument(type: RustType): RustGenericArgument {
  return { kind: "type", type };
}
