import type { RustNativeGenericProducerBridge } from "../../../../target-model/records/native/native-protocol-emission.js";
import type { RustNativeCallableProtocol } from "../../../../target-model/records/native/native-protocols.js";
import { rustGenericCallableStorageArguments } from "../../../../target-model/types/carriers/generic-callable-storage.js";
import type { RustExpr, RustItem, RustStmt, RustType } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { planRustNativeCallableMethodGenerics } from "./native-method-generics.js";
import { planRustGenericCallableErrors } from "./generic-errors.js";
import { rustGenericCallableEnvironmentGenerics, rustGenericCallableCapturePredicates } from "./generic-signatures.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function planRustNativeGenericProducerBridges(
  protocol: RustNativeCallableProtocol,
  context: RustPlanContext,
): readonly RustItem[] {
  const emission = context.input.program.records.nativeProtocol.get(protocol);
  if (emission === undefined) failRustPlannerInvariant("An admitted native protocol requires its sealed generic producer bridges.");
  const fileName = context.input.program.source.ast.getFileName(context.sourceFile);
  const items: RustItem[] = [];
  for (const binding of emission.genericProducers) {
    if (binding.ownerFileName !== fileName) continue;
    items.push(planImplementation(protocol, binding, context));
  }
  return items;
}

function planImplementation(
  protocol: RustNativeCallableProtocol,
  selected: RustNativeGenericProducerBridge,
  context: RustPlanContext,
): RustItem {
  const { definition } = selected;
  const signature = protocol.signature;
  const emission = context.input.program.records.nativeProtocol.get(protocol);
  if (emission === undefined) failRustPlannerInvariant("An admitted native protocol requires its sealed dispatch demand.");
  const { invoked } = emission;
  const methodGenerics = planRustNativeCallableMethodGenerics(protocol, context);
  const errors = planRustGenericCallableErrors(definition, context);
  const target = rustTypeFromCarrierInContext(definition.carrier, context);
  const trait = rustTypeFromCarrierInContext(protocol.trait, context);
  const environment = rustGenericCallableEnvironmentGenerics(
    rustGenericCallableStorageArguments(definition.signature.environmentParameters, definition.parameters), context);
  const capturePredicates = rustGenericCallableCapturePredicates(definition, context);
  const returnType = rustTypeFromCarrierInContext(selected.returnCarrier, context, "return");
  const parameters = protocol.method.parameters.map(carrier => rustTypeFromCarrierInContext(carrier, context, "parameter"));
  if (methodGenerics === undefined || errors === undefined || target === undefined || trait === undefined || returnType === undefined ||
    environment === undefined || capturePredicates === undefined ||
    parameters.some(parameter => parameter === undefined)) failRustPlannerInvariant("An admitted native generic producer requires its renderable exact native signature.");
  const nativeFuture = selected.future;
  const call: RustExpr = { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "call",
    genericArguments: signature.typeParameters.map(parameter => ({ kind: "type", type: { kind: "named", path: parameter.name } })),
    args: parameters.map((_parameter, index) => ({ kind: "path", path: `argument_${index}` })),
  };
  const invocationError = errors.invocation.errorType;
  const infallible: RustType = { kind: "named", path: "core::convert::Infallible" };
  const statements: RustStmt[] = [];
  let value: RustExpr = invocationError === undefined ? call : { kind: "try", expr: call,
    operandErrorType: invocationError, resultErrorType: invocationError, nativeReturn: true };
  if (nativeFuture !== undefined && errors.awaiting.errorType === undefined) {
    statements.push({ kind: "let", name: "produced", mutable: false, init: value });
    const pending: RustExpr = { kind: "async-block", move: true, body: { statements: [{ kind: "tail", expr: {
      kind: "call", path: "Ok", args: [{ kind: "await", expr: { kind: "path", path: "future" } }],
    } }] } };
    value = nativeFuture.optional ? { kind: "match", expression: { kind: "path", path: "produced" }, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "future" }] },
        expression: { kind: "call", path: "Some", args: [pending] } },
      { pattern: { kind: "path", path: "None" }, expression: { kind: "path", path: "None" } },
    ] } : { kind: "block", body: { statements: [
      { kind: "let", name: "future", mutable: false, init: { kind: "path", path: "produced" } },
      { kind: "tail", expr: pending },
    ] } };
  }
  statements.push({ kind: "tail", expr: value.kind === "try" ? value.expr : { kind: "call", path: "Ok", args: [value] } });
  return { kind: "impl", target, trait,
    generics: { ...environment, wherePredicates: capturePredicates },
    members: [{ kind: "type", name: "InvocationError", generics: methodGenerics, type: invocationError ?? infallible },
      ...emission.nativeFutures
        .map(future => ({ kind: "type" as const, name: `AwaitError${future.ordinal}`,
        generics: methodGenerics, type: errors.awaiting.errorType ?? infallible })),
      ...(invoked ? [{ kind: "function" as const, name: "invoke", visibility: "private" as const,
        selfParam: { kind: "reference" as const, mutable: false },
        generics: methodGenerics, params: parameters.map((type, index) => ({ name: `argument_${index}`, type: type! })),
        returnType, body: { statements } }] : []),
    ],
  };
}
