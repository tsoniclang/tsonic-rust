import { requireRustRecord } from "../program/records/objects/required-records.js";

import { rustSourcePrimitiveTargetType, rustUnitTargetType } from "../../target-model/types/index.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { setCarrierFact } from "./project-calls.js";

import { readRustSourceNativePointerOperation, readRustSourceSafetyBuilder, readRustSourceUnsafeContext } from "../../source/extension/explicit-safety.js";

import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";

import { readRustReferenceOperation, resolvedRustReferenceOperationCarrier } from "./reference-operations.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";

import { readRustSourceRawAddress } from "../../source/extension/raw-addresses.js";
import { readRustRawLocation } from "../../source/extension/native-memory.js";
import { resolveRustRawLocationCarrier } from "./native-memory.js";
import { resolveRustMemoryBindingCarrier } from "./memory-bindings.js";
import { resolveTsonicMemoryLayoutObservation, selectTsonicMemoryFieldBinding, selectTsonicMemoryRecordBinding } from "@tsonic/source-core/facts";
import { resolveRustRawAddressCarrier, resolveRustRawPointerIdentityCarrier } from "./raw-addresses.js";
import { readRustSourceRawPointerIdentity } from "../../source/extension/raw-pointers.js";

import { readRustNativeControl, resolveRustNativeControl } from "./native-controls.js";

export function isSharedSourceMarkerOperation(
  walk: RustFactWalk,
  expression: Node,
): boolean {
  const sourceFacts = walk.context.source.sourceFacts;
  return readRustReferenceOperation(walk, expression) !== undefined ||
    readRustNativeControl(walk, expression) !== undefined ||
    selectTsonicMemoryFieldBinding(walk.context.ast, sourceFacts, expression) !== undefined ||
    selectTsonicMemoryRecordBinding(walk.context.ast, sourceFacts, expression) !== undefined ||
    readRustRawLocation(walk.context.ast, sourceFacts, expression) !== undefined ||
    resolveTsonicMemoryLayoutObservation(sourceFacts, expression) !== undefined ||
    readRustSourceRawPointerIdentity(expression, sourceFacts) !== undefined ||
    readRustSourceRawAddress(sourceFacts, expression) !== undefined ||
    readRustSourceNativePointerOperation(sourceFacts, expression) !== undefined ||
    readRustSourceUnsafeContext(sourceFacts, expression) !== undefined ||
    readRustSourceSafetyBuilder(sourceFacts, expression) !== undefined;
}

type RustSharedSourceMarkerCarrierResolution =
  | { readonly handled: false }
  | { readonly handled: true; readonly carrier?: TargetTypeRef };

export function resolveSharedSourceMarkerCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): RustSharedSourceMarkerCarrierResolution {
  const sourceFacts = walk.context.source.sourceFacts;
  const nativeControl = readRustNativeControl(walk, expression);
  if (nativeControl !== undefined) {
    return { handled: true, ...resolveRustNativeControl(walk, expression, sourceFile, nativeControl) };
  }
  const memoryBinding = resolveRustMemoryBindingCarrier(walk, expression, sourceFile);
  if (memoryBinding !== undefined) return memoryBinding;
  const rawLocation = resolveRustRawLocationCarrier(walk, expression, sourceFile);
  if (rawLocation !== undefined) return rawLocation;
  const layout = resolveTsonicMemoryLayoutObservation(sourceFacts, expression);
  if (layout !== undefined) {
    if (layout.kind === "rejected") {
      appendRustDiagnostic(walk, "RUST_MEMORY_LAYOUT_OBSERVATION_NOT_PROVEN", layout.reason, expression, []);
      return { handled: true };
    }
    requireRustRecord(walk.context.requiredRecords, "memoryLayoutObservation", expression, "native-layout", "analysis/source-evidence/types/resolution/references.ts");
    walk.context.records.memoryLayoutObservations.observe(expression, layout.value);
    return { handled: true, carrier: setCarrierFact(walk, expression, rustSourcePrimitiveTargetType("native-uint")) };
  }
  const rawIdentity = readRustSourceRawPointerIdentity(expression, sourceFacts);
  if (rawIdentity !== undefined) {
    return { handled: true, ...resolveRustRawPointerIdentityCarrier(walk, expression, sourceFile, rawIdentity) };
  }
  const rawAddress = readRustSourceRawAddress(sourceFacts, expression);
  if (rawAddress !== undefined) {
    return { handled: true, ...resolveRustRawAddressCarrier(walk, expression, sourceFile, rawAddress) };
  }
  const referenceOperation = readRustReferenceOperation(walk, expression);
  if (referenceOperation !== undefined) {
    return {
      handled: true,
      ...resolvedRustReferenceOperationCarrier(
        walk,
        expression,
        sourceFile,
        referenceOperation,
        expected,
      ),
    };
  }
  const nativePointer = readRustSourceNativePointerOperation(
    sourceFacts,
    expression,
  );
  if (nativePointer !== undefined) {
    return {
      handled: true,
      ...resolvedNativePointerCarrier(
        walk,
        expression,
        sourceFile,
        nativePointer,
      ),
    };
  }
  const unsafeContext = readRustSourceUnsafeContext(sourceFacts, expression);
  if (unsafeContext !== undefined) {
    if (unsafeContext.kind === "remaining-block") {
      return {
        handled: true,
        carrier: setCarrierFact(walk, expression, rustUnitTargetType()),
      };
    }
    const carrier = resolveExpressionCarrier(
      walk,
      unsafeContext.expression,
      sourceFile,
      expected,
    );
    return {
      handled: true,
      ...(carrier === undefined
        ? {}
        : { carrier: setCarrierFact(walk, expression, carrier) }),
    };
  }
  if (readRustSourceSafetyBuilder(sourceFacts, expression) !== undefined) {
    return {
      handled: true,
      carrier: setCarrierFact(walk, expression, rustUnitTargetType()),
    };
  }
  return { handled: false };
}

function resolvedNativePointerCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  source: import("@tsonic/source-core/facts").TsonicNativePointerOperationFact,
): { readonly carrier?: TargetTypeRef } {
  const pointerCarrier = resolveExpressionCarrier(
    walk,
    source.pointerExpression,
    sourceFile,
    undefined,
  );
  if (pointerCarrier?.kind !== "pointer") {
    appendRustDiagnostic(
      walk,
      "RUST_NATIVE_POINTER_OPERATION_NOT_MAPPED",
      `Rust native-pointer '${source.operation}' requires one exact native-pointer operand carrier.`,
      expression,
      ["target.capability=rust.native-pointer.exact-operand"],
    );
    return {};
  }
  if (source.explicitPointeeTypeNode !== undefined) {
    const explicitPointee = resolveRustTargetTypeRef(
      source.explicitPointeeTypeNode,
      rustResolutionContext(walk, source.explicitPointeeTypeNode),
      walk.operationOptions,
    );
    if (!rustTargetTypeRefEquals(explicitPointee, pointerCarrier.pointee)) {
      appendRustDiagnostic(
        walk,
        "RUST_NATIVE_POINTER_POINTEE_CONFLICT",
        "The authored pointee type and selected native-pointer operand do not have one exact Rust representation.",
        expression,
        ["target.capability=rust.native-pointer.exact-pointee"],
      );
      return {};
    }
  }
  let resultCarrier: TargetTypeRef;
  let fact: Extract<RustTargetOperationFact, { readonly kind: "native-pointer" }>;
  switch (source.operation) {
    case "load":
      resultCarrier = pointerCarrier.pointee;
      fact = {
        kind: "native-pointer",
        operationId: "tsonic.rust.native-pointer.load",
        operation: source.operation,
        pointerExpression: source.pointerExpression,
        pointerCarrier,
        pointeeCarrier: pointerCarrier.pointee,
        resultCarrier,
      };
      break;
    case "store": {
      const valueCarrier = resolveExactNativePointerOperandCarrier(
        walk,
        source.valueExpression,
        sourceFile,
        pointerCarrier.pointee,
      );
      if (!rustTargetTypeRefEquals(valueCarrier, pointerCarrier.pointee)) {
        appendRustDiagnostic(
          walk,
          "RUST_NATIVE_POINTER_STORE_VALUE_CONFLICT",
          "The selected native-pointer store value does not have the exact pointee carrier.",
          expression,
          ["target.capability=rust.native-pointer.exact-store"],
        );
        return {};
      }
      resultCarrier = rustUnitTargetType();
      fact = {
        kind: "native-pointer",
        operationId: "tsonic.rust.native-pointer.store",
        operation: source.operation,
        pointerExpression: source.pointerExpression,
        pointerCarrier,
        pointeeCarrier: pointerCarrier.pointee,
        valueExpression: source.valueExpression,
        valueCarrier,
        resultCarrier,
      };
      break;
    }
    case "offset": {
      const nativeIntCarrier = rustSourcePrimitiveTargetType("native-int");
      const offsetCarrier = resolveExactNativePointerOperandCarrier(
        walk,
        source.offsetExpression,
        sourceFile,
        nativeIntCarrier,
      );
      if (!rustTargetTypeRefEquals(offsetCarrier, nativeIntCarrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_NATIVE_POINTER_OFFSET_TYPE_CONFLICT",
          "The selected native-pointer element offset is not exactly native-int in Rust.",
          expression,
          ["target.capability=rust.native-pointer.exact-offset"],
        );
        return {};
      }
      resultCarrier = pointerCarrier;
      fact = {
        kind: "native-pointer",
        operationId: "tsonic.rust.native-pointer.offset",
        operation: source.operation,
        pointerExpression: source.pointerExpression,
        pointerCarrier,
        pointeeCarrier: pointerCarrier.pointee,
        offsetExpression: source.offsetExpression,
        offsetCarrier,
        resultCarrier,
      };
      break;
    }
  }
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/source-evidence/types/resolution/references.ts");
  walk.context.records.targetOperations.source(expression, fact);
  return { carrier: setCarrierFact(walk, expression, resultCarrier) };
}

function resolveExactNativePointerOperandCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  contextualCarrier: TargetTypeRef,
): TargetTypeRef | undefined {
  // The operand keeps its own carrier: a native-pointer store value or offset is never converted to fit the pointer.
  return resolveExpressionCarrier(walk, expression, sourceFile, undefined) ??
    resolveExpressionCarrier(walk, expression, sourceFile, contextualCarrier);
}
