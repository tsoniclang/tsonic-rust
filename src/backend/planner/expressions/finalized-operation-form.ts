import type { Node } from "@tsonic/tsts";
import type { RustProviderChainStep } from "../../../target-model/operations/model.js";
import type { RustFinalizedOperationAbi } from "../../../target-model/records/operations/finalized-operation.js";
import type { RustCallGenericArgument, RustExpr, RustGenericArgument, RustGenericParameter, RustItem, RustType, RustTypeBound } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustAutoBorrowedReceiver } from "./auto-borrowed-receivers.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import {
  rustCallTypeFromCarrierInContext, rustTargetCallGenericArgumentToAstInContext,
  rustTargetGenericArgumentToAstInContext, rustTypeFromCarrierInContext,
} from "../types/render.js";
import { invokeRustStructuralObjectMethod } from "../objects/project-storage.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

export function planRustFinalizedOperationForm(
  context: RustPlanContext,
  abi: RustFinalizedOperationAbi,
  receiver: RustExpr | undefined,
  args: readonly RustExpr[],
  operationNode: Node,
  options: { readonly resultUse: "value" | "storage"; readonly assignment: boolean },
): RustExpr | undefined {
  const abiResultCarrier = abi.result.kind === "async" ? abi.result.futureCarrier : abi.result.carrier;
  const form = abi.target;
  const selected = context.input.program.records.providerForm.get(operationNode, abi, context.promiseBody)
    ?? failRustPlannerInvariant("An admitted provider operation requires its exact native form and read contract.", operationNode);
  const receiverMode = abi.targetReceiver.kind === "input"
    ? abi.targetReceiver.input.mode
    : undefined;
  const targetGenericArguments = abi.targetGenericArguments.flatMap((argument) => {
    if (argument.kind === "lifetime") return [];
    const planned = rustTargetCallGenericArgumentToAstInContext(argument, context);
    return planned === undefined ? [undefined] : [planned];
  });
  if (targetGenericArguments.some((argument) => argument === undefined)) {
    failRustPlannerInvariant("Provider operation target generic arguments do not have exact Rust target forms.", operationNode);
  }
  const concreteTargetGenericArguments = targetGenericArguments.length === 0
    ? undefined
    : targetGenericArguments as readonly RustCallGenericArgument[];
  switch (form.form) {
    case "native-promise-continuation":
      return receiver === undefined
        ? failRustPlannerInvariant("An admitted native Promise continuation requires its finalized receiver future.", operationNode)
        : planRustNativePromiseContinuation(form.member, receiver, args, operationNode, context);
    case "numeric-cast":
      return args[0] ?? failRustPlannerInvariant("An admitted numeric cast requires its exact source operand.", operationNode);
    case "marker":
      return failRustPlannerInvariant("An erased native marker cannot reach operation formatting.", operationNode);
    case "arg-method": {
      if (receiver === undefined || abi.targetReceiver.kind !== "input") {
        failRustPlannerInvariant("An admitted native argument method requires its finalized receiver.", operationNode);
      }
      return {
        kind: "method-call",
        receiver: rustAutoBorrowedReceiver(receiver),
        method: form.name,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      };
    }
    case "call": {
      const path = context.input.program.records.integerTruncation.get(operationNode)?.path ?? form.path;
      registerAliasFromPath(context, path);
      return applyProviderOperationChain({
        kind: "call",
        path,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      }, form.chain);
    }
    case "source-module-construction": {
      const worker = selected.worker ?? failRustPlannerInvariant("An admitted source-module constructor requires its native worker operand.", operationNode);
      const entryIdentity = context.workerEntryIdentityByFileName.get(worker.fileName);
      const moduleArgumentIndex = worker.argumentIndex;
      if (entryIdentity === undefined || args[moduleArgumentIndex] === undefined)
        failRustPlannerInvariant("An admitted source-module constructor requires its generated worker entry identity.", operationNode);
      const moduleIdentity: RustExpr = worker.mode === "ref" ? { kind: "str-literal", value: entryIdentity }
        : { kind: "string-literal", value: entryIdentity };
      registerAliasFromPath(context, form.path);
      return {
        kind: "call",
        path: form.path,
        args: args.map((argument, index) =>
          index === moduleArgumentIndex
            ? moduleIdentity
            : argument),
        ...(concreteTargetGenericArguments === undefined
          ? {}
          : { genericArguments: concreteTargetGenericArguments }),
      };
    }
    case "struct-variant":
      registerAliasFromPath(context, form.path);
      return form.fields.length === args.length
        ? {
            kind: "struct-literal",
            path: form.path,
            fields: form.fields.map((name, index) => ({ name, value: args[index]! })),
          }
        : failRustPlannerInvariant("An admitted native struct variant requires its exact field operands.", operationNode);
    case "expression-macro":
      registerAliasFromPath(context, form.path);
      return {
        kind: "macro-invocation",
        path: form.path,
        delimiter: form.delimiter,
        args,
      };
    case "call-c-variadic":
      registerAliasFromPath(context, form.path);
      return {
        kind: "call",
        path: form.path,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      };
    case "call-value-slice":
    case "call-value-array":
    case "call-str-slice":
    case "free-call-str-slice":
    case "free-call": {
      registerAliasFromPath(context, form.path);
      return {
        kind: "call",
        path: form.path,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      };
    }
    case "path": {
      registerAliasFromPath(context, form.path);
      return args.length === 0 ? { kind: "path", path: form.path }
        : failRustPlannerInvariant("An admitted native path has no runtime operands.", operationNode);
    }
    case "reference-path": {
      registerAliasFromPath(context, form.path);
      return args.length === 0
        ? {
            kind: "reference",
            expr: { kind: "path", path: form.path },
            mutable: form.mutable,
          }
        : failRustPlannerInvariant("An admitted native reference path has no runtime operands.", operationNode);
    }
    case "static": {
      registerAliasFromPath(context, form.path);
      if (options.assignment) {
        const value = args[0];
        if (value === undefined || args.length !== 1) failRustPlannerInvariant("Admitted static setter requires its finalized native value.", operationNode);
        return { kind: "assignment", operator: "=", target: { kind: "path", path: form.path }, value };
      }
      return args.length === 0 ? { kind: "path", path: form.path }
        : failRustPlannerInvariant("An admitted native static read has no runtime operands.", operationNode);
    }
    case "method":
    case "arg-receiver-method":
    case "receiver-value-array":
    case "receiver-tagged-array":
      return receiver === undefined
        ? failRustPlannerInvariant("An admitted native method requires its finalized receiver.", operationNode)
        : {
            kind: "method-call",
            receiver: receiverMode === "ref" ? rustAutoBorrowedReceiver(receiver) : receiver,
            method: form.name,
            args,
            ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
            ...(receiverMode === undefined ? {} : { receiverMode }),
          };
    case "arg-structural-method": {
      if (receiver === undefined || abi.targetReceiver.kind !== "input") {
        failRustPlannerInvariant("An admitted structural method requires its finalized receiver.", operationNode);
      }
      return invokeRustStructuralObjectMethod(
        abi.targetReceiver.input.parameterCarrier,
        receiver,
        form.storageIndex,
        args,
        abiResultCarrier,
        context,
        undefined,
      );
    }
    case "receiver-method":
      return receiver === undefined
        ? failRustPlannerInvariant("An admitted native receiver method requires its finalized receiver.", operationNode)
        : applyProviderOperationChain(
            {
              kind: "method-call",
              receiver,
              method: form.name,
              args,
              ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
              ...(receiverMode === undefined ? {} : { receiverMode }),
            },
            form.chain,
          );
    case "field":
    case "index": {
      if (options.assignment) {
        const value = args[form.form === "field" ? 0 : 1];
        const index = form.form === "index" ? args[0] : undefined;
        if (receiver === undefined || value === undefined || args.length !== (form.form === "field" ? 1 : 2) ||
          form.form === "index" && index === undefined) failRustPlannerInvariant("Admitted storage setter requires its finalized native receiver and inputs.", operationNode);
        const target: RustExpr = form.form === "field" ? { kind: "field", receiver, name: form.name }
          : { kind: "index", receiver, index: index! };
        return { kind: "assignment", operator: "=", target, value };
      }
      if (receiver === undefined || args.length !== (form.form === "field" ? 0 : 1)) {
        failRustPlannerInvariant("An admitted native storage read requires its exact receiver and index operands.", operationNode);
      }
      const place: RustExpr | undefined = form.form === "field"
        ? { kind: "field", receiver, name: form.name }
        : args[0] === undefined ? undefined : { kind: "index", receiver, index: args[0] };
      if (place === undefined) failRustPlannerInvariant("An admitted native storage read requires its selected place.", operationNode);
      if (options.resultUse === "storage") {
        return place;
      }
      if (selected.read === "copy") {
        return place;
      }
      if (selected.read !== "clone") failRustPlannerInvariant("An admitted native value read requires its preselected Copy or Clone contract.", operationNode);
      return { kind: "method-call", receiver: place, method: "clone", args: [] };
    }
    case "binary-operator": {
      const [left, right] = args;
      if (left === undefined || right === undefined || args.length !== 2) {
        failRustPlannerInvariant("An admitted binary operation requires its two finalized operands.", operationNode);
      }
      return { kind: "binary", operator: form.operator, left, right };
    }
    case "associated-call": {
      const owner = rustCallTypeFromCarrierInContext(form.owner, context);
      if (owner === undefined) failRustPlannerInvariant("An admitted native associated call requires its rendered owner.", operationNode);
      return {
        kind: "associated-call", owner, method: form.method, args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      };
    }
    case "trait-call": {
      const owner = rustCallTypeFromCarrierInContext(form.owner, context);
      const traitGenericArguments = form.traitGenericArguments.map((argument) =>
        rustTargetGenericArgumentToAstInContext(argument, context));
      if (owner === undefined || traitGenericArguments.some((argument) => argument === undefined)) {
        failRustPlannerInvariant("An admitted native trait call requires its rendered owner and arguments.", operationNode);
      }
      registerAliasFromPath(context, form.traitPath);
      return {
        kind: "associated-call",
        owner,
        trait: {
          kind: "named",
          path: form.traitPath,
          ...(traitGenericArguments.length === 0
            ? {}
            : {
                genericArguments: traitGenericArguments as readonly RustGenericArgument[],
              }),
        },
        method: form.method,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      };
    }
    case "trait-associated-value": {
      const owner = rustTypeFromCarrierInContext(form.owner, context);
      const traitGenericArguments = form.traitGenericArguments.map((argument) =>
        rustTargetGenericArgumentToAstInContext(argument, context));
      if (owner === undefined || traitGenericArguments.some((argument) => argument === undefined) || args.length !== 0) {
        failRustPlannerInvariant("An admitted native trait constant requires its exact owner and generic arguments.", operationNode);
      }
      registerAliasFromPath(context, form.traitPath);
      return {
        kind: "associated-value",
        owner,
        trait: {
          kind: "named",
          path: form.traitPath,
          ...(traitGenericArguments.length === 0
            ? {}
            : {
                genericArguments: traitGenericArguments as readonly RustGenericArgument[],
              }),
        },
        name: form.name,
      };
    }
    case "associated-value": {
      const owner = rustTypeFromCarrierInContext(form.owner, context);
      if (owner === undefined || args.length !== 0) {
        failRustPlannerInvariant("An admitted native constant requires its exact rendered owner and no runtime arguments.", operationNode);
      }
      return {
        kind: "associated-value",
        owner,
        name: form.name,
      };
    }
  }
}

