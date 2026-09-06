import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { readRustRawLocation, selectRustNativeMemoryLayout } from "../../policy/operations/native-memory.js";
import { rustNativeBackingKey, rustNativeMemoryLayoutsEqual, rustRawLocationPlanKey } from "../../target-model/operations/native-memory.js";
import { rustSourceParameterAbiFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import { rustLocationTargetType, rustOptionTargetType, rustRawPointerTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { setCarrierFact } from "./project-calls.js";

export function resolveRustRawLocationCarrier(walk: RustFactWalk, expression: Node, file: SourceFile) {
  const { context } = walk;
  const selected = readRustRawLocation(context.ast, context.source.sourceFacts, expression);
  if (selected === undefined) return undefined;
  const reject = (message: string) => {
    appendRustDiagnostic(walk, "RUST_RAW_LOCATION_NOT_PROVEN", message, expression, []);
    return { handled: true as const };
  };
  if (selected.kind === "rejected") return reject(selected.reason);
  const resolution = rustResolutionContext(walk, expression);
  const pointee = resolveRustTargetTypeRef(selected.layout.explicitTypeNode ?? selected.layout.sourceType,
    resolution, walk.operationOptions);
  const layout = selectRustNativeMemoryLayout(pointee, selected.layout);
  if (layout === undefined) return reject("The selected layout has no closed all-bit-pattern Rust native value representation.");
  if (selected.operation.operation === "reinterpret" && selected.operation.explicitPointeeTypeNode !== undefined) {
    const explicit = resolveRustTargetTypeRef(selected.operation.explicitPointeeTypeNode, resolution, walk.operationOptions);
    if (!rustTargetTypeRefEquals(explicit, layout.pointeeCarrier)) return reject("Reinterpretation and its layout have different exact Rust pointee types.");
  }
  const location = rustOptionTargetType(rustLocationTargetType(layout.pointeeCarrier));
  const raw = rustOptionTargetType(rustRawPointerTargetType());
  const expected = selected.operation.operation === "to-raw" ? location : raw;
  const inputCarrier = resolveExpressionCarrier(walk, selected.expression, file, expected);
  if (inputCarrier === undefined) return reject("The raw conversion operand has no exact native carrier.");
  context.facts.set(expression, rustRawLocationPlanKey, Object.freeze({
    operation: selected.operation.operation, expression: selected.expression, inputCarrier, layout,
  }));
  return { handled: true as const, carrier: setCarrierFact(walk, expression,
    selected.operation.operation === "to-raw" ? raw : location) };
}

export function recordRustNativeBacking(walk: RustFactWalk): void {
  const { context } = walk;
  const reject = (node: Node, message: string): void => {
    appendRustDiagnostic(walk, "RUST_NATIVE_BACKING_NOT_PROVEN", message, node, []);
  };
  for (const issue of context.pointerBacking.issues()) reject(issue.node, issue.reason);
  for (const { origin, layout: descriptor } of context.pointerBacking.entries()) {
    const pointee = resolveRustTargetTypeRef(descriptor.explicitTypeNode ?? descriptor.sourceType,
      rustResolutionContext(walk, origin.call), walk.operationOptions);
    const layout = selectRustNativeMemoryLayout(pointee, descriptor);
    if (layout === undefined) {
      reject(origin.call, "Physical backing requires an exact closed all-bit-pattern native layout.");
      continue;
    }
    if (origin.operation === "reinterpret") {
      const restored = context.facts.get(origin.call, rustRawLocationPlanKey);
      if (restored === undefined || !rustNativeMemoryLayoutsEqual(layout, restored.layout)) {
        reject(origin.call, "The reinterpreted location does not prove the demanded physical layout.");
      }
      continue;
    }
    const operation = context.facts.get(origin.call, rustTargetOperationFactKey);
    if (operation?.kind !== "typed-location" || !rustTargetTypeRefEquals(operation.pointeeCarrier, layout.pointeeCarrier)) {
      reject(origin.call, "The physical origin and layout have different exact Rust value types.");
      continue;
    }
    let subject = origin.call;
    if (origin.operation === "address-of") {
      const declaration = context.source.navigation.sourceReferenceFor(origin.storageExpression)?.declaration;
      if (!context.ast.is.IsIdentifier(origin.storageExpression) || declaration === undefined ||
        (!context.ast.is.IsVariableDeclaration(declaration) && !context.ast.is.IsParameterDeclaration(declaration))) {
        reject(origin.call, "This addressable storage requires a native field, element, parameter or provider backing contract.");
        continue;
      }
      if (context.ast.is.IsParameterDeclaration(declaration)) {
        const owner = context.ast.parent(declaration);
        const abi = context.facts.get(declaration, rustSourceParameterAbiFactKey);
        if (owner === undefined || (!context.ast.is.IsFunctionDeclaration(owner) && !context.ast.is.IsMethodDeclaration(owner)) ||
          context.ast.body(owner) === undefined || abi?.mode !== "value" ||
          !rustTargetTypeRefEquals(abi.valueCarrier, layout.pointeeCarrier)) {
          reject(origin.call, "Native parameter backing requires an exact by-value source function or method parameter.");
          continue;
        }
      } else {
        const list = context.ast.parent(declaration);
        const statement = list === undefined ? undefined : context.ast.parent(list);
        const container = statement === undefined ? undefined : context.ast.parent(statement);
        if (statement === undefined || !context.ast.is.IsVariableStatement(statement) ||
          container === undefined || !context.ast.is.IsBlock(container) ||
          context.ast.as.AsVariableDeclaration(declaration)?.Initializer === undefined) {
          reject(origin.call, "Native local backing requires an initialized block-local binding.");
          continue;
        }
      }
      subject = declaration;
    }
    const previous = context.facts.get(subject, rustNativeBackingKey);
    if (previous !== undefined && !rustNativeMemoryLayoutsEqual(previous, layout)) {
      reject(origin.call, "One exact storage declaration has incompatible native layout requirements.");
    } else context.facts.set(subject, rustNativeBackingKey, layout);
  }
}
