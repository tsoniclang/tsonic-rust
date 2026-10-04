import { printRustBlockStatements, printRustElseBranch } from "../blocks.js";
import { escapeRustChar, escapeRustString, printRustPattern } from "../patterns.js";
import { printRustConstArgument, printRustType } from "../types.js";
import {
  printRustAssociatedCallOwner,
  printRustAssociatedCallTarget,
  printRustAssociatedOwner,
  printRustDirectCallTarget,
  printRustMethodCallTarget,
} from "./callable.js";
import { printRustClosureParams } from "./closure-params.js";
import {
  expressionIsStatementBlock,
  expressionNeedsParentheses,
  operatorPrecedence,
  RustPrecedence,
} from "./precedence.js";
import type { RustExpr } from "../../../backend/target-ast/nodes.js";

export function printRustExpr(expression: RustExpr): string {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
      return expression.text;
    case "bool-literal":
      return expression.value ? "true" : "false";
    case "none":
      return "None";
    case "char-literal":
      return `'${escapeRustChar(expression.value)}'`;
    case "string-literal":
      return `String::from("${escapeRustString(expression.value)}")`;
    case "str-literal":
      return `"${escapeRustString(expression.value)}"`;
    case "path":
      return printRustDirectCallTarget(expression);
    case "bottom":
      return printRustExpr(expression.expression);
    case "owned-string-from-borrowed-str":
      return `String::from(${printRustExpr(expression.expression)})`;
    case "unary":
      return `${expression.operator}${printOperand(expression.operand, RustPrecedence.Unary, false)}`;
    case "dereference":
      return `*${printOperand(expression.pointer, RustPrecedence.Unary, false)}`;
    case "numeric-cast":
      return `${printOperand(expression.expression, RustPrecedence.Cast, false)} as ${expression.target}`;
    case "binary": {
      const precedence = operatorPrecedence(expression.operator);
      const left = printBinaryOperand(expression.left, expression.operator, precedence, false);
      const right = printBinaryOperand(expression.right, expression.operator, precedence, true);
      return `${left} ${expression.operator} ${right}`;
    }
    case "range":
      return `${printOperand(expression.start, RustPrecedence.Or, false)}..${expression.inclusive === true ? "=" : ""}${printOperand(expression.end, RustPrecedence.Or, true)}`;
    case "conditional": {
      const alternative = printConditionalAlternative(expression.whenFalse);
      return `if ${printRustExpr(expression.condition)} { ${printConditionalArm(expression.whenTrue)} } else ${alternative}`;
    }
    case "if-let": {
      const consequent = `if let ${printRustPattern(expression.pattern)} = ${printRustExpr(expression.expression)} { ${printConditionalArm(expression.whenTrue)} }`;
      if (expression.whenFalse === undefined) return consequent;
      const alternative = printConditionalAlternative(expression.whenFalse);
      return `${consequent} else ${alternative}`;
    }
    case "match":
      return printRustMatchExpression(expression);
    case "matches":
      return `matches!(${printRustExpr(expression.expression)}, ${printRustPattern(expression.pattern)})`;
    case "assignment":
      return `${printRustExpr(expression.target)} ${expression.operator} ${printRustExpr(expression.value)}`;
    case "call":
      return `${printRustDirectCallTarget(expression)}(${expression.args.map(printRustExpr).join(", ")})`;
    case "invoke":
      return `${printDelimitedPostfixOperand(expression.callee)}(${expression.args.map(printRustExpr).join(", ")})`;
    case "associated-value": {
      const owner = expression.trait === undefined
        ? printRustAssociatedOwner(expression.owner)
        : `<${printRustType(expression.owner)} as ${printRustType(expression.trait)}>`;
      return `${owner}::${expression.name}`;
    }
    case "associated-call":
      return `${printRustAssociatedCallTarget(expression, printRustAssociatedCallOwner(expression))}(${expression.args.map(printRustExpr).join(", ")})`;
    case "method-call": {
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      return `${printRustMethodCallTarget(expression, receiver)}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "option-presence":
      return `${printOperand(expression.receiver, RustPrecedence.Postfix, false)}.${expression.present ? "is_some" : "is_none"}()`;
    case "field": {
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      const nestedTupleField = /^[0-9]+$/u.test(expression.name) &&
        expression.receiver.kind === "field" && /^[0-9]+$/u.test(expression.receiver.name);
      return `${nestedTupleField ? `(${receiver})` : receiver}.${expression.name}`;
    }
    case "index":
      return `${printDelimitedPostfixOperand(expression.receiver)}[${printRustExpr(expression.index)}]`;
    case "block":
      return `${expression.label === undefined ? "" : `'${expression.label}: `}{ ${printRustBlockExpressionContents(expression)} }`;
    case "unsafe":
      return `unsafe { ${printRustExpr(expression.expression)} }`;
    case "evaluate-then": {
      const statement = printRustDiscard(expression);
      if (expression.value.kind === "tuple-literal" && expression.value.elements.length === 0) {
        return `{ ${statement} }`;
      }
      return `{ ${statement} ${printRustExpr(expression.value)} }`;
    }
    case "string-concat": {
      const placeholders = expression.parts.map(() => "{}").join("");
      const values = expression.parts.map(printRustExpr);
      return `format!("${placeholders}"${values.length === 0 ? "" : `, ${values.join(", ")}`})`;
    }
    case "format-write": {
      const args = expression.args.length === 0
        ? ""
        : `, ${expression.args.map(printRustExpr).join(", ")}`;
      return `write!(${printRustExpr(expression.writer)}, "${escapeRustString(expression.format)}"${args})`;
    }
    case "reference":
      return `${expression.mutable === true ? "&mut " : "&"}${printOperand(expression.expr, RustPrecedence.Unary, false)}`;
    case "vec-literal":
      return `vec![${expression.elements.map(printRustExpr).join(", ")}]`;
    case "slice-literal":
      return `[${expression.elements.map(printRustExpr).join(", ")}]`;
    case "array-repeat":
      return `[${printRustExpr(expression.element)}; ${printRustConstArgument(expression.length)}]`;
    case "closure":
      return `${expression.move === true ? "move " : ""}|${printRustClosureParams(expression.params)}| ${printRustExpr(expression.body)}`;
    case "closure-block": {
      const prefix = `${expression.move ? "move " : ""}|${printRustClosureParams(expression.params)}| ${expression.async ? "async move " : ""}`;
      return `${prefix}${printBlockExpression(expression.body)}`;
    }
    case "await":
      return `${printOperand(expression.expr, RustPrecedence.Postfix, false)}.await`;
    case "async-block":
      return `async ${expression.move ? "move " : ""}${printBlockExpression(expression.body)}`;
    case "option-try":
    case "try":
      return `${printOperand(expression.expr, RustPrecedence.Postfix, false)}?`;
    case "return-expression":
      return expression.expr === undefined ? "return" : `return ${printRustExpr(expression.expr)}`;
    case "break-expression":
      return `break '${expression.label}${expression.expr === undefined ? "" : ` ${printRustExpr(expression.expr)}`}`;
    case "unreachable":
      return `unreachable!("${escapeRustString(expression.message)}")`;
    case "tuple-literal": {
      const elements = expression.elements.map(printRustExpr).join(", ");
      return `(${elements}${expression.elements.length === 1 ? "," : ""})`;
    }
    case "macro-invocation": {
      const [open, close] = expression.delimiter === "parentheses"
        ? ["(", ")"]
        : expression.delimiter === "brackets"
          ? ["[", "]"]
          : ["{", "}"];
      const separator = expression.delimiter === "braces" ? " " : "";
      return `${expression.path}!${separator}${open}${expression.args.map(printRustExpr).join(", ")}${close}`;
    }
    case "struct-literal": {
      const members = expression.fields.map((field) => {
        const value = printRustExpr(field.value);
        return value === field.name ? field.name : `${field.name}: ${value}`;
      });
      if (expression.base !== undefined) {
        members.push(`..${printRustExpr(expression.base)}`);
      }
      return members.length === 0
        ? `${expression.path} {}`
        : `${expression.path} { ${members.join(", ")} }`;
    }
  }
}

