import type { Node } from "@tsonic/tsts";
import { Node_Expression, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustNativeInputPlace, RustNativePlace } from "../../target-model/records/ownership.js";
import type { RustCallableEmissionContexts, RustPhysicalEmissionOperand } from "../../target-model/records/physical-emission-contexts.js";
import type { RustStatementCompletionIndex } from "../../target-model/records/statement-completion.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustCopyCarrier } from "../../target-model/types/index.js";
import type { RustGenericCallablePlan } from "../callables/generic-values.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import { rustTargetOperationIsDirectLocation } from "../operations/target-operation.js";
import { rustNativeStorageProjections, rustNativeStorageRoot,
  type RustNativeStoragePathInput } from "../storage/native-paths.js";
import { selectRustValueReadOwnership } from "../../policy/ownership/value-read.js";
import { providerSourceInputKey } from "../operations/provider-source-inputs.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export interface RustNativePlaceInput extends RustNativeStoragePathInput {
  readonly definitions: RustTypeDefinitions;
  readonly genericCallables: RustGenericCallablePlan;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
}

export type RustNativePlaceSelection =
  | { readonly kind: "resolved"; readonly place: RustNativePlace }
  | { readonly kind: "unresolved"; readonly node: Node; readonly reason: string };

export function analyzeRustNativePlaces(input: RustNativePlaceInput & {
  readonly physicalEmissionContexts: RustCallableEmissionContexts;
  readonly statementCompletions: Pick<RustStatementCompletionIndex, "setterFor">;
}): { readonly kind: "resolved"; readonly places: ReadonlyMap<TargetUseSiteRef, RustNativeInputPlace> }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const places = new Map<TargetUseSiteRef, RustNativeInputPlace>();
  const diagnostics: TargetDiagnostic[] = [];
  const reject = (node: Node, message: string): void => {
    diagnostics.push({ code: "RUST_NATIVE_INPUT_PLACE_NOT_CLOSED", category: "error", source: "tsonic-rust",
      sourceNode: node, message, evidence: ["target.capability=rust.native-provider.exact-input-place"] });
  };
  for (const operand of input.physicalEmissionContexts.operands) {
    const origin = operand.origin;
    if (origin.kind !== "call-input") continue;
    const operationNode = origin.operationNode;
    const operation = origin.operation;
    const value = origin.input;
    const occurrence = input.physicalEmissionContexts.sourceFor(operationNode, operation);
    const context = input.physicalEmissionContexts.contextFor(operand.context.use);
    if (occurrence === undefined || occurrence.node !== operationNode || occurrence.operation !== operation ||
      context !== operand.context || input.physicalEmissionContexts.operandFor(operand.use) !== operand || places.has(operand.use)) {
      reject(operationNode, "A native input place requires its original operation, physical context and input-use identity.");
      continue;
    }
    const rows = occurrence.inputs.filter(row => row.input === value);
    const slots = new Set(rows.map(row => row.slot));
    if (slots.size !== 1) {
      reject(operationNode, "A native input place requires one original source slot for its exact finalized input.");
      continue;
    }
    const slot = slots.values().next().value!;
    const key = providerSourceInputKey(value);
    if (!occurrence.slots.includes(slot) || slot.operation !== operation || slot.operationNode !== operationNode ||
      slot.key !== key || slot.node !== operand.node) {
      reject(operationNode, "A native input place lost its exact authored source operand correspondence.");
      continue;
    }
    if (operation.kind === "runtime-set") {
      const setter = input.statementCompletions.setterFor(operationNode);
      if (setter === undefined || (value.source.kind === "receiver" ? setter.receiver
        : setter.sourceArguments[value.source.sourceIndex]) !== slot.node) {
        reject(operationNode, "A native setter input place requires the original admitted setter source operand.");
        continue;
      }
    }
    const carrier = input.physicalEmissionContexts.carrierFor(operand.use, value.sourceCarrier);
    if (carrier === undefined || !rustTargetTypeRefEquals(carrier, operand.carrier)) {
      reject(slot.node, "A native input place has no exact selected source carrier for its actual use.");
      continue;
    }
    let node = slot.node;
    const marker = input.records.targetOperation.get(node);
    if (marker?.kind === "flow-marker" && value.mode !== "value") {
      const arguments_ = [...input.ast.arguments(node)];
      const state = value.mode === "mut-ref" ? "borrowed-mut" : "borrowed-shared";
      if (marker.state !== state || arguments_.length !== 1 || arguments_[0] === undefined) {
        reject(node, "A native borrowed input place requires its exact finalized source borrow operand.");
        continue;
      }
      node = arguments_[0];
    }
    const selection = selectRustNativePlace(node, operand, input);
    if (selection.kind === "unresolved") reject(selection.node, selection.reason);
    else places.set(operand.use, Object.freeze({ input: value, key, node, slot, operand, place: selection.place }));
  }
  return diagnostics.length > 0 ? { kind: "rejected", diagnostics }
    : { kind: "resolved", places };
}

