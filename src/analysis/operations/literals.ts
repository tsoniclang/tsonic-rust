import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Initializer, Node_Operand, Node_Type, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustLiteralEmissionProducer } from "../program/records/operations/literal-emission.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustIntegerCarrier, isRustBigIntCarrier, rustPrimitiveTypeName } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function analyzeRustLiteralEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustLiteralEmissionProducer, source: TargetSourceProgram): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = source;
  const refuse = (node: Node, message: string, unsupported = false): void => {
    issues.push({ code: unsupported ? "RUST_UNSUPPORTED_AST" : "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: ["target.capability=rust.backend.literal-carrier"] });
  };
  const providerArguments = new Map<Node, TargetTypeRef[]>();
  const untypedProviderInputs = new Set<Node>();
  const nativeReceivers = new Set<Node>();
  for (const occurrence of program.physicalEmissionContexts.sourceOccurrences) {
    for (const { input, slot } of occurrence.inputs) {
      const receiver = occurrence.operation.abi.targetReceiver;
      const form = occurrence.operation.abi.target.form;
      const methodReceiver = receiver.kind === "input" && receiver.input === input &&
        (form === "arg-method" || form === "method" || form === "arg-receiver-method" || form === "receiver-method" ||
          form === "receiver-value-array" || form === "receiver-tagged-array" || form === "arg-structural-method");
      if (methodReceiver) nativeReceivers.add(slot.node);
      if (methodReceiver || input.conversion.kind !== "identity") {
        untypedProviderInputs.add(slot.node);
      } else {
        const carriers = providerArguments.get(slot.node) ?? [];
        carriers.push(input.sourceCarrier);
        providerArguments.set(slot.node, carriers);
      }
    }
  }
  const numericLiteral = (node: Node | undefined): boolean => node !== undefined && (ast.is.IsNumericLiteral(node) ||
    ast.is.IsBigIntLiteral(node) || ast.is.IsPrefixUnaryExpression(node) && numericLiteral(Node_Operand(ast, node)));
  const position = (node: Node): { readonly current: Node; readonly parent: Node | undefined } => {
    let current = node;
    let parent = ast.parent(node);
    while (parent !== undefined && (ast.is.IsParenthesizedExpression(parent) || ast.is.IsPrefixUnaryExpression(parent))) {
      current = parent;
      parent = ast.parent(parent);
    }
    return { current, parent };
  };
  const typedPosition = (node: Node, carrier: TargetTypeRef): boolean => {
    const { current, parent } = position(node);
    if (untypedProviderInputs.has(current)) return false;
    const parameters = providerArguments.get(current);
    if (parameters !== undefined) return parameters.every(parameter => rustTargetTypeRefEquals(parameter, carrier));
    if (parent === undefined) return false;
    if (ast.is.IsBinaryExpression(parent)) {
      const left = BinaryExpression_Left(ast, parent);
      const right = BinaryExpression_Right(ast, parent);
      const other = current === left ? right : current === right ? left : undefined;
      return other !== undefined && !numericLiteral(other);
    }
    if (ast.is.IsVariableDeclaration(parent)) return Node_Initializer(ast, parent) === current && Node_Type(ast, parent) !== undefined;
    if (ast.is.IsReturnStatement(parent)) return true;
    if (!ast.is.IsCallExpression(parent) || program.records.targetOperation.get(parent)?.kind !== "source-call") return false;
    // A source-call argument is typed only by a parameter declared with a closed carrier (not a type parameter).
    const index = ast.arguments(parent).indexOf(current);
    const selected = program.records.selectedCall.get(parent);
    const parameter = index < 0 ? undefined : selected?.nativeParameterDeclarations[index];
    const declared = parameter === undefined ? undefined : program.records.sourceParameterAbi.get(parameter)?.valueCarrier;
    return declared !== undefined && declared.kind === "source-primitive";
  };
  const request = (node: Node | undefined, carrier: TargetTypeRef | undefined): void => {
    if (node === undefined || !ast.is.IsNumericLiteral(node) && !ast.is.IsBigIntLiteral(node)) return;
    if (carrier === undefined) return;
    if (producer.records.literalEmission.get(node, carrier) !== undefined) return;
    const literal = program.records.literalValue.get(node);
    if (carrier.kind === "source-primitive" && (carrier.name === "float32" || carrier.name === "float64")) {
      const numeric = literal?.numeric;
      if (numeric === undefined) { refuse(node, "A floating literal requires its sealed source numeric evidence."); return; }
      if (numeric.kind === "authored") {
        const text = numeric.token.coefficient === 0n ? "0.0" : numeric.token.decimalText;
        const digits = text.includes(".") || text.includes("e") ? text : `${text}.0`;
        producer.publish(node, carrier, { kind: "float",
          text: typedPosition(node, carrier) ? digits : `${digits}_${carrier.name === "float32" ? "f32" : "f64"}`,
          negative: numeric.token.negative, cast: undefined });
      } else {
        if (!Number.isFinite(numeric.value)) { refuse(node, "Numeric literal emission requires finite checked floating-point evidence.", true); return; }
        const text = String(Math.abs(numeric.value));
        const digits = /[.eE]/u.test(text) ? text : `${text}.0`;
        producer.publish(node, carrier, { kind: "float", text: `${digits}_f64`, negative: numeric.value < 0 || Object.is(numeric.value, -0),
          cast: carrier.name === "float32" ? "f32" : undefined });
      }
      return;
    }
    const integer = literal?.integer;
    if (isRustIntegerCarrier(carrier)) {
      if (integer === undefined) { refuse(node, "Numeric literal cannot lower to integer carrier without exact sealed integer evidence.", true); return; }
      const type = carrier.kind === "source-primitive" ? rustPrimitiveTypeName(carrier.name) : undefined;
      if (type === undefined) { refuse(node, "Numeric literal carrier is not a supported Rust numeric carrier."); return; }
      producer.publish(node, carrier, { kind: "integer", text: type === "i32" && !nativeReceivers.has(position(node).current)
        ? integer.toString(10) : `${integer.toString(10)}_${type}` });
      return;
    }
    if (ast.is.IsBigIntLiteral(node) && isRustBigIntCarrier(carrier) && integer !== undefined) {
      const bytes: number[] = [];
      let remaining = integer;
      for (;;) {
        const value = Number(remaining & 255n);
        bytes.push(value); remaining >>= 8n;
        if (remaining === 0n && value < 128 || remaining === -1n && value >= 128) break;
      }
      producer.publish(node, carrier, { kind: "bigint", bytes: Object.freeze(bytes) });
      return;
    }
    refuse(node, "Numeric literal carrier is not a supported Rust numeric carrier.");
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    request(node, program.records.valueRead.get(node)?.contextualInput);
    const operation = program.records.targetOperation.get(node);
    if (ast.is.IsPrefixUnaryExpression(node) && (operation?.kind === "source-conversion" || operation?.kind === "operator-token"))
      request(Node_Operand(ast, node), operation.resultCarrier);
    const counted = program.records.countedLoop.get(node);
    if (counted?.kind === "integer-range-number-counter") request(counted.start, counted.rangeCarrier);
  }
  return Object.freeze(issues);
}
