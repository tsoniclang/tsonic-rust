import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, sourceTransparentExpressionOperand, sourceExpressionResultDisposition } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { isRustStringCarrier, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { isRustCopyCarrier } from "../../policy/constraints/native-traits.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustStringAppendPart } from "../../target-model/records/storage/assignment-writes.js";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustAssignmentWriteProducer } from "../program/records/storage/assignment-writes.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";
import { rustEffectiveValueCarrier, rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";

export function analyzeRustAssignmentWrites(input: {
  readonly program: Pick<RustAnalysisProgram, "source" | "sourceNavigation" | "records" | "projectTypes" | "objectRepresentations" | "callableValues" | "names" | "safetyApplications">;
  readonly nodes: readonly Node[];
  readonly producer: RustAssignmentWriteProducer;
  readonly required: RustRequiredRecord[];
}): readonly TargetDiagnostic[] {
  const { program } = input;
  const { ast } = program.source;
  const { records } = program;
  const issues: TargetDiagnostic[] = [];
  const reject = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} (${ast.kindName(node)})`, evidence: [`target.capability=${capability}`] });
  };
  const representation = (node: Node): "value" | "other" => {
    const operation = records.targetOperation.get(node);
    if (operation?.kind !== "source-field") return "other";
    return operation.storage === "structural-object"
      ? rustStructuralObjectCarrierValue(operation.receiverCarrier)?.representation === "value" ? "value" : "other"
      : program.objectRepresentations.representationFor(program.projectTypes.definitionForCarrier(operation.receiverCarrier))?.kind === "value"
        ? "value" : "other";
  };
  const promoted = (node: Node): boolean => {
    const native = records.nativeArrayStorage.get(node);
    if (native !== undefined) return native.kind === "element";
    if (ast.is.IsPropertyAccessExpression(node) || ast.is.IsElementAccessExpression(node) || ast.is.IsParenthesizedExpression(node)) {
      const receiver = Node_Expression(ast, node);
      return receiver !== undefined && promoted(receiver);
    }
    const declaration = records.sourceBinding.get(node)?.sourceDeclaration;
    return declaration !== undefined && (records.bindingStorage.get(declaration) !== undefined ||
      records.moduleBinding.get(declaration)?.storage === "module-cell");
  };
  const direct = (node: Node): boolean => {
    if (ast.is.IsIdentifier(node)) return records.sourceBinding.get(node) !== undefined && !promoted(node);
    const kind = ast.kindName(node);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") return true;
    if (ast.is.IsParenthesizedExpression(node)) {
      const inner = Node_Expression(ast, node);
      return inner !== undefined && direct(inner);
    }
    const operation = records.targetOperation.get(node);
    const receiver = Node_Expression(ast, node);
    if (receiver === undefined) return false;
    if (operation?.kind === "source-field") return operation.storage === "project-object" &&
      operation.valueSemantics.kind === "stored" && operation.dispatch === undefined && representation(node) === "value" && direct(receiver);
    if (operation?.kind === "tuple-index" || operation?.kind === "fixed-index") return direct(receiver);
    if (operation?.kind !== "provider-operation") return false;
    const { abi } = operation;
    return abi.result.kind === "sync" && abi.result.conversion.kind === "identity" && abi.effects.invocation === "infallible" &&
      (abi.target.form === "field" || abi.target.form === "index") &&
      (abi.targetReceiver.kind !== "input" || abi.targetReceiver.input.source.kind !== "receiver" ||
        abi.targetReceiver.input.conversion.kind === "identity" && direct(receiver));
  };
  const appendParts = (node: Node, flatten: boolean, parts: RustStringAppendPart[]): void => {
    if (flatten && records.targetOperation.get(node)?.kind === "string-concat") {
      const left = BinaryExpression_Left(ast, node);
      const right = BinaryExpression_Right(ast, node);
      if (left === undefined || right === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "A selected string concatenation requires its source operands.", node);
      appendParts(left, true, parts);
      appendParts(right, true, parts);
    } else if (ast.is.IsStringLiteral(node) || ast.is.IsNoSubstitutionTemplateLiteral(node)) {
      const value = ast.text(node);
      const scalars = Array.from(value);
      parts.push(Object.freeze(scalars.length === 1
        ? { kind: "character", value: scalars[0]! } : { kind: "literal", value }));
    } else parts.push(Object.freeze({ kind: "expression", expression: node }));
  };
  for (const node of input.nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    if (!ast.is.IsBinaryExpression(node) || records.nativeUnreachable.get(node) === true ||
      records.compileTimeSource.get(node) !== undefined || records.nativeParticipation.get(node) === "erased") continue;
    const selected = records.targetOperation.get(node);
    const assignment = records.assignmentCompletion.get(node) ?? (selected?.kind === "nullish-assignment" ? selected.assignment : undefined);
    // A runtime setter used as a value (`return values[0] = 43`) writes through its setter statement and yields the
    // right-hand value, like any value assignment.
    if (assignment === undefined && selected?.kind === "runtime-set" && sourceExpressionResultDisposition(ast, node).kind !== "discarded") {
      const target = BinaryExpression_Left(ast, node);
      const value = BinaryExpression_Right(ast, node);
      const carrier = value === undefined ? undefined : rustValueCarrierBeforeContextualConversion(records, value);
      if (target === undefined || value === undefined || carrier === undefined || !rustTargetTypeRefEquals(carrier, records.runtimeCarrier.get(node)?.carrier)) {
        issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
          message: `An assignment expression requires its exact finalized right-hand value carrier before storage projection. Node kind: ${ast.kindName(node)}.`,
          evidence: ["target.capability=rust.backend.assignment-value-carrier"] });
        continue;
      }
      requireRustRecord(input.required, "assignmentWrite", node, "native assignment write", "analyzeRustAssignmentWrites");
      input.producer.assignment(node, { target, value, valueField: false, deferReceiverBorrow: false, stringAppend: undefined,
        valueResult: Object.freeze({ carrier, copy: isRustCopyCarrier(carrier) }) });
      continue;
    }
    if (assignment === undefined) continue;
    let target = BinaryExpression_Left(ast, node);
    while (target !== undefined) {
      const inner = sourceTransparentExpressionOperand(ast, target);
      if (inner === undefined) break;
      target = inner;
    }
    const right = BinaryExpression_Right(ast, node);
    const token = ast.as.AsBinaryExpression(node)?.OperatorToken;
    const value = assignment.operator !== "=" && token !== undefined && ast.kindName(token) === "KindEqualsToken" && right !== undefined
      ? BinaryExpression_Right(ast, right) : right;
    if (target === undefined || value === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted assignment requires its exact source operands.", node);
    const field = records.targetOperation.get(target);
    const valueField = field?.kind === "source-indexed-field" || field?.kind === "source-field" &&
      (representation(target) === "value" || field.declaration !== undefined &&
        (records.capturedFieldStorage.get(field.declaration) !== undefined || program.callableValues.frames.bindingFor(field.declaration) !== undefined));
    if (field?.kind === "source-field" || field?.kind === "source-union-field") {
      const evidence = records.selectedOperation.get(target);
      const carrier = field.kind === "source-field" ? rustEffectiveValueCarrier(records, target) : field.resultCarrier;
      if (evidence?.operationKind !== "property" || evidence.operationId !== field.operationId ||
        !rustTargetTypeRefEquals(evidence.resultType, carrier))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted field write requires its checked property selection.", target);
    }
    const rootPromoted = promoted(target);
    const directTarget = direct(target);
    const specialized = valueField || field?.kind === "builtin-error-property" || field?.kind === "source-accessor" ||
      field?.kind === "source-method-property" || field?.kind === "source-static-field" || field?.kind === "source-union-field" ||
      field?.kind === "source-field" || field?.kind === "source-index-signature" || records.compoundWrite.get(node) !== undefined ||
      records.fieldProjectionAssignment.get(node) !== undefined;
    if (!specialized && !rootPromoted && !directTarget) {
      reject(node, "rust.backend.assignment", "Assignments require an exact direct, promoted or module storage owner.");
      continue;
    }
    let stringAppend: import("../../target-model/records/storage/assignment-writes.js").RustAssignmentWriteCompletion["stringAppend"];
    if (!specialized && assignment.operator === "+=" && isRustStringCarrier(assignment.resultCarrier)) {
      const strategy = assignment.kind === "operator-token" ? assignment.writeStrategy : undefined;
      const declaration = records.sourceBinding.get(target)?.sourceDeclaration;
      const borrowCell = declaration !== undefined && records.bindingStorage.get(declaration)?.storage === "borrow-cell";
      if (strategy === "in-place-string-append-parts" && borrowCell || directTarget &&
        (strategy === "in-place-string-append-parts" || strategy === "in-place-string-append-value")) {
        const parts: RustStringAppendPart[] = [];
        appendParts(value, strategy === "in-place-string-append-parts", parts);
        stringAppend = Object.freeze({ receiver: borrowCell ? "borrow-cell" : "direct", parts: Object.freeze(parts) });
      } else if (!rootPromoted && (!directTarget || !ast.is.IsIdentifier(target))) {
        reject(node, "rust.backend.string-append-location", "String compound assignment requires a binding or finalized Rust location plan.");
        continue;
      }
    }
    const receiver = Node_Expression(ast, target);
    const receiverKind = receiver === undefined ? undefined : ast.kindName(receiver);
    const deferReceiverBorrow = assignment.operator === "=" && representation(target) === "value" &&
      (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword");
    requireRustRecord(input.required, "assignmentWrite", node, "native assignment write", "analyzeRustAssignmentWrites");
    let valueResult: import("../../target-model/records/storage/assignment-writes.js").RustAssignmentWriteCompletion["valueResult"];
    if (selected?.kind !== "nullish-assignment" && assignment.operator === "=" && sourceExpressionResultDisposition(ast, node).kind !== "discarded") {
      const carrier = rustValueCarrierBeforeContextualConversion(records, value);
      if (carrier === undefined || !rustTargetTypeRefEquals(carrier, records.runtimeCarrier.get(node)?.carrier)) {
        issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
          message: `An assignment expression requires its exact finalized right-hand value carrier before storage projection. Node kind: ${ast.kindName(node)}.`,
          evidence: ["target.capability=rust.backend.assignment-value-carrier"] });
        continue;
      }
      valueResult = Object.freeze({ carrier, copy: isRustCopyCarrier(carrier) });
    }
    input.producer.assignment(node, { target, value, valueField, deferReceiverBorrow, stringAppend, valueResult });
  }
  return Object.freeze(issues);
}
