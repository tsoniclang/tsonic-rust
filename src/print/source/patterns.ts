import { indentText } from "./types.js";
import { printRustExpr } from "./expressions/core.js";
import { printRustExprFitted } from "./expressions/fitted.js";
import { rustExpressionChildren } from "../../backend/target-ast/inspection/source-usage.js";
import { rustExpressionContainsStatementBlock } from "../../backend/target-ast/expressions.js";
import { rustFormatWidth, rustMatchArmWidth } from "./formatting.js";
import type { RustExpr, RustPattern } from "../../backend/target-ast/nodes.js";
import { requireRustCharacterScalar } from "../../backend/target-ast/literals.js";

export function printRustPattern(pattern: RustPattern): string {
  switch (pattern.kind) {
    case "wildcard":
      return "_";
    case "binding":
      return `${pattern.mode === "ref" ? "ref " : pattern.mode === "ref-mut" ? "ref mut " : ""}${pattern.mutable === true ? "mut " : ""}${pattern.name}${pattern.subpattern === undefined ? "" : ` @ ${printRustPattern(pattern.subpattern)}`}`;
    case "path":
      return pattern.path;
    case "tuple": {
      const elements = pattern.elements.map(printRustPattern).join(", ");
      return `(${elements}${pattern.elements.length === 1 ? "," : ""})`;
    }
    case "tuple-variant":
      return `${pattern.path}(${pattern.elements.map(printRustPattern).join(", ")})`;
    case "struct": {
      const fields = pattern.fields.map((field) => {
        const selected = printRustPattern(field.pattern);
        return selected === field.name ? field.name : `${field.name}: ${selected}`;
      });
      if (pattern.rest) fields.push("..");
      return `${pattern.path} { ${fields.join(", ")} }`;
    }
    case "slice": {
      const elements = [
        ...pattern.prefix.map(printRustPattern),
        ...(pattern.rest === undefined ? [] : [`${printRustPattern(pattern.rest)} @ ..`]),
        ...pattern.suffix.map(printRustPattern),
      ];
      return `[${elements.join(", ")}]`;
    }
    case "reference":
      return `&${pattern.mutable ? "mut " : ""}${printRustPattern(pattern.pattern)}`;
    case "or":
      return pattern.patterns.map(printRustPattern).join(" | ");
    case "literal":
      return printRustExpr(pattern.expression);
  }
}

export function printRustMatchExpression(
  expression: Extract<RustExpr, { readonly kind: "match" }>,
  depth: number,
  column = 0,
): string {
  const matched = printRustExprFitted(
    expression.expression,
    depth,
    column + "match ".length,
  );
  const inlineHeader = `match ${matched} {`;
  const header = matched.includes("\n") || !renderedFits(inlineHeader, column)
    ? `match ${matched}\n${indentText(depth)}{`
    : inlineHeader;
  const armIndent = indentText(depth + 1);
  const arms = expression.arms.flatMap((arm) => {
    const pattern = printRustPattern(arm.pattern);
    if (arm.expression.kind === "return-expression") {
      const valueIndent = indentText(depth + 2);
      const value = printRustExprFitted(arm.expression, depth + 2, valueIndent.length);
      const statement = arm.expression.kind === "return-expression"
        ? appendToLastLine(value, ";")
        : value;
      return [
        `${armIndent}${pattern} => {`,
        `${valueIndent}${statement}`,
        `${armIndent}}`,
      ];
    }
    if (arm.expression.kind !== "try" && rustExpressionContainsTry(arm.expression)) {
      const valueIndent = indentText(depth + 2);
      const value = printRustExprFitted(arm.expression, depth + 2, valueIndent.length);
      return [
        `${armIndent}${pattern} => {`,
        `${valueIndent}${value}`,
        `${armIndent}}`,
      ];
    }
    const prefix = `${armIndent}${pattern} => `;
    const flatValue = printRustExpr(arm.expression);
    const flatArm = `${pattern} => ${flatValue},`;
    if (flatValue.includes("\n") ||
      arm.expression.kind === "try" && flatArm.length > rustMatchArmWidth ||
      !renderedFits(`${prefix}${flatValue},`, 0)) {
      if (arm.expression.kind === "call" || arm.expression.kind === "associated-call" ||
        arm.expression.kind === "invoke" ||
        arm.expression.kind === "match" ||
        arm.expression.kind === "method-call" &&
          rustExpressionContainsStatementBlock(arm.expression)) {
        const directValue = printRustExprFitted(
          arm.expression,
          depth + 1,
          prefix.length,
        );
        return [appendToLastLine(`${prefix}${directValue}`, ",")];
      }
      const valueIndent = indentText(depth + 2);
      const value = printRustExprFitted(arm.expression, depth + 2, valueIndent.length);
      return [
        `${armIndent}${pattern} => {`,
        `${valueIndent}${value}`,
        `${armIndent}}`,
      ];
    }
    const value = printRustExprFitted(arm.expression, depth + 1, prefix.length);
    return [appendToLastLine(`${prefix}${value}`, ",")];
  });
  return [header, ...arms, `${indentText(depth)}}`].join("\n");
}

export function rustExpressionContainsTry(expression: RustExpr): boolean {
  return expression.kind === "try" ||
    rustExpressionChildren(expression).some(rustExpressionContainsTry);
}

export function renderedFits(rendered: string, firstColumn: number): boolean {
  const lines = rendered.split("\n");
  return lines.every((line, index) => (index === 0 ? firstColumn : 0) + line.length <= rustFormatWidth);
}

export function appendToLastLine(rendered: string, suffix: string): string {
  const lines = rendered.split("\n");
  const lastIndex = lines.length - 1;
  lines[lastIndex] = `${lines[lastIndex] ?? ""}${suffix}`;
  return lines.join("\n");
}

export function firstLine(rendered: string): string {
  return rendered.split("\n", 1)[0] ?? "";
}

export function remainingLines(rendered: string): readonly string[] {
  return rendered.split("\n").slice(1);
}

export function lastLine(rendered: string): string {
  const lines = rendered.split("\n");
  return lines[lines.length - 1] ?? rendered;
}

export function lastLineLength(rendered: string): number {
  const lines = rendered.split("\n");
  return lines[lines.length - 1]?.length ?? 0;
}

export function escapeRustString(value: string): string {
  let escaped = "";
  for (const character of value) {
    switch (character) {
      case "\\":
        escaped += "\\\\";
        break;
      case '"':
        escaped += '\\"';
        break;
      case "\n":
        escaped += "\\n";
        break;
      case "\r":
        escaped += "\\r";
        break;
      case "\t":
        escaped += "\\t";
        break;
      case "\0":
        escaped += "\\0";
        break;
      default:
        escaped += character;
    }
  }
  return escaped;
}

export function escapeRustChar(value: string): string {
  const scalar = requireRustCharacterScalar(value);
  return scalar === "'" ? "\\'" : escapeRustString(scalar);
}
