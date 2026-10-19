import type { RustSuspendedCallableImplementation } from "../../../../analysis/callables/suspended-values.js";
import { rustCallableProtocol, rustLocationTargetType } from "../../../../target-model/types/index.js";
import { rustStaticLifetime } from "../../../../target-model/lifetimes/index.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustBlock, RustGenericParameter, RustItem, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { createRustSyntheticNameState } from "../../names/synthetic.js";
import { planRustCallableExpressionBody } from "../../expressions/callable.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustSuspendedCallableStateType } from "../../types/suspended-callables.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import { planRustCallableGenerics } from "./generics.js";
import { bindRustElidedCallableInput, substituteElidedLifetime } from "../../../../target-model/types/carriers/lifetime-elision.js";
import { rustCallableCaptureStorageType } from "../../types/capture-storage.js";
import { rustCapturedReceiverFieldType } from "../../expressions/receiver-captures.js";

export function planRustSuspendedCallableItems(context: RustPlanContext): readonly RustItem[] {
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  const items: RustItem[] = [];
  for (const implementation of context.input.program.callableValues.suspended.implementations) {
    if (implementation.sourceFileName !== fileName) continue;
    const planned = planImplementation(implementation, context);
    if (planned === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, implementation.declaration),
        "rust.backend.suspended-callable-implementation", "A suspended callable requires a complete sealed state and invocation implementation."));
    } else items.push(...planned);
  }
  return items;
}

