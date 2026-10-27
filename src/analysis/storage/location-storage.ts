import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { BinaryExpression_Left, ElementAccessExpression_ArgumentExpression, Node_Expression, Node_Operand, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustLocationStorageProducer } from "../program/records/storage/location-storage.js";
import type { RustLocationProjection } from "../../target-model/records/storage/location-storage.js";
import { rustIndexedLocationContract } from "../../policy/operations/members/abi/indexed-location.js";
import { isRustFinalizedSourceInput } from "../../target-model/operations/finalized-inputs.js";
import { rustLocationTargetId } from "../../target-model/types/carriers/source-types.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

export function analyzeRustLocationStorage(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustLocationStorageProducer,
  analysisRecords: Pick<import("../../target-model/records/analysis.js").RustAnalysisRecords, "typedLocationPlan">,
  requirements: RustRequiredRecord[]): readonly TargetDiagnostic[] {
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  const selected = new Map<Node, RustLocationProjection>();
  const reasons = new Map<Node, string>();
  const emitted = new Set<Node>();
  const active = new Set<Node>();
  const refuse = (node: Node, message: string): void => {
    if (emitted.has(node)) return;
    emitted.add(node);
    issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: ["target.capability=rust.backend.typed-location-storage"] });
  };
  const select = (node: Node): RustLocationProjection | undefined => {
    const previous = selected.get(node);
    if (previous !== undefined || reasons.has(node)) return previous;
    if (active.has(node)) return undefined;
    active.add(node);
    const native = program.records.nativeArrayStorage.get(node);
    const operation = program.records.targetOperation.get(node);
    const receiver = Node_Expression(ast, node);
    const root = program.records.locationStorageRoot.get(node);
    const field = operation?.kind === "source-field" && operation.storage === "structural-object"
      ? program.records.structuralFieldStorage.get(operation.receiverCarrier, operation.storageIndex) : undefined;
    let value: RustLocationProjection | undefined;
    let reason: string | undefined;
    if (native?.kind === "element") value = { kind: "native-array" };
    else if (field?.field.nativeLayout !== undefined && receiver !== undefined && field.location !== undefined)
      value = { kind: "structural-field", receiver, name: field.field.targetName, carrier: field.location };
    else if (root?.expression === node || ast.is.IsIdentifier(node) && program.records.sourceBinding.get(node) !== undefined)
      value = { kind: "root" };
    else if (ast.is.IsParenthesizedExpression(node)) {
      if (receiver !== undefined) value = { kind: "parenthesized", inner: receiver };
      else reason = "The finalized parenthesized storage has no inner expression.";
    } else if (receiver === undefined) reason = "The finalized projected storage has no exact receiver expression.";
    else if (ast.is.IsElementAccessExpression(node) && operation?.kind === "provider-operation" && operation.indexedLocationMethod !== undefined) {
      const contract = rustIndexedLocationContract(operation, program.typeDefinitions);
      const index = ElementAccessExpression_ArgumentExpression(ast, node);
      if (contract !== undefined && index !== undefined) value = { kind: "indexed-method", receiver, index, input: contract.index, method: contract.method };
      else reason = "The selected index location has no exact finalized receiver, value and index input contract.";
    } else if (ast.is.IsPropertyAccessExpression(node) && operation?.kind === "source-field" && operation.valueSemantics.kind === "stored") {
      const dispatch = operation.declaration === undefined ? undefined : program.records.projectFieldDispatch.get(operation.declaration);
      const stored = program.records.storedField.get(operation.storage, operation.receiverCarrier, operation.storageIndex);
      if (operation.dispatch !== undefined && (dispatch?.write === undefined || dispatch.read.fallible || dispatch.write.fallible))
        reason = "A typed location cannot expose a project field whose dynamic dispatch may execute a fallible accessor.";
      else if (operation.dispatch === undefined && stored?.path === undefined)
        reason = "The finalized projected member has no exact Rust storage path.";
      else value = { kind: "member", receiver, operation };
    } else if (ast.is.IsElementAccessExpression(node)) {
      const index = ElementAccessExpression_ArgumentExpression(ast, node);
      const input = operation?.kind === "provider-operation" && operation.abi.operationKind === "indexer" &&
        operation.abi.target.form === "index" && operation.abi.targetArguments.length === 1 ? operation.abi.targetArguments[0] : undefined;
      if (index !== undefined && input !== undefined && isRustFinalizedSourceInput(input)) value = { kind: "index", receiver, index, input };
      else reason = "The finalized Rust element storage is not one exact built-in index operation.";
    } else reason = "The finalized Rust storage path contains an unsupported projection.";
    active.delete(node);
    if (value !== undefined) { selected.set(node, value); producer.projection(node, value); }
    else reasons.set(node, reason ?? "The finalized Rust storage path contains an unsupported projection.");
    return value;
  };
  const required = new Set<Node>();
  const admit = (node: Node): void => {
    if (required.has(node)) return;
    required.add(node);
    const operation = program.records.targetOperation.get(node);
    const structural = operation?.kind === "source-field" && operation.storage === "structural-object"
      ? program.records.structuralFieldStorage.get(operation.receiverCarrier, operation.storageIndex) : undefined;
    if (program.records.referenceObjectField.get(node) === true) return;
    if (structural?.field.storage === "bound") {
      const receiver = Node_Expression(ast, node);
      if (receiver === undefined) { refuse(node, "The finalized projected storage has no exact receiver expression."); return; }
      if (structural.value) admit(receiver);
      return;
    }
    const value = select(node);
    if (value === undefined) { refuse(node, reasons.get(node)!); return; }
    if (value.kind === "parenthesized") admit(value.inner);
    else if (value.kind === "member" || value.kind === "index") admit(value.receiver);
  };
  const admitPromoted = (node: Node): void => {
    const member = program.records.updateMember.get(node);
    if (member !== undefined && member !== null) return;
    if (program.records.locationStorageRoot.get(node) != null) admit(node);
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const reference = program.sourceNavigation.sourceReferenceFor(node);
    if (reference !== undefined) producer.reference(node, reference.declaration);
    select(node);
  }
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const location = analysisRecords.typedLocationPlan.get(node);
    if (location?.operation === "address-of") admit(location.storageExpression);
    if (location?.operation === "allocate" && program.records.nativeBacking.get(node) === undefined) {
      const selection = program.callableValues.nativeStorage.operandFor(node);
      if (selection.kind === "unresolved") {
        if (selection.diagnostic !== undefined) issues.push(selection.diagnostic);
        else failTargetAnalysisInvariant("tsonic-rust", selection.reason, node);
      } else {
        const carrier = selection.carrier;
        const pointee = carrier.kind === "target-named" && carrier.id === rustLocationTargetId
          ? carrier.genericArguments?.[0] : undefined;
        if (pointee?.kind !== "type") failTargetAnalysisInvariant("tsonic-rust",
          "An admitted native location allocation requires its selected physical pointee and owner.", node);
        producer.allocation(node, { carrier, pointeeCarrier: pointee.type });
        requireRustRecord(requirements, "locationAllocation", node, "allocate", "analyzeRustLocationStorage");
      }
    }
    const operation = program.records.targetOperation.get(node);
    const left = ast.is.IsBinaryExpression(node) ? BinaryExpression_Left(ast, node) : undefined;
    if (left !== undefined && (program.records.assignmentCompletion.get(node) !== undefined || operation?.kind === "nullish-assignment")) admitPromoted(left);
    if (ast.is.IsPrefixUnaryExpression(node) || ast.is.IsPostfixUnaryExpression(node)) {
      const unary = program.records.unaryEmission.get(node);
      const operand = Node_Operand(ast, node);
      if (operand !== undefined && unary?.kind === "update" && unary.location.kind === "promoted") admitPromoted(operand);
    }
    if (operation?.kind === "source-call" && operation.target.form === "method" && operation.target.mutatesSelf) {
      const callee = Node_Expression(ast, node);
      const receiver = callee === undefined ? undefined : Node_Expression(ast, callee);
      if (receiver !== undefined) admitPromoted(receiver);
    }
    if (operation?.kind === "provider-operation") for (const operand of program.records.providerMutableOperands.get(node, operation) ?? []) admitPromoted(operand.node);
    const field = operation?.kind === "source-field" && operation.storage === "structural-object"
      ? program.records.structuralFieldStorage.get(operation.receiverCarrier, operation.storageIndex) : undefined;
    if (field?.field.storage === "bound") admitPromoted(node);
    if (location?.operation === "load" || location?.operation === "store" || field?.field.storage === "bound" && field.value) {
      const owner = sourceEnclosingCallable(node, ast);
      const file = ast.getSourceFile(node);
      const region = owner === undefined ? file === undefined ? undefined : program.errorRegions.initialization.moduleFor(file)?.region : program.errorRegions.get(owner);
      if (region === undefined || region.kind === "infallible") refuse(node, "A source pointer access requires its exact retained callback error boundary.");
    }
  }
  return Object.freeze(issues);
}