export function selectRustNativePlace(
  node: Node,
  operand: RustPhysicalEmissionOperand,
  input: RustNativePlaceInput,
): RustNativePlaceSelection {
  const { ast, records } = input;
  const unresolved = (reason: string): RustNativePlaceSelection => Object.freeze({ kind: "unresolved", node, reason });
  const root = rustNativeStorageRoot(node, input);
  const projections = root === undefined ? undefined : rustNativeStorageProjections(node, root, input);
  const sourcePath = root === undefined || projections === undefined ? undefined
    : Object.freeze({ declaration: root, projections });
  const resolved = (storage: RustNativePlace["storage"]): RustNativePlaceSelection => Object.freeze({
    kind: "resolved", place: Object.freeze({ node, operand, carrier: operand.carrier, sourcePath,
      storage: Object.freeze(storage) }),
  });
  let current = node;
  const visited = new Set<Node>();
  let rootExpression: Node | undefined;
  while (!visited.has(current)) {
    visited.add(current);
    const native = records.nativeArrayStorage.get(current);
    if (native?.kind === "element") return resolved({ kind: "promoted", expression: current,
      declaration: native.declaration, storage: "native-array" });
    if (native !== undefined) break;
    const transparent = sourceTransparentExpressionOperand(ast, current);
    if (transparent !== undefined) {
      current = transparent;
      continue;
    }
    if (ast.is.IsIdentifier(current)) {
      rootExpression = current;
      break;
    }
    if (!ast.is.IsPropertyAccessExpression(current) && !ast.is.IsElementAccessExpression(current)) break;
    const receiver = Node_Expression(ast, current);
    if (receiver === undefined) return unresolved("A native place projection has no exact source receiver.");
    current = receiver;
  }
  if (rootExpression !== undefined) {
    const binding = records.sourceBinding.get(rootExpression);
    if (binding !== undefined) {
      const storage = records.bindingStorage.get(binding.sourceDeclaration);
      if (storage !== undefined) return resolved({ kind: "promoted", expression: rootExpression,
        declaration: binding.sourceDeclaration, storage: storage.storage });
      if (records.moduleBinding.get(binding.sourceDeclaration)?.storage === "module-cell") return resolved({
        kind: "promoted", expression: rootExpression, declaration: binding.sourceDeclaration, storage: "module-cell",
      });
    }
  }
  let value = node;
  const wrappers = new Set<Node>();
  while (!wrappers.has(value)) {
    wrappers.add(value);
    const inner = sourceTransparentExpressionOperand(ast, value);
    if (inner === undefined) break;
    value = inner;
  }
  const operation = records.targetOperation.get(value);
  const field = operation?.kind === "source-field" && operation.storage === "project-object" &&
    operation.valueSemantics.kind === "stored" && operation.dispatch === undefined ? operation : undefined;
  const definition = field === undefined ? undefined : input.projectTypes.definitionForCarrier(field.receiverCarrier);
  const representation = input.objectRepresentations.representationFor(definition);
  if (field !== undefined && representation !== undefined && representation.kind !== "value" &&
    representation.kind !== "shared-immutable") {
    const receiverNode = Node_Expression(ast, value);
    if (receiverNode === undefined || definition === undefined || input.projectTypes.isPolymorphic(definition))
      return unresolved("A mutable native project field requires its exact non-polymorphic physical owner.");
    const external = input.projectTypes.externalBaseForDefinition(definition)?.fields ?? [];
    const layout = input.projectTypes.objectLayoutForDefinition(definition);
    const declaration = field.storageIndex < external.length
      ? external.find(selected => selected.storageIndex === field.storageIndex)?.declaration
      : layout?.fields.find(selected => external.length + selected.storageIndex === field.storageIndex)?.declaration;
    const name = declaration === undefined ? undefined : input.projectTypes.fieldStorageName(definition, declaration);
    if (name === undefined) return unresolved("A mutable native project field has no admitted physical storage path.");
    return resolved({ kind: "project-field", receiverNode,
      rootDeclaration: rustNativeStorageRoot(receiverNode, input), storagePath: Object.freeze([name]) });
  }
  const kind = ast.kindName(value);
  const absence = operation?.kind === "option-none" || records.optionProjection.get(value)?.kind === "none";
  const direct = ast.is.IsIdentifier(value) && records.sourceBinding.get(value) !== undefined ||
    kind === "KindThisExpression" || kind === "KindThisKeyword" || rustTargetOperationIsDirectLocation(operation) ||
    field !== undefined && representation?.kind === "value";
  if (direct) {
    return resolved({ kind: "direct" });
  }
  if (ast.is.IsIdentifier(value) && !absence || field !== undefined) return unresolved(
    "A native stored input requires its exact admitted storage representation; failed place selection does not create an owned temporary.");
  const produced = absence || ast.is.IsCallExpression(value) || ast.is.IsNewExpression(value) ||
    operation?.kind === "source-field" && operation.valueSemantics.kind === "accessor" && operation.accessMode === "read" ||
    operation?.kind === "provider-operation" &&
      operation.abi.target.form !== "field" && operation.abi.target.form !== "index" && operation.abi.target.form !== "static" ||
    nativeValueExpressionKinds.has(kind);
  if (!produced) return unresolved("The selected native expression has no positive owned-value formation or admitted storage place.");
  const copy = isRustCopyCarrier(operand.carrier,
    carrier => input.genericCallables.definitionFor(carrier)?.copy === true);
  const read = selectRustValueReadOwnership({ copy, clone: false, transfer: true });
  return read === undefined || read.kind === "borrow"
    ? unresolved("A native temporary input has no selected owned physical value read.")
    : resolved({ kind: "owned", read });
}

const nativeValueExpressionKinds: ReadonlySet<string> = new Set([
  "KindNumericLiteral", "KindStringLiteral", "KindBigIntLiteral", "KindNoSubstitutionTemplateLiteral",
  "KindTrueKeyword", "KindFalseKeyword", "KindNullKeyword", "KindArrayLiteralExpression",
  "KindObjectLiteralExpression", "KindArrowFunction", "KindFunctionExpression", "KindConditionalExpression",
  "KindBinaryExpression", "KindPrefixUnaryExpression", "KindPostfixUnaryExpression", "KindTemplateExpression",
]);