function planImplementation(implementation: RustSuspendedCallableImplementation, context: RustPlanContext): readonly RustItem[] | undefined {
  const { declaration } = implementation;
  const captures = context.input.program.callableValues.nativeCaptures.forDeclaration(declaration);
  if (captures.kind !== "resolved" ||
    implementation.storage.length !== implementation.captures.length + implementation.receiverFields.length + implementation.receivers.length ||
    !implementation.captures.every((capture, index) => {
      const carrier = substituteElidedLifetime(captures.captures[index]!, rustStaticLifetime);
      return rustTargetTypeRefEquals(implementation.storage[index],
        capture.storage === "location" ? rustLocationTargetType(carrier) : carrier);
    }) || !implementation.receiverFields.every((_capture, index) => rustTargetTypeRefEquals(
      implementation.storage[implementation.captures.length + index], substituteElidedLifetime(captures.receiverFields[index]!, rustStaticLifetime))) ||
    !implementation.receivers.every((_capture, index) => rustTargetTypeRefEquals(
      implementation.storage[implementation.captures.length + implementation.receiverFields.length + index],
      substituteElidedLifetime(captures.receivers[index]!, rustStaticLifetime)))) return undefined;
  const genericPlan = planRustCallableGenerics(declaration, context, undefined, implementation.parameters);
  if (genericPlan === undefined) return undefined;
  const scoped: RustPlanContext = { ...genericPlan.context,
    callableDeclaration: declaration,
    syntheticNames: createRustSyntheticNameState(context.input.program.source.ast, declaration, []),
  };
  const expression = planRustCallableExpressionBody(declaration, scoped);
  if (expression?.kind !== "closure" && expression?.kind !== "closure-block") return undefined;
  const ownerName = expression.params[0]?.name;
  const argumentsName = expression.params[1]?.name;
  if (expression.params.length !== 2 || ownerName === undefined || argumentsName === undefined) return undefined;
  const protocol = rustCallableProtocol(implementation.carrier);
  const bound = protocol === undefined || implementation.elision === undefined ? undefined
    : bindRustElidedCallableInput(protocol.parameters, protocol.result, implementation.elision.lifetime);
  if (implementation.elision !== undefined && bound?.parameterIndex !== implementation.elision.parameterIndex) return undefined;
  const invocation = bound ?? protocol;
  const argumentsType = invocation === undefined ? undefined : rustTypeFromCarrierInContext({ kind: "tuple", elements: invocation.parameters }, scoped);
  const physical = context.input.program.callableValues.nativeProducers.physicalFor(declaration, implementation.carrier);
  const callableType = physical === undefined ? undefined : rustTypeFromCarrierInContext(
    implementation.elision === undefined ? physical : substituteElidedLifetime(physical, implementation.elision.lifetime), scoped);
  const resultArgument = callableType?.kind === "named" ? callableType.genericArguments?.[2] : undefined;
  const resultType = resultArgument?.kind === "type" ? resultArgument.type : undefined;
  const target = rustSuspendedCallableStateType(implementation, scoped);
  const storage = [...implementation.captures.map((capture, index) => rustCallableCaptureStorageType(capture,
    substituteElidedLifetime(captures.captures[index]!, rustStaticLifetime), scoped)),
    ...implementation.receiverFields.map((capture, index) => {
      const type = rustTypeFromCarrierInContext(implementation.storage[implementation.captures.length + index]!, scoped);
      return type === undefined ? undefined : rustCapturedReceiverFieldType(capture, type, scoped);
    }), ...implementation.receivers.map((_capture, index) => rustTypeFromCarrierInContext(
      implementation.storage[implementation.captures.length + implementation.receiverFields.length + index]!, scoped))];
  if (protocol === undefined || argumentsType === undefined || resultType === undefined || target === undefined ||
      storage.some(type => type === undefined)) return undefined;
  const generics = genericPlan.finalizeGenerics();
  const parameters: RustGenericParameter[] = [...generics.parameters];
  const environment = [
    ...implementation.environment.lifetimes.map(lifetime => {
      const selected = scoped.lifetimeSubstitutions?.get(rustLifetimeKey(lifetime)) ?? lifetime;
      return selected.kind === "parameter" || selected.kind === "bound"
        ? parameters.find(parameter => parameter.kind === "lifetime" && parameter.name === selected.name) : undefined;
    }),
    ...implementation.environment.typeParameters.map(type => parameters.find(parameter =>
      parameter.kind === "type" && parameter.name === scoped.typeParameterNames?.get(type.identity))),
  ];
  if (environment.some(parameter => parameter === undefined)) return undefined;
  if (implementation.elision !== undefined) parameters.unshift({
    kind: "lifetime", name: implementation.elision.lifetime.name, outlives: [],
  });
  const body: RustBlock = expression.kind === "closure" ? { statements: [{ kind: "tail", expr: expression.body }] } : expression.body;
  const selfType: RustType = { kind: "named", path: "Self" };
  const state: RustType = { kind: "tuple", elements: storage as RustType[] };
  context.usedAliases?.add("rt");
  return [{ kind: "struct", name: implementation.stateName, visibility: "crate",
    generics: { parameters: environment as RustGenericParameter[], wherePredicates: [] }, fields: [{ name: "state", type: state, visibility: "crate" }, {
      name: "owner", type: { kind: "named", path: "alloc::rc::Weak", genericArguments: [{ kind: "type", type: selfType }] }, visibility: "crate",
    }],
  }, { kind: "impl", target,
    generics: { ...generics, parameters },
    trait: { kind: "named", path: "rt::CallableImplementation", genericArguments: [{ kind: "type", type: argumentsType }] },
    members: [{ kind: "type", name: "Output", generics: emptyRustGenerics, type: resultType },
    { kind: "function", name: "invoke", visibility: "private", selfParam: { kind: "reference", mutable: false },
      generics: { parameters: [], wherePredicates: [] }, params: [{ name: argumentsName, type: argumentsType }], returnType: resultType,
      body: { statements: [{ kind: "let", name: ownerName, mutable: false, init: {
        kind: "method-call", receiver: { kind: "method-call", receiver: {
          kind: "field", receiver: { kind: "path", path: "self" }, name: "owner",
        }, method: "upgrade", args: [] }, method: "expect", args: [{ kind: "str-literal", value: "an invoked callable has a live owner" }],
      } }, ...body.statements] },
    }],
  }];
}