function printDelimitedPostfixOperand(expression: RustExpr): string {
  return expressionIsStatementBlock(expression)
    ? `(${printRustExpr(expression)})`
    : printOperand(expression, RustPrecedence.Postfix, false);
}

function printOperand(
  operand: RustExpr,
  parent: RustPrecedence,
  isRightSide: boolean,
): string {
  const rendered = printRustExpr(operand);
  return expressionNeedsParentheses(operand, parent, isRightSide)
    ? `(${rendered})`
    : rendered;
}

function printBinaryOperand(
  operand: RustExpr,
  operator: string,
  precedence: RustPrecedence,
  isRightSide: boolean,
): string {
  const rendered = printOperand(operand, precedence, isRightSide);
  return operand.kind === "numeric-cast" &&
      (operator === "<" || operator === "<=" || operator === ">" || operator === ">=")
    ? `(${rendered})`
    : rendered;
}

function printRustMatchExpression(
  expression: Extract<RustExpr, { readonly kind: "match" }>,
): string {
  const arms = expression.arms.map((arm) =>
    `${printRustPattern(arm.pattern)} => ${printRustExpr(arm.expression)},`);
  return `match ${printRustExpr(expression.expression)} { ${arms.join(" ")} }`;
}

function printConditionalArm(expression: RustExpr, allowInnerAttributes = true): string {
  if (expression.kind === "tuple-literal" && expression.elements.length === 0) return "";
  if (expression.kind === "block" &&
    (allowInnerAttributes || (expression.body.innerAttrs?.length ?? 0) === 0)) {
    return printRustBlockExpressionContents(expression);
  }
  if (expression.kind === "evaluate-then") {
    const statement = printRustDiscard(expression);
    return `${statement} ${printConditionalArm(expression.value, false)}`;
  }
  return printRustExpr(expression);
}

function printConditionalAlternative(expression: RustExpr): string {
  if (expression.kind === "conditional" || expression.kind === "if-let") return printRustExpr(expression);
  if (expression.kind === "block") {
    const chained = printRustElseBranch(expression.body);
    if (chained !== undefined) return chained;
  }
  return `{ ${printConditionalArm(expression)} }`;
}

function printRustDiscard(expression: Extract<RustExpr, { readonly kind: "evaluate-then" }>): string {
  const effect = printRustExpr(expression.effect);
  return expression.discard === "value" ? `let _ = ${effect};`
    : expression.effect.kind === "path" ? `let () = ${effect};` : `${effect};`;
}

function printRustBlockExpressionContents(
  expression: Extract<RustExpr, { readonly kind: "block" }>,
): string {
  return printRustBlockStatements(expression.body, 0, " ");
}

function printBlockExpression(
  block: import("../../../backend/target-ast/nodes.js").RustBlock,
): string {
  const body = printRustBlockStatements(block, 1);
  return body.length === 0 ? "{}" : `{\n${body}\n}`;
}
