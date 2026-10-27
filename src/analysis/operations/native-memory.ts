import { requireRustRecord } from "../program/records/objects/required-records.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import { createTsonicClosedArrayStorageQueries } from "@tsonic/source-core/facts";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { selectRustNativeMemoryLayout } from "./pointers/native-memory.js";
import { readRustRawLocation } from "../../source/extension/native-memory.js";

import { rustNativeMemoryLayoutsEqual } from "../../target-model/operations/native-memory.js";

import type { RustNativeObjectField } from "../../target-model/operations/native-memory.js";

import { rustSourceLocationTargetType, rustOptionTargetType, rustRawPointerTargetType, rustStructuralObjectCarrierValue, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { setCarrierFact } from "./project-calls.js";
import { rustRuntimeNativeArrayTargetType } from "../../target-model/types/carriers/runtime-carriers.js";

export function resolveRustRawLocationCarrier(walk: RustFactWalk, expression: Node, file: SourceFile) {
  walk.context.records.assertOpen();
  const { context } = walk;
  const selected = readRustRawLocation(context.ast, context.source.sourceFacts, expression);
  if (selected === undefined) return undefined;
  const reject = (message: string) => {
    appendRustDiagnostic(walk, "RUST_RAW_LOCATION_NOT_PROVEN", message, expression, []);
    return { handled: true as const };
  };
  if (selected.kind === "rejected") return reject(selected.reason);
  const resolution = rustResolutionContext(walk, expression);
  const layout = selectRustNativeMemoryLayout(selected.layout, resolution, walk.operationOptions);
  if (layout?.kind === "unsupported-array") return reject(layout.reason);
  if (layout === undefined) return reject("The selected layout has no closed all-bit-pattern Rust native value representation.");
  if (selected.operation.operation === "reinterpret" && selected.operation.explicitPointeeTypeNode !== undefined) {
    const explicit = resolveRustTargetTypeRef(selected.operation.explicitPointeeTypeNode, resolution, walk.operationOptions);
    if (!rustTargetTypeRefEquals(explicit, layout.pointeeCarrier)) return reject("Reinterpretation and its layout have different exact Rust pointee types.");
  }
  const location = rustOptionTargetType(rustSourceLocationTargetType(layout.pointeeCarrier));
  const raw = rustOptionTargetType(rustRawPointerTargetType());
  const expected = selected.operation.operation === "to-raw" ? location : raw;
  const inputCarrier = resolveExpressionCarrier(walk, selected.expression, file, expected);
  if (inputCarrier === undefined) return reject("The raw conversion operand has no exact native carrier.");
  requireRustRecord(context.requiredRecords, "rawLocationPlan", expression, selected.operation.operation, "resolveRustRawLocationCarrier");
  context.records.rawLocations.conversion(expression, selected.operation.operation, selected.expression, inputCarrier, layout, rustOptionElementCarrier(inputCarrier) !== undefined);
  return { handled: true as const, carrier: setCarrierFact(walk, expression,
    selected.operation.operation === "to-raw" ? raw : location) };
}

export function recordRustNativeBacking(walk: RustFactWalk): readonly RustNativeObjectField[] {
  walk.context.records.assertOpen();
  const { context } = walk;
  const arrayStorage = createTsonicClosedArrayStorageQueries(context.source, 131_072);
  const fields: RustNativeObjectField[] = [];
  const reject = (node: Node, message: string): void => {
    appendRustDiagnostic(walk, "RUST_NATIVE_BACKING_NOT_PROVEN", message, node, []);
  };
  for (const issue of context.pointerBacking.issues()) reject(issue.node, issue.reason);
  for (const { origin, layout: descriptor } of context.pointerBacking.entries()) {
    const layout = selectRustNativeMemoryLayout(descriptor, rustResolutionContext(walk, origin.call), walk.operationOptions);
    if (layout?.kind === "unsupported-array") {
      reject(origin.call, layout.reason);
      continue;
    }
    if (layout === undefined) {
      reject(origin.call, "Physical backing requires an exact closed all-bit-pattern native layout.");
      continue;
    }
    if (origin.operation === "reinterpret") {
      const restored = context.records.rawLocationPlan.get(origin.call);
      if (restored === undefined || !rustNativeMemoryLayoutsEqual(layout, restored.layout)) {
        reject(origin.call, "The reinterpreted location does not prove the demanded physical layout.");
      }
      continue;
    }
    const operation = context.records.targetOperation.get(origin.call);
    if (operation?.kind !== "typed-location" || !rustTargetTypeRefEquals(operation.pointeeCarrier, layout.pointeeCarrier)) {
      reject(origin.call, "The physical origin and layout have different exact Rust value types.");
      continue;
    }
    let subject = origin.call;
    if (origin.operation === "address-of") {
      if (context.ast.is.IsElementAccessExpression(origin.storageExpression)) {
        const component = arrayStorage.resolve(origin.storageExpression);
        if (component.kind !== "closed") { reject(origin.call, component.reason); continue; }
        const subjects: [Node, "binding" | "reference" | "literal" | "element"][] = [
          ...component.declarations.map(node => [node, "binding"] as [Node, "binding"]),
          ...component.references.map(node => [node, "reference"] as [Node, "reference"]),
          ...component.literals.map(node => [node, "literal"] as [Node, "literal"]),
          ...component.elements.map(element => [element.expression, "element"] as [Node, "element"]),
        ];
        const valid = component.declarations.every(node => {
          const carrier = context.records.runtimeCarrier.get(node)?.carrier;
          return carrier?.kind === "array" && rustTargetTypeRefEquals(carrier.element, layout.pointeeCarrier);
        }) && component.literals.every(node => {
          const value = context.records.targetOperation.get(node);
          return value?.kind === "array-literal" && value.lane === "native";
        }) && component.elements.every(element => {
          const value = context.records.targetOperation.get(element.expression);
          const receiver = context.records.runtimeCarrier.get(element.receiver.expression)?.carrier;
          return receiver?.kind === "array" && rustTargetTypeRefEquals(receiver.element, layout.pointeeCarrier) &&
            value?.kind === "provider-operation" && value.abi.target.form === "index" && value.abi.targetArguments.length === 1;
        });
        if (valid) for (const [selectedSubject, kind] of subjects) {
          requireRustRecord(context.requiredRecords, "nativeArrayStorage", selectedSubject, kind, "recordRustNativeBacking");
        }
        if (!valid || !context.records.nativeArrays.promote(subjects, component.declarations[0]!, layout, descriptor.stride,
          rustRuntimeNativeArrayTargetType(layout.pointeeCarrier))) {
          reject(origin.call, "Native array aliases require one exact element carrier, stride and layout.");
          continue;
        }
        continue;
      }
      const field = context.records.targetOperation.get(origin.storageExpression);
      if (field?.kind === "source-field" && field.storage === "structural-object") {
        const shape = rustStructuralObjectCarrierValue(field.receiverCarrier);
        const member = shape?.fields[field.storageIndex];
        const implementations = walk.sourceTypes.structuralFieldImplementations().filter(implementation =>
          implementation.storageIndex === field.storageIndex && rustTargetTypeRefEquals(implementation.carrier, field.receiverCarrier));
        if (member === undefined || member.bound === true || member.readonly || member.presence !== "required" || member.accessor !== undefined ||
          field.valueSemantics.kind !== "stored" || field.dispatch !== undefined ||
          implementations.some(implementation => implementation.kind === "accessor") ||
          !rustTargetTypeRefEquals(member.type, layout.pointeeCarrier)) {
          reject(origin.call, "Native field backing requires one complete compiler-owned mutable data field.");
          continue;
        }
        const previous = fields.find(candidate => candidate.storageIndex === field.storageIndex &&
          rustTargetTypeRefEquals(candidate.owner, field.receiverCarrier));
        if (previous !== undefined && !rustNativeMemoryLayoutsEqual(previous.layout, layout)) {
          reject(origin.call, "One exact object field has incompatible native layout requirements.");
        } else if (previous === undefined) fields.push(Object.freeze({ owner: field.receiverCarrier, storageIndex: field.storageIndex, layout }));
        continue;
      }
      const declaration = context.source.navigation.sourceReferenceFor(origin.storageExpression)?.declaration;
      if (!context.ast.is.IsIdentifier(origin.storageExpression) || declaration === undefined ||
        (!context.ast.is.IsVariableDeclaration(declaration) && !context.ast.is.IsParameterDeclaration(declaration))) {
        reject(origin.call, "This addressable storage requires a native field, element, parameter or provider backing contract.");
        continue;
      }
      if (context.ast.is.IsParameterDeclaration(declaration)) {
        const owner = context.ast.parent(declaration);
        const abi = context.records.sourceParameterAbi.get(declaration);
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
    requireRustRecord(context.requiredRecords, "nativeBacking", subject, origin.operation, "recordRustNativeBacking");
    if (!context.records.nativeBackings.require(subject, layout)) {
      reject(origin.call, "One exact storage declaration has incompatible native layout requirements.");
    }
  }
  return Object.freeze(fields);
}
