import type { RustNativeNodeId, RustNativeSourceSpan } from "./evidence.js";
import type {
  RustNativeBodyEvaluation, RustNativeEvaluation, RustNativeEvaluationArm, RustNativeEvaluationAssemblyOperand,
  RustNativeEvaluationNode, RustNativeEvaluationStatement, RustNativeEvaluationStructTail,
} from "./evaluation-model.js";
import type { NativeTypeDecodeContext } from "./decode-type-context.js";
import { array, boolean, choice, index, record, shape } from "./decode-values.js";

export function createNativeEvaluationDecoder(
  context: NativeTypeDecodeContext,
  readers: {
    readonly node: (value: unknown) => RustNativeNodeId;
    readonly span: (value: unknown) => RustNativeSourceSpan | null;
  },
): (value: unknown) => RustNativeBodyEvaluation {
  const node = (value: unknown): RustNativeNodeId => { context.reserve(); return readers.node(value); };
  const optional = (value: unknown): RustNativeNodeId | null => value === null ? null : node(value);
  const arm = (value: unknown): RustNativeEvaluationArm => {
    context.reserve();
    const input = shape(value, ["id", "pattern", "guard", "body"]);
    return Object.freeze({ id: node(input.id), pattern: node(input.pattern), guard: optional(input.guard), body: node(input.body) });
  };
  const statement = (value: unknown): RustNativeEvaluationStatement => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["let", "item", "expression"]);
    switch (kind) {
      case "let":
        shape(input, ["kind", "id", "pattern", "initializer", "alternative"]);
        if (input.initializer === null && input.alternative !== null) {
          throw new Error("Native Rust let-else evaluation requires an initializer.");
        }
        return Object.freeze({ kind, id: node(input.id), pattern: node(input.pattern),
          initializer: optional(input.initializer), alternative: optional(input.alternative) });
      case "item":
        shape(input, ["kind", "definition"]);
        return Object.freeze({ kind, definition: context.definition(input.definition) });
      case "expression":
        shape(input, ["kind", "expression", "semicolon"]);
        return Object.freeze({ kind, expression: node(input.expression), semicolon: boolean(input.semicolon) });
    }
  };
  const tail = (value: unknown): RustNativeEvaluationStructTail => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["none", "defaults", "base"]);
    shape(input, kind === "base" ? ["kind", "expression"] : ["kind"]);
    return Object.freeze(kind === "base" ? { kind, expression: node(input.expression) } : { kind });
  };
  const operand = (value: unknown): RustNativeEvaluationAssemblyOperand => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["input", "output", "input-output", "split-input-output", "const", "function", "static", "label"]);
    switch (kind) {
      case "input":
      case "function":
        shape(input, ["kind", "expression"]);
        return Object.freeze({ kind, expression: node(input.expression) });
      case "output":
        shape(input, ["kind", "expression", "late"]);
        return Object.freeze({ kind, expression: optional(input.expression), late: boolean(input.late) });
      case "input-output":
        shape(input, ["kind", "expression", "late"]);
        return Object.freeze({ kind, expression: node(input.expression), late: boolean(input.late) });
      case "split-input-output":
        shape(input, ["kind", "input", "output", "late"]);
        return Object.freeze({ kind, input: node(input.input), output: optional(input.output), late: boolean(input.late) });
      case "const":
      case "static":
        shape(input, ["kind", "definition"]);
        return Object.freeze({ kind, definition: context.definition(input.definition,
          kind === "const" ? ["inline-constant", "anonymous-constant"] : ["static"]) });
      case "label":
        shape(input, ["kind", "block"]);
        return Object.freeze({ kind, block: node(input.block) });
    }
  };
  const evaluation = (value: unknown): RustNativeEvaluationNode => {
    context.reserve();
    const input = record(value);
    const id = node(input.id);
    const source = readers.span(input.source);
    const kind = choice(input.kind, ["operation", "short-circuit", "if", "match", "loop", "block-expression", "block", "let",
      "break", "continue", "return", "become", "yield", "closure", "const", "struct", "assembly"]);
    const fields = (...names: readonly string[]): void => { shape(input, ["id", "source", "kind", ...names]); };
    let result: RustNativeEvaluation;
    switch (kind) {
      case "operation": {
        fields("operation", "inputs");
        const operation = choice(input.operation, ["array", "tuple", "call", "method-call", "binary", "unary", "use", "cast",
          "type-ascription", "drop-temporaries", "field", "index", "borrow", "repeat", "unsafe-binder-cast", "assign",
          "compound-assign", "literal", "path", "offset-of"]);
        const inputs = array(input.inputs, node);
        const expected = ["literal", "path", "offset-of"].includes(operation) ? 0
          : ["binary", "index", "assign", "compound-assign"].includes(operation) ? 2
            : ["array", "tuple", "call", "method-call"].includes(operation) ? undefined : 1;
        if (expected !== undefined && inputs.length !== expected ||
          (operation === "call" || operation === "method-call") && inputs.length === 0) {
          throw new Error("Native Rust evaluation operation has an inconsistent operand count.");
        }
        result = { kind, operation, inputs };
        break;
      }
      case "short-circuit":
        fields("operator", "left", "right");
        result = { kind, operator: choice(input.operator, ["and", "or"]), left: node(input.left), right: node(input.right) };
        break;
      case "if":
        fields("condition", "consequent", "alternative");
        result = { kind, condition: node(input.condition), consequent: node(input.consequent), alternative: optional(input.alternative) };
        break;
      case "match":
        fields("input", "arms");
        result = { kind, input: node(input.input), arms: array(input.arms, arm) };
        break;
      case "loop":
      case "block-expression":
        fields("block");
        result = { kind, block: node(input.block) };
        break;
      case "block":
        fields("statements", "tail", "targetedByBreak");
        result = { kind, statements: array(input.statements, statement), tail: optional(input.tail), targetedByBreak: boolean(input.targetedByBreak) };
        break;
      case "let":
        fields("pattern", "initializer");
        result = { kind, pattern: node(input.pattern), initializer: node(input.initializer) };
        break;
      case "break":
        fields("target", "value");
        result = { kind, target: node(input.target), value: optional(input.value) };
        break;
      case "continue":
        fields("target");
        result = { kind, target: node(input.target) };
        break;
      case "return":
        fields("value");
        result = { kind, value: optional(input.value) };
        break;
      case "become":
      case "yield":
        fields("value");
        result = { kind, value: node(input.value) };
        break;
      case "closure":
      case "const":
        fields("definition");
        result = { kind, definition: context.definition(input.definition,
          kind === "closure" ? ["closure", "coroutine-body"] : ["inline-constant", "anonymous-constant"]) };
        break;
      case "struct":
        fields("fields", "tail");
        result = { kind, fields: array(input.fields, node), tail: tail(input.tail) };
        break;
      case "assembly":
        fields("options", "operands");
        result = { kind, options: index(input.options), operands: array(input.operands, operand) };
        break;
    }
    return Object.freeze({ id, source, ...result });
  };
  return (value: unknown): RustNativeBodyEvaluation => {
    context.reserve();
    const input = shape(value, ["owner", "parameters", "root", "nodes"]);
    return Object.freeze({ owner: context.definition(input.owner), parameters: array(input.parameters, node),
      root: node(input.root), nodes: array(input.nodes, evaluation) });
  };
}
