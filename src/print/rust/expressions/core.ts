import { escapeRustString, printRustMatchExpression, printRustPattern } from "../patterns.js";
import { expressionIsRightHandBlock, printBinaryOperand, printOperand, RustPrecedence } from "./precedence.js";
import { printRustAssociatedCallOwner, printRustBlockExpressionInlineContents, printRustConditionalArmInline } from "./blocks.js";
import { printRustAssociatedOwner, printRustCallTypeArguments, rustMethodChainPrefersVerticalLayout } from "./chains.js";
import { printRustBlockStatements } from "../blocks.js";
import { printRustClosureParams } from "./closure-params.js";
import { printRustType } from "../types.js";
import type { RustExpr } from "../../../backend/rust-ast/nodes.js";

export function printRustExpr(expression: RustExpr): string {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal": {
      return expression.text;
    }
    case "bool-literal": {
      return expression.value ? "true" : "false";
    }
    case "none": {
      return "None";
    }
    case "string-literal": {
      return `String::from("${escapeRustString(expression.value)}")`;
    }
    case "str-literal": {
      return `"${escapeRustString(expression.value)}"`;
    }
    case "path": {
      return expression.path;
    }
    case "bottom": {
      return printRustExpr(expression.expression);
    }
    case "owned-string-from-borrowed-str": {
      return `String::from(${printRustExpr(expression.expression)})`;
    }
    case "unary": {
      return `${expression.operator}${printOperand(expression.operand, RustPrecedence.Unary, false)}`;
    }
    case "dereference": {
      return `*${printOperand(expression.pointer, RustPrecedence.Unary, false)}`;
    }
    case "numeric-cast": {
      return `${printOperand(expression.expression, RustPrecedence.Cast, false)} as ${expression.target}`;
    }
    case "binary": {
      const left = printBinaryOperand(expression.left, expression.operator, false);
      const right = printBinaryOperand(expression.right, expression.operator, true);
      return `${left} ${expression.operator} ${right}`;
    }
    case "range": {
      return `${printOperand(expression.start, RustPrecedence.Or, false)}..${expression.inclusive === true ? "=" : ""}${printOperand(expression.end, RustPrecedence.Or, true)}`;
    }
    case "conditional": {
      return `if ${printRustExpr(expression.condition)} { ${printRustConditionalArmInline(expression.whenTrue)} } else { ${printRustConditionalArmInline(expression.whenFalse)} }`;
    }
    case "match": {
      return printRustMatchExpression(expression, 0);
    }
    case "matches": {
      return `matches!(${printRustExpr(expression.expression)}, ${printRustPattern(expression.pattern)})`;
    }
    case "assignment": {
      return `${printRustExpr(expression.target)} ${expression.operator} ${printRustExpr(expression.value)}`;
    }
    case "call": {
      return `${expression.path}${printRustCallTypeArguments(expression.typeArguments)}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "invoke": {
      return `${printOperand(expression.callee, RustPrecedence.Postfix, false)}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "associated-value": {
      const owner = expression.trait === undefined
        ? printRustAssociatedOwner(expression.owner)
        : `<${printRustType(expression.owner)} as ${printRustType(expression.trait)}>`;
      return `${owner}::${expression.name}`;
    }
    case "associated-call": {
      return `${printRustAssociatedCallOwner(expression)}::${expression.method}${printRustCallTypeArguments(expression.typeArguments)}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "method-call": {
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      return `${receiver}.${expression.method}${printRustCallTypeArguments(expression.typeArguments)}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "field": {
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      const nestedTupleField = /^[0-9]+$/u.test(expression.name) &&
        expression.receiver.kind === "field" && /^[0-9]+$/u.test(expression.receiver.name);
      return `${nestedTupleField ? `(${receiver})` : receiver}.${expression.name}`;
    }
    case "index": {
      return `${printOperand(expression.receiver, RustPrecedence.Postfix, false)}[${printRustExpr(expression.index)}]`;
    }
    case "block": {
      return `{ ${printRustBlockExpressionInlineContents(expression)} }`;
    }
    case "unsafe": {
      return `unsafe { ${printRustExpr(expression.expression)} }`;
    }
    case "evaluate-then": {
      return `{ let _ = ${printRustExpr(expression.effect)}; ${printRustExpr(expression.value)} }`;
    }
    case "string-concat": {
      const placeholders = expression.parts.map(() => "{}").join("");
      return `format!("${placeholders}", ${expression.parts.map(printRustExpr).join(", ")})`;
    }
    case "format-write": {
      const args = expression.args.length === 0
        ? ""
        : `, ${expression.args.map(printRustExpr).join(", ")}`;
      return `write!(${printRustExpr(expression.writer)}, "${escapeRustString(expression.format)}"${args})`;
    }
    case "reference": {
      const prefix = expression.mutable === true ? "&mut " : "&";
      const operand = expressionIsRightHandBlock(expression.expr)
        ? printRustExpr(expression.expr)
        : printOperand(expression.expr, RustPrecedence.Unary, false);
      return `${prefix}${operand}`;
    }
    case "vec-literal": {
      return `vec![${expression.elements.map(printRustExpr).join(", ")}]`;
    }
    case "slice-literal": {
      return `[${expression.elements.map(printRustExpr).join(", ")}]`;
    }
    case "closure": {
      const params = printRustClosureParams(expression.params);
      return `${expression.move === true ? "move " : ""}|${params}| ${printRustExpr(expression.body)}`;
    }
    case "closure-block": {
      const params = printRustClosureParams(expression.params);
      const prefix = `${expression.move ? "move " : ""}|${params}| ${expression.async ? "async move " : ""}{`;
      const body = printRustBlockStatements(expression.body, 1);
      return body.length === 0 ? `${prefix}}` : `${prefix}\n${body}\n}`;
    }
    case "await": {
      return `${printOperand(expression.expr, RustPrecedence.Postfix, false)}.await`;
    }
    case "try": {
      return `${printOperand(expression.expr, RustPrecedence.Postfix, false)}?`;
    }
    case "return-expression": {
      return expression.expr === undefined ? "return" : `return ${printRustExpr(expression.expr)}`;
    }
    case "unreachable": {
      return `unreachable!("${escapeRustString(expression.message)}")`;
    }
    case "tuple-literal": {
      const elements = expression.elements.map(printRustExpr).join(", ");
      return `(${elements}${expression.elements.length === 1 ? "," : ""})`;
    }
    case "struct-literal": {
      if (expression.fields.length === 0) {
        return `${expression.path} {}`;
      }
      const fields = expression.fields
        .map((field) => {
          const value = printRustExpr(field.value);
          return value === field.name ? field.name : `${field.name}: ${value}`;
        })
        .join(", ");
      return `${expression.path} { ${fields} }`;
    }

  }
}
export function rustExpressionContainsClosure(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "closure":
    case "closure-block":
      return true;
    case "unary":
      return rustExpressionContainsClosure(expression.operand);
    case "bottom":
      return rustExpressionContainsClosure(expression.expression);
    case "owned-string-from-borrowed-str":
      return rustExpressionContainsClosure(expression.expression);
    case "dereference":
      return rustExpressionContainsClosure(expression.pointer);
    case "unsafe":
      return rustExpressionContainsClosure(expression.expression);
    case "numeric-cast":
      return rustExpressionContainsClosure(expression.expression);
    case "binary":
      return rustExpressionContainsClosure(expression.left) || rustExpressionContainsClosure(expression.right);
    case "range":
      return rustExpressionContainsClosure(expression.start) || rustExpressionContainsClosure(expression.end);
    case "conditional":
      return rustExpressionContainsClosure(expression.condition) ||
        rustExpressionContainsClosure(expression.whenTrue) ||
        rustExpressionContainsClosure(expression.whenFalse);
    case "match":
      return rustExpressionContainsClosure(expression.expression) ||
        expression.arms.some((arm) => rustExpressionContainsClosure(arm.expression));
    case "matches":
      return rustExpressionContainsClosure(expression.expression);
    case "assignment":
      return rustExpressionContainsClosure(expression.target) || rustExpressionContainsClosure(expression.value);
    case "call":
    case "invoke":
    case "associated-call":
      return (expression.kind === "invoke" && rustExpressionContainsClosure(expression.callee)) ||
        expression.args.some(rustExpressionContainsClosure);
    case "method-call":
      return rustExpressionContainsClosure(expression.receiver) ||
        expression.args.some(rustExpressionContainsClosure);
    case "field":
      return rustExpressionContainsClosure(expression.receiver);
    case "index":
      return rustExpressionContainsClosure(expression.receiver) || rustExpressionContainsClosure(expression.index);
    case "block":
      return expression.bindings.some((binding) => rustExpressionContainsClosure(binding.value)) ||
        rustExpressionContainsClosure(expression.value);
    case "evaluate-then":
      return rustExpressionContainsClosure(expression.effect) || rustExpressionContainsClosure(expression.value);
    case "string-concat":
      return expression.parts.some(rustExpressionContainsClosure);
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements.some(rustExpressionContainsClosure);
    case "reference":
    case "await":
    case "try":
      return rustExpressionContainsClosure(expression.expr);
    case "return-expression":
      return expression.expr !== undefined && rustExpressionContainsClosure(expression.expr);
    case "struct-literal":
      return expression.fields.some((field) => rustExpressionContainsClosure(field.value));
    default:
      return false;
  }
}
export function rustExpressionContainsPreferredVerticalMethodChain(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "method-call":
      return rustMethodChainPrefersVerticalLayout(expression) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.receiver) ||
        expression.args.some(rustExpressionContainsPreferredVerticalMethodChain);
    case "unary":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.operand);
    case "bottom":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression);
    case "owned-string-from-borrowed-str":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression);
    case "dereference":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.pointer);
    case "unsafe":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression);
    case "numeric-cast":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression);
    case "binary":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.left) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.right);
    case "range":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.start) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.end);
    case "conditional":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.condition) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.whenTrue) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.whenFalse);
    case "match":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression) ||
        expression.arms.some((arm) =>
          rustExpressionContainsPreferredVerticalMethodChain(arm.expression));
    case "matches":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expression);
    case "assignment":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.target) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.value);
    case "call":
    case "associated-call":
      return expression.args.some(rustExpressionContainsPreferredVerticalMethodChain);
    case "invoke":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.callee) ||
        expression.args.some(rustExpressionContainsPreferredVerticalMethodChain);
    case "field":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.receiver);
    case "index":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.receiver) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.index);
    case "block":
      return expression.bindings.some((binding) =>
        rustExpressionContainsPreferredVerticalMethodChain(binding.value)) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.value);
    case "evaluate-then":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.effect) ||
        rustExpressionContainsPreferredVerticalMethodChain(expression.value);
    case "string-concat":
      return expression.parts.some(rustExpressionContainsPreferredVerticalMethodChain);
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements.some(rustExpressionContainsPreferredVerticalMethodChain);
    case "reference":
    case "await":
    case "try":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.expr);
    case "return-expression":
      return expression.expr !== undefined &&
        rustExpressionContainsPreferredVerticalMethodChain(expression.expr);
    case "closure":
      return rustExpressionContainsPreferredVerticalMethodChain(expression.body);
    case "struct-literal":
      return expression.fields.some((field) =>
        rustExpressionContainsPreferredVerticalMethodChain(field.value));
    default:
      return false;
  }
}
