import type { Node } from "@tsonic/tsts";
import { isRustCopyCarrier, rustPrimitiveTypeName } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProviderChainStep } from "../../../target-model/operations/model.js";
import type { RustFinalizedOperationAbi } from "../../../target-model/records/finalized-operation.js";
import { isRustFinalizedSourceInput } from "../../../analysis/operations/finalized-operation/conversions.js";
import type { RustCallGenericArgument, RustExpr, RustGenericArgument } from "../../target-ast/syntax/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { diagnosticInput, registerAliasFromPath } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCallTypeFromCarrierInContext, rustTargetCallGenericArgumentToAstInContext,
  rustTargetGenericArgumentToAstInContext, rustTypeFromCarrierInContext } from "../types/render.js";
import { rustCarrierHasCloneContract } from "../types/generic-requirements.js";
import { invokeRustStructuralObjectMethod } from "../objects/project-storage.js";

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
  const receiverMode = abi.targetReceiver.kind === "input"
    ? abi.targetReceiver.input.mode
    : undefined;
  const targetGenericArguments = abi.targetGenericArguments.flatMap((argument) => {
    if (argument.kind === "lifetime") return [];
    const planned = rustTargetCallGenericArgumentToAstInContext(argument, context);
    return planned === undefined ? [undefined] : [planned];
  });
  if (targetGenericArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-target-generic-arguments",
      "Provider operation target generic arguments do not have exact Rust target forms.",
    ));
    return undefined;
  }
  const concreteTargetGenericArguments = targetGenericArguments.length === 0
    ? undefined
    : targetGenericArguments as readonly RustCallGenericArgument[];
  switch (form.form) {
    case "numeric-cast":
      return args[0];
    case "marker":
      return undefined;
    case "arg-method": {
      if (receiver === undefined || abi.targetReceiver.kind !== "input") {
        return undefined;
      }
      const typedReceiver = typeNumericMethodReceiverLiteral(
        receiver,
        abi.targetReceiver.input.parameterCarrier,
      );
      if (typedReceiver === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, operationNode),
          "rust.backend.arg-method-receiver-type",
          "Argument-method literal receiver requires an explicit finalized Rust numeric receiver carrier.",
        ));
        return undefined;
      }
      return {
        kind: "method-call",
        receiver: typedReceiver,
        method: form.name,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      };
    }
    case "call": {
      registerAliasFromPath(context, form.path);
      return applyProviderOperationChain({
        kind: "call",
        path: form.path,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      }, form.chain);
    }
    case "source-module-construction": {
      const construction = context.input.program.sourceModuleConstructions.construction(
        operationNode,
      );
      if (construction === undefined ||
        construction.sourceArgumentIndex !== form.sourceArgumentIndex ||
        construction.targetArgumentIndex !== form.targetArgumentIndex) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, operationNode),
          "rust.backend.source-module-construction",
          "Selected source-module constructor has no matching sealed source-module construction.",
        ));
        return undefined;
      }
      const targetFileName = context.input.program.source.ast.getFileName(
        construction.targetSourceFile,
      );
      const entryIdentity = context.workerEntryIdentityByFileName.get(targetFileName);
      const moduleArgumentIndex = abi.targetArguments.findIndex(input =>
        isRustFinalizedSourceInput(input) && input.source.kind === "argument" &&
        input.source.sourceIndex === form.sourceArgumentIndex);
      const moduleInput = abi.targetArguments[moduleArgumentIndex];
      const moduleIdentity = moduleInput !== undefined && isRustFinalizedSourceInput(moduleInput) &&
          moduleInput.source.kind === "argument" &&
          moduleInput.source.sourceIndex === form.sourceArgumentIndex
        ? moduleInput.mode === "ref"
          ? { kind: "str-literal" as const, value: entryIdentity ?? "" }
          : moduleInput.mode === "value"
            ? { kind: "string-literal" as const, value: entryIdentity ?? "" }
            : undefined
        : undefined;
      if (entryIdentity === undefined || args[moduleArgumentIndex] === undefined ||
        moduleIdentity === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, operationNode),
          "rust.backend.source-module-entry-identity",
          "Selected source-module constructor has no exact generated worker-entry identity and immutable target argument mode.",
        ));
        return undefined;
      }
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
        : undefined;
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
      return args.length === 0 ? { kind: "path", path: form.path } : undefined;
    }
    case "reference-path": {
      registerAliasFromPath(context, form.path);
      return args.length === 0
        ? {
            kind: "reference",
            expr: { kind: "path", path: form.path },
            mutable: form.mutable,
          }
        : undefined;
    }
    case "static": {
      registerAliasFromPath(context, form.path);
      if (options.assignment) {
        const value = args[0];
        if (value === undefined || args.length !== 1) failRustPlannerInvariant("Admitted static setter requires its finalized native value.", operationNode);
        return { kind: "assignment", operator: "=", target: { kind: "path", path: form.path }, value };
      }
      return args.length === 0 ? { kind: "path", path: form.path } : undefined;
    }
    case "method":
    case "arg-receiver-method":
    case "receiver-value-array":
    case "receiver-tagged-array":
      return receiver === undefined
        ? undefined
        : {
            kind: "method-call",
            receiver,
            method: form.name,
            args,
            ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
            ...(receiverMode === undefined ? {} : { receiverMode }),
          };
    case "arg-structural-method": {
      if (receiver === undefined || abi.targetReceiver.kind !== "input") {
        return undefined;
      }
      return invokeRustStructuralObjectMethod(
        abi.targetReceiver.input.parameterCarrier,
        receiver,
        form.storageIndex,
        args,
        abiResultCarrier,
        context,
      );
    }
    case "receiver-method":
      return receiver === undefined
        ? undefined
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
        return undefined;
      }
      const place: RustExpr | undefined = form.form === "field"
        ? { kind: "field", receiver, name: form.name }
        : args[0] === undefined ? undefined : { kind: "index", receiver, index: args[0] };
      if (place === undefined) return undefined;
      if (options.resultUse === "storage") {
        return place;
      }
      if (isRustCopyCarrier(abiResultCarrier)) {
        return place;
      }
      if (!rustCarrierHasCloneContract(abiResultCarrier, context)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, operationNode),
          `rust.backend.provider-${form.form}-read-ownership`,
          `A provider ${form.form} read requires an exact Copy or Clone result-carrier contract.`,
        ));
        return undefined;
      }
      return { kind: "method-call", receiver: place, method: "clone", args: [] };
    }
    case "binary-operator": {
      const [left, right] = args;
      if (left === undefined || right === undefined || args.length !== 2) {
        return undefined;
      }
      return { kind: "binary", operator: form.operator, left, right };
    }
    case "associated-call": {
      const owner = rustCallTypeFromCarrierInContext(form.owner, context);
      return owner === undefined ? undefined : {
        kind: "associated-call", owner, method: form.method, args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      };
    }
    case "trait-call": {
      const owner = rustCallTypeFromCarrierInContext(form.owner, context);
      const traitGenericArguments = form.traitGenericArguments.map((argument) =>
        rustTargetGenericArgumentToAstInContext(argument, context));
      if (owner === undefined || traitGenericArguments.some((argument) => argument === undefined)) {
        return undefined;
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
        return undefined;
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
        return undefined;
      }
      return {
        kind: "associated-value",
        owner,
        name: form.name,
      };
    }
  }
}

function typeNumericMethodReceiverLiteral(
  expression: RustExpr,
  carrier: TargetTypeRef,
): RustExpr | undefined {
  if (expression.kind === "unary" && expression.operator === "-") {
    const operand = typeNumericMethodReceiverLiteral(expression.operand, carrier);
    return operand === undefined ? undefined : { ...expression, operand };
  }
  if (expression.kind !== "float-literal" && expression.kind !== "int-literal") {
    return expression;
  }
  if (carrier.kind !== "source-primitive") {
    return undefined;
  }
  const suffix = rustPrimitiveTypeName(carrier.name);
  return suffix === undefined
    ? undefined
    : { ...expression, text: `${expression.text}${suffix}` };
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
