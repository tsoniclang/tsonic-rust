import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, ElementAccessExpression_ArgumentExpression, Node_Expression, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustNativeComparisonProducer } from "../program/records/native/native-comparisons.js";
import type { RustNativeComparison } from "../../target-model/records/native/native-comparisons.js";
import { isRustIntegerCarrier, isRustSignedNumericCarrier, isRustBoolCarrier, isRustStringCarrier } from "../../target-model/types/index.js";
import { rustBorrowValueIsUnprojected } from "../storage/borrowed-element-purity.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { rustProviderInputBorrowMode } from "../../policy/operations/members/input-borrows.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function analyzeRustNativeComparisons(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustNativeComparisonProducer): void {
  const { ast } = program.source;
  const borrowableField = (node: Node): boolean => {
    const field = program.records.targetOperation.get(node);
    if (field?.kind !== "source-field") return false;
    const frame = field.declaration === undefined ? undefined : program.records.frameBindingDeclaration.get(field.declaration);
    if (frame !== undefined) return frame.entry === undefined;
    const captured = field.declaration === undefined ? undefined : program.records.capturedFieldStorage.get(field.declaration);
    if (captured !== undefined) {
      const representation = program.records.objectRepresentation.get(program.records.projectType.get(field.receiverCarrier));
      return representation?.kind === "value" || representation !== undefined && field.dispatch === undefined &&
        program.records.storedField.get(field.storage, field.receiverCarrier, field.storageIndex)?.path !== undefined;
    }
    if (program.records.structuralFieldStorage.get(field.receiverCarrier, field.storageIndex)?.field.storage === "bound") return false;
    const projection = program.records.valueFieldProjection.get(node);
    if (projection === undefined || program.records.targetOperation.get(projection.root)?.kind === "source-field") return false;
    const root = program.records.directStorage.get(projection.root);
    return root !== undefined && root.kind !== "unavailable";
  };
  const unwrap = (node: Node): Node => {
    while (ast.is.IsParenthesizedExpression(node)) {
      const inner = Node_Expression(ast, node);
      if (inner === undefined) break;
      node = inner;
    }
    return node;
  };
  const exactInteger = (node: Node): bigint | undefined => {
    const operand = unwrap(node);
    const handler = program.records.nativeHandler.get(operand);
    return handler?.kind === "native-pointer" && handler.selection.kind === "layout-query"
      ? handler.selection.observation.value : program.records.literalValue.get(operand)?.integer;
  };
  const scopedStringSource = (node: Node): Extract<RustNativeComparison, { readonly kind: "scoped-string" }>["source"] | undefined => {
    if (program.records.fieldValueReceiver.get(node) === true && borrowableField(node)) return Object.freeze({ kind: "field", field: node });
    while (rustBorrowValueIsUnprojected(node, program.records)) {
      const operand = sourceTransparentExpressionOperand(ast, node);
      if (operand === undefined) break;
      node = operand;
    }
    if (!rustBorrowValueIsUnprojected(node, program.records)) return undefined;
    const provider = program.records.targetOperation.get(node);
    if (provider?.kind !== "provider-operation" || provider.abi.operationKind !== "indexer" || provider.abi.target.form !== "index" ||
      provider.abi.effects.invocation !== "infallible" || provider.abi.effects.safety !== "safe" ||
      provider.abi.result.kind !== "sync" || provider.abi.result.conversion.kind !== "identity" ||
      !isRustStringCarrier(provider.abi.result.carrier) ||
      !rustTargetTypeRefEquals(provider.abi.result.carrier, program.records.valueRead.get(node)?.value) ||
      provider.abi.sourceReceiver.kind !== "receiver" || provider.abi.targetReceiver.kind !== "input" ||
      provider.abi.targetReceiver.input.source.kind !== "receiver" || rustProviderInputBorrowMode(provider.abi.targetReceiver.input) !== "ref" ||
      program.records.providerEvaluation.get(node, provider) === undefined) return undefined;
    const receiver = Node_Expression(ast, node);
    const index = ElementAccessExpression_ArgumentExpression(ast, node);
    return receiver === undefined || index === undefined ? undefined
      : Object.freeze({ kind: "provider", node, operation: provider, receiver, arguments: Object.freeze([index]) });
  };
  const range = (left: Node, right: Node, operator: "&&" | "||"):
    Omit<Extract<RustNativeComparison, { readonly kind: "range" }>, "prefix" | "suffix"> | undefined => {
    const term = (input: Node) => {
      const expression = unwrap(input);
      const selected = program.records.targetOperation.get(expression);
      if (selected?.kind !== "operator-token" || selected.leftConversion !== undefined || selected.rightConversion !== undefined) return undefined;
      const left = BinaryExpression_Left(ast, expression);
      const right = BinaryExpression_Right(ast, expression);
      if (left === undefined || right === undefined) return undefined;
      const first = program.records.literalValue.get(left);
      const second = program.records.literalValue.get(right);
      const subject = second?.numeric !== undefined || second?.integer !== undefined ? left
        : first?.numeric !== undefined || first?.integer !== undefined ? right : undefined;
      if (subject === undefined || !ast.is.IsIdentifier(unwrap(subject))) return undefined;
      const binding = program.records.sourceBinding.get(unwrap(subject));
      const read = program.ownership.reads.get(subject);
      if (binding?.scope !== "lexical" || program.records.bindingStorage.get(binding.sourceDeclaration) !== undefined ||
        read?.pure !== true || !read.stablePlace) return undefined;
      const subjectFirst = subject === left;
      const relationship = operator === "&&"
        ? selected.operator === (subjectFirst ? ">=" : "<=") ? "lower" : selected.operator === (subjectFirst ? "<=" : ">=") ? "upper" : undefined
        : selected.operator === (subjectFirst ? "<" : ">") ? "lower" : selected.operator === (subjectFirst ? ">" : "<") ? "upper" : undefined;
      const bound = subjectFirst ? right : left;
      const carrier = program.records.valueRead.get(bound)?.value;
      const floating = carrier?.kind === "source-primitive" && (carrier.name === "float32" || carrier.name === "float64");
      return relationship === undefined || !isRustIntegerCarrier(carrier) && !floating ? undefined
        : { subject, declaration: binding.sourceDeclaration, bound, relationship, integer: isRustIntegerCarrier(carrier) };
    };
    const first = term(left);
    const second = term(right);
    if (first === undefined || second === undefined || first.declaration !== second.declaration || first.relationship === second.relationship) return undefined;
    const lower = first.relationship === "lower" ? first : second;
    const upper = first.relationship === "upper" ? first : second;
    if (lower.integer !== upper.integer) return undefined;
    return { kind: "range", subject: first.subject, lower: lower.bound, upper: upper.bound, operator,
      form: operator === "||" && !lower.integer ? "outside-float" : "contains" };
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind !== "operator-token" || !ast.is.IsBinaryExpression(node)) continue;
    const left = BinaryExpression_Left(ast, node);
    const right = BinaryExpression_Right(ast, node);
    if (left === undefined || right === undefined) continue;
    let selected: RustNativeComparison = { kind: "ordinary" };
    if (operation.operator === "&" && isRustIntegerCarrier(operation.resultCarrier) && isRustSignedNumericCarrier(operation.resultCarrier)) {
      const exactMask = (operand: Node): boolean => {
        if (program.records.literalValue.get(operand)?.integer !== -1n) return false;
        const effects = program.sourceNavigation.expressionEffects(operand);
        return !effects.invokes && !effects.mutates && !effects.suspends && !effects.mayThrow;
      };
      if (operation.rightConversion === undefined && exactMask(right)) selected = { kind: "integer-identity", operand: "left" };
      else if (operation.leftConversion === undefined && exactMask(left)) selected = { kind: "integer-identity", operand: "right" };
    }
    if (selected.kind === "ordinary" && operation.leftConversion === undefined && operation.rightConversion === undefined) {
      const leftInteger = exactInteger(left);
      const rightInteger = exactInteger(right);
      const reversed: Readonly<Record<string, string>> = { "==": "==", "!=": "!=", "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
      const boundary = leftInteger !== undefined && rightInteger !== undefined ? undefined : rightInteger === 0n || rightInteger === 1n
        ? { operand: "left" as const, node: left, operator: operation.operator, integer: rightInteger }
        : (leftInteger === 0n || leftInteger === 1n) && reversed[operation.operator] !== undefined
          ? { operand: "right" as const, node: right, operator: reversed[operation.operator]!, integer: leftInteger } : undefined;
      const carrier = boundary === undefined ? undefined : program.records.valueRead.get(boundary.node)?.value;
      if (boundary !== undefined && isRustIntegerCarrier(carrier) && !isRustSignedNumericCarrier(carrier)) {
        const normalized = boundary.integer === 0n ? boundary.operator : boundary.operator === "<" ? "==" : boundary.operator === ">=" ? "!=" : undefined;
        if (normalized === "<" || normalized === ">=") selected = { kind: "unsigned-constant", operand: boundary.operand,
          value: normalized === ">=", evaluate: program.records.literalValue.get(boundary.node)?.integer === undefined };
        else {
          const operator = normalized === "<=" || normalized === "==" ? "==" : normalized === ">" || normalized === "!=" ? "!=" : undefined;
          if (operator !== undefined) {
            let empty: Extract<RustNativeComparison, { readonly kind: "unsigned-zero" }>["empty"];
            const provider = program.records.targetOperation.get(boundary.node);
            const abi = provider?.kind === "provider-operation" ? provider.abi : undefined;
            const receiver = Node_Expression(ast, boundary.node);
            if (abi?.operationKind === "property" && abi.effects.invocation === "infallible" && abi.effects.evaluation === "pure" &&
              abi.result.kind === "sync" && abi.result.conversion.kind === "identity" && abi.target.form === "receiver-method" &&
              abi.target.emptyTestMethod !== undefined && (abi.target.chain?.length ?? 0) === 0 &&
              abi.sourceReceiver.kind === "receiver" && abi.targetReceiver.kind === "input" &&
              abi.sourceArguments.length === 0 && abi.targetArguments.length === 0 && receiver !== undefined)
              empty = Object.freeze({ receiver, input: abi.targetReceiver.input, method: abi.target.emptyTestMethod });
            selected = { kind: "unsigned-zero", operand: boundary.operand, operator, empty };
          }
        }
      }
    }
    if (selected.kind === "ordinary" && operation.leftConversion === undefined && operation.rightConversion === undefined) {
      const leftValue = program.records.literalValue.get(unwrap(left));
      const rightValue = program.records.literalValue.get(unwrap(right));
      const leftCarrier = program.records.valueRead.get(left)?.value;
      const rightCarrier = program.records.valueRead.get(right)?.value;
      const first = exactInteger(left);
      const second = exactInteger(right);
      if (first !== undefined && second !== undefined && isRustIntegerCarrier(leftCarrier) && isRustIntegerCarrier(rightCarrier)) {
        const value = operation.operator === "==" ? first === second : operation.operator === "!=" ? first !== second
          : operation.operator === "<" ? first < second : operation.operator === ">" ? first > second
          : operation.operator === "<=" ? first <= second : operation.operator === ">=" ? first >= second : undefined;
        if (value !== undefined) selected = { kind: "integer-constant", value };
      }
      if (operation.operator === "==" || operation.operator === "!=") {
        const boolean = leftValue?.form === "true" || leftValue?.form === "false" ? { value: leftValue.form === "true", operand: "right" as const, carrier: rightCarrier }
          : rightValue?.form === "true" || rightValue?.form === "false" ? { value: rightValue.form === "true", operand: "left" as const, carrier: leftCarrier } : undefined;
        if (boolean !== undefined && isRustBoolCarrier(boolean.carrier)) selected = { kind: "boolean", operand: boolean.operand,
          negated: operation.operator === "==" ? !boolean.value : boolean.value };
        else {
          const empty = leftValue?.text === "" ? { operand: "right" as const, carrier: rightCarrier }
            : rightValue?.text === "" ? { operand: "left" as const, carrier: leftCarrier } : undefined;
          if (empty !== undefined && isRustStringCarrier(empty.carrier)) selected = { kind: "empty-string", operand: empty.operand, negated: operation.operator === "!=" };
        }
      }
      if (selected.kind === "ordinary" && (operation.operator === "&&" || operation.operator === "||")) {
        const direct = range(left, right, operation.operator);
        if (direct !== undefined) selected = { ...direct, prefix: undefined, suffix: undefined };
        else {
          const first = unwrap(left);
          const second = unwrap(right);
          const firstOperation = program.records.targetOperation.get(first);
          const secondOperation = program.records.targetOperation.get(second);
          const trailingLeft = BinaryExpression_Right(ast, first);
          const leadingRight = BinaryExpression_Left(ast, second);
          const trailing = firstOperation?.kind === "operator-token" && firstOperation.operator === operation.operator && trailingLeft !== undefined
            ? range(trailingLeft, right, operation.operator) : undefined;
          const leading = secondOperation?.kind === "operator-token" && secondOperation.operator === operation.operator && leadingRight !== undefined
            ? range(left, leadingRight, operation.operator) : undefined;
          if (trailing !== undefined) selected = { ...trailing, prefix: BinaryExpression_Left(ast, first), suffix: undefined };
          else if (leading !== undefined) selected = { ...leading, prefix: undefined, suffix: BinaryExpression_Right(ast, second) };
        }
      }
    }
    if ((operation.operator === "==" || operation.operator === "!=") && operation.leftConversion === undefined && operation.rightConversion === undefined) {
      const literal = (node: Node): boolean => ast.is.IsStringLiteral(node) || ast.is.IsNoSubstitutionTemplateLiteral(node);
      const scoped = literal(right) ? { field: left, literal: right, reversed: false }
        : literal(left) ? { field: right, literal: left, reversed: true } : undefined;
      const value = scoped === undefined ? undefined : program.records.literalValue.get(scoped.literal);
      if (scoped !== undefined && (value?.form === "string" || value?.form === "template") &&
        rustBorrowValueIsUnprojected(scoped.field, program.records) && isRustStringCarrier(program.records.valueRead.get(scoped.field)?.value) &&
        isRustStringCarrier(program.records.valueRead.get(scoped.literal)?.value)) {
        const source = scopedStringSource(scoped.field);
        if (source !== undefined) selected = { kind: "scoped-string", source, value: value.text, reversed: scoped.reversed, operator: operation.operator };
      }
    }
    producer.publish(node, selected);
  }
}