function applyProviderOperationChain(
  expression: RustExpr,
  chain: readonly RustProviderChainStep[] | undefined,
): RustExpr | undefined {
  let result = expression;
  for (const step of chain ?? []) {
    if (step.kind !== "method") {
      return undefined;
    }
    result = { kind: "method-call", receiver: result, method: step.name, args: [] };
  }
  return result;
}

// `promise.catch(rejected)` / `promise.then(fulfilled, rejected?)` on a native Promise body: a local async function
// awaits the receiver future and routes its settlement to the callbacks (an unhandled rejection settles the continuation
// with it). The callbacks are fallible native closures; the function's bounds give them their exact parameter types.
function planRustNativePromiseContinuation(member: "catch" | "then", receiver: RustExpr, args: readonly RustExpr[],
  operationNode: Node, context: RustPlanContext): RustExpr {
  const names = context.syntheticNames
    ?? failRustPlannerInvariant("An admitted native Promise continuation requires its hygienic name scope.", operationNode);
  if (args.length < 1 || args.length > (member === "catch" ? 1 : 2))
    failRustPlannerInvariant("An admitted native Promise continuation requires its exact callbacks.", operationNode);
  context.usedAliases?.add("rt");
  const name = allocateRustSyntheticName(names, `native_promise_${member}`);
  const named = (path: string, ...types: RustType[]): RustType => ({ kind: "named", path,
    ...(types.length === 0 ? {} : { genericArguments: types.map(type => ({ kind: "type" as const, type })) }) });
  const value = named("Value");
  const output = member === "catch" ? value : named("Output");
  const rejection = named("Rejection");
  const settled = (type: RustType): RustType => named("rt::TsonicResult", type);
  const callback = (parameter: RustType): RustTypeBound =>
    ({ kind: "callable", trait: "FnOnce", binder: [], parameters: [parameter], result: settled(output) });
  const fulfilled = member === "then";
  const rejected = member === "catch" || args.length === 2;
  const parameters: RustGenericParameter[] = [
    { kind: "type", name: "Value", bounds: [] },
    ...(member === "then" ? [{ kind: "type" as const, name: "Output", bounds: [] }] : []),
    { kind: "type", name: "Rejection", bounds: rejected ? [] : [{ kind: "trait-type", reference: {
      trait: named("core::convert::Into", named("rt::TsonicError")) } }] },
    ...(fulfilled ? [{ kind: "type" as const, name: "Fulfilled", bounds: [callback(value)] }] : []),
    ...(rejected ? [{ kind: "type" as const, name: "Rejected", bounds: [callback(rejection)] }] : []),
  ];
  const promise: RustType = { kind: "impl-trait", outlives: [], bounds: [{ kind: "trait-type", reference: {
    trait: { kind: "named", path: "core::future::Future", genericArguments: [{ kind: "associated-equality", name: "Output",
      genericArguments: [], type: named("Result", value, rejection) }] } } }] };
  const invoke = (callee: string, argument: string): RustExpr =>
    ({ kind: "invoke", callee: { kind: "path", path: callee }, args: [{ kind: "path", path: argument }] });
  const body: RustExpr = { kind: "match", expression: { kind: "await", expr: { kind: "path", path: "promise" } }, arms: [
    { pattern: { kind: "tuple-variant", path: "Ok", elements: [{ kind: "binding", name: "value" }] },
      expression: fulfilled ? invoke("fulfilled", "value") : { kind: "call", path: "Ok", args: [{ kind: "path", path: "value" }] } },
    { pattern: { kind: "tuple-variant", path: "Err", elements: [{ kind: "binding", name: "rejection" }] },
      expression: rejected ? invoke("rejected", "rejection") : { kind: "call", path: "Err", args: [{ kind: "method-call",
        receiver: { kind: "path", path: "rejection" }, method: "into", args: [] }] } },
  ] };
  const item: RustItem = { kind: "function", name, visibility: "private", isAsync: true,
    generics: { parameters, wherePredicates: [] },
    params: [{ name: "promise", type: promise },
      ...(fulfilled ? [{ name: "fulfilled", type: named("Fulfilled") }] : []),
      ...(rejected ? [{ name: "rejected", type: named("Rejected") }] : [])],
    returnType: settled(output), body: { statements: [{ kind: "tail", expr: body }] } };
  return { kind: "block", body: { statements: [{ kind: "item", item },
    { kind: "tail", expr: { kind: "call", path: name, args: [receiver, ...args] } }] } };
}
