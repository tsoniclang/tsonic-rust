import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustLifetimeSemanticKey } from "../../../target-model/semantics/index.js";
import {
  rustCallableProtocol,
  rustCallableSignature,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustGenericArgument, RustType } from "../../target-ast/nodes.js";
import { rustAstLifetimeFromSemantic } from "../types/render.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";

export interface RustGeneratorExecutionCarrier {
  readonly returnType: RustType;
  readonly constructorPath: string;
}

export function rustCallableExecutionCarrier(
  callable: Node,
  carrier: TargetTypeRef,
  context: RustPlanContext,
): TargetTypeRef | undefined {
  const execution = context.input.program.ownership.executionContractFor(callable);
  if (execution === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, callable),
      "rust.backend.callable-execution-contract",
      "Callable lowering requires one sealed ownership execution contract.",
    ));
    return undefined;
  }
  const selected = context.input.program.ownership.executionCarrierFor(callable);
  if (selected === undefined || !callableSignaturesEqual(carrier, selected)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, callable),
      "rust.backend.callable-execution-carrier",
      "Callable lowering requires one exact ownership-finalized execution carrier with the selected source signature.",
    ));
    return undefined;
  }
  const protocol = rustCallableProtocol(selected);
  if (protocol === undefined) return selected;
  const expectedDomain = protocol.storage === "threaded" ? "threaded" : "local";
  const expectedStorage = protocol.storage === "borrowed-local" ? "borrowed" : "owned";
  const expectedLifetime = protocol.lifetime ?? { kind: "static" as const };
  if (execution.kind !== expectedDomain || execution.storage !== expectedStorage ||
    rustLifetimeSemanticKey(execution.lifetime) !== rustLifetimeSemanticKey(expectedLifetime) ||
    execution.requiresSend !== (protocol.storage === "threaded") ||
    execution.requiresSync !== (protocol.storage === "threaded")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, callable),
      "rust.backend.callable-execution-carrier",
      "The finalized callable carrier conflicts with its sealed ownership execution contract.",
    ));
    return undefined;
  }
  return selected;
}

function callableSignaturesEqual(
  leftCarrier: TargetTypeRef,
  rightCarrier: TargetTypeRef,
): boolean {
  const left = rustCallableSignature(leftCarrier);
  const right = rustCallableSignature(rightCarrier);
  if (left === undefined || right === undefined) return false;
  return rustTargetTypeRefEquals({
    kind: "function-pointer",
    ...(left.binder === undefined ? {} : { binder: left.binder }),
    safety: "safe",
    abi: "Rust",
    parameters: left.parameters,
    variadic: false,
    result: left.result,
  }, {
    kind: "function-pointer",
    ...(right.binder === undefined ? {} : { binder: right.binder }),
    safety: "safe",
    abi: "Rust",
    parameters: right.parameters,
    variadic: false,
    result: right.result,
  });
}

export function rustGeneratorExecutionCarrier(
  callable: Node,
  returnType: RustType | undefined,
  kind: "sync" | "async",
  context: RustPlanContext,
): RustGeneratorExecutionCarrier | undefined {
  const execution = context.input.program.ownership.executionContractFor(callable);
  if (execution === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, callable),
      "rust.backend.generator-execution-contract",
      "Generator lowering requires one sealed ownership execution contract.",
    ));
    return undefined;
  }
  if (execution.kind !== "local") {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, callable),
      "rust.backend.threaded-generator-carrier",
      "The selected generator execution contract requires a threaded carrier that is not represented by the finalized generator ABI.",
    ));
    return undefined;
  }
  const ownedPath = kind === "sync" ? "rt::OwnedGenerator" : "rt::OwnedAsyncGenerator";
  const borrowedPath = kind === "sync" ? "rt::BorrowedGenerator" : "rt::BorrowedAsyncGenerator";
  if (returnType?.kind !== "named" ||
    (returnType.path !== ownedPath && returnType.path !== borrowedPath)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, callable),
      "rust.backend.generator-carrier",
      "Generator return type does not match its finalized Rust runtime carrier family.",
    ));
    return undefined;
  }
  if (execution.storage === "owned") {
    if (execution.lifetime.kind !== "static") {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, callable),
        "rust.backend.owned-generator-lifetime",
        "An owned generator execution contract must carry the exact static lifetime.",
      ));
      return undefined;
    }
    return Object.freeze({
      returnType: {
        ...returnType,
        path: ownedPath,
        genericArguments: stripBorrowedLifetime(returnType, borrowedPath),
      },
      constructorPath: `${ownedPath}::new`,
    });
  }
  const lifetimeArgument: RustGenericArgument = {
    kind: "lifetime",
    lifetime: rustAstLifetimeFromSemantic(execution.lifetime),
  };
  return Object.freeze({
    returnType: {
      ...returnType,
      path: borrowedPath,
      genericArguments: [
        lifetimeArgument,
        ...stripBorrowedLifetime(returnType, borrowedPath),
      ],
    },
    constructorPath: `${borrowedPath}::new`,
  });
}

function stripBorrowedLifetime(
  type: Extract<RustType, { readonly kind: "named" }>,
  borrowedPath: string,
): readonly import("../../target-ast/nodes.js").RustGenericArgument[] {
  const argumentsList = type.genericArguments ?? [];
  return type.path === borrowedPath && argumentsList[0]?.kind === "lifetime"
    ? argumentsList.slice(1)
    : argumentsList;
}
