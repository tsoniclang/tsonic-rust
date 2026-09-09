import type { Node, SourceFile } from "@tsonic/tsts";
import { createTsonicClosedArrayStorageQueries } from "@tsonic/source-core/facts";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { readRustRawLocation, selectRustNativeMemoryLayout } from "../../policy/operations/native-memory.js";
import { rustNativeBackingKey, rustNativeMemoryLayoutsEqual, rustRawLocationPlanKey, rustNativeArrayStorageKey } from "../../target-model/operations/native-memory.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import type { RustNativeObjectField } from "../../target-model/operations/native-memory.js";
import { rustSourceParameterAbiFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import { rustLocationTargetType, rustOptionTargetType, rustRawPointerTargetType, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
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
  const layout = selectRustNativeMemoryLayout(selected.layout, resolution, walk.operationOptions);
  if (layout?.kind === "unsupported-array") return reject(layout.reason);
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

export function recordRustNativeBacking(walk: RustFactWalk): readonly RustNativeObjectField[] {
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
          const carrier = context.facts.get(node, rustRuntimeCarrierKey)?.carrier;
          return carrier?.kind === "array" && rustTargetTypeRefEquals(carrier.element, layout.pointeeCarrier);
        }) && component.literals.every(node => {
          const value = context.facts.get(node, rustTargetOperationFactKey);
          return value?.kind === "array-literal" && value.lane === "native";
        }) && component.elements.every(element => {
          const value = context.facts.get(element.expression, rustTargetOperationFactKey);
          const receiver = context.facts.get(element.receiver.expression, rustRuntimeCarrierKey)?.carrier;
          return receiver?.kind === "array" && rustTargetTypeRefEquals(receiver.element, layout.pointeeCarrier) &&
            value?.kind === "provider-operation" && value.abi.target.form === "index" && value.abi.targetArguments.length === 1;
        }) && subjects.every(([node]) => {
          const previous = context.facts.get(node, rustNativeArrayStorageKey);
          return previous === undefined || previous.stride === descriptor.stride && rustNativeMemoryLayoutsEqual(previous.layout, layout);
        });
        if (!valid) { reject(origin.call, "Native array aliases require one exact element carrier, stride and layout."); continue; }
        for (const [node, kind] of subjects) context.facts.set(node, rustNativeArrayStorageKey,
          Object.freeze(kind === "element"
            ? { kind, declaration: component.declarations[0]!, layout, stride: descriptor.stride }
            : { kind, layout, stride: descriptor.stride }));
        continue;
      }
      const field = context.facts.get(origin.storageExpression, rustTargetOperationFactKey);
      if (field?.kind === "source-field" && field.storage === "object-handle") {
        const shape = rustStructuralObjectCarrierValue(field.receiverCarrier);
        const member = shape?.fields[field.storageIndex];
        const implementations = walk.sourceTypes.structuralFieldImplementations().filter(implementation =>
          implementation.storageIndex === field.storageIndex && rustTargetTypeRefEquals(implementation.carrier, field.receiverCarrier));
        if (member === undefined || member.readonly || member.presence !== "required" || member.accessor !== undefined ||
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
  return Object.freeze(fields);
}
