import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustLifetimeSemanticKey } from "../../../target-model/semantics/index.js";
import {
  getRustGeneratorProtocol,
  rustCallableProtocol,
  rustCallableSignature,
  rustCallableSignaturesAlphaEquivalent,
} from "../../../target-model/types/index.js";
import type { RustType } from "../../target-ast/nodes.js";
import { rustReturnTypeFromCarrierInContext } from "../types/render.js";
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
  return left !== undefined && right !== undefined &&
    rustCallableSignaturesAlphaEquivalent(left, right);
}

export function rustGeneratorExecutionCarrier(
  callable: Node,
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
  const selected = context.input.program.ownership.executionCarrierFor(callable);
  const protocol = getRustGeneratorProtocol(selected);
  if (protocol === undefined || protocol.kind !== kind) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, callable),
      "rust.backend.generator-execution-carrier",
      "Generator lowering requires one exact ownership-finalized generator carrier.",
    ));
    return undefined;
  }
  const expectedLifetime = protocol.lifetime ?? { kind: "static" as const };
  if (execution.kind !== "local" || execution.storage !== protocol.storage ||
    rustLifetimeSemanticKey(execution.lifetime) !== rustLifetimeSemanticKey(expectedLifetime) ||
    execution.requiresSend || execution.requiresSync) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, callable),
      "rust.backend.threaded-generator-carrier",
      "The finalized generator carrier conflicts with its sealed ownership execution contract.",
    ));
    return undefined;
  }
  const ownedPath = kind === "sync" ? "rt::OwnedGenerator" : "rt::OwnedAsyncGenerator";
  const borrowedPath = kind === "sync" ? "rt::BorrowedGenerator" : "rt::BorrowedAsyncGenerator";
  const expectedPath = protocol.storage === "owned" ? ownedPath : borrowedPath;
  const returnType = rustReturnTypeFromCarrierInContext(selected, context);
  if (returnType?.kind !== "named" || returnType.path !== expectedPath) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, callable),
      "rust.backend.generator-carrier",
      "The exact finalized generator carrier cannot be rendered as its selected Rust runtime family.",
    ));
    return undefined;
  }
  return Object.freeze({
    returnType,
    constructorPath: `${expectedPath}::new`,
  });
}
