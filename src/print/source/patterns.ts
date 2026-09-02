import { indentText } from "./types.js";
import { printRustExpr } from "./expressions/core.js";
import { printRustExprFitted } from "./expressions/fitted.js";
import { rustExpressionChildren } from "../../backend/target-ast/inspection/source-usage.js";
import { rustExpressionContainsStatementBlock } from "../../backend/target-ast/expressions.js";
import { rustFormatWidth, rustMatchArmWidth } from "./formatting.js";
import type { RustExpr, RustPattern } from "../../backend/target-ast/nodes.js";

export function printRustPattern(pattern: RustPattern): string {
  switch (pattern.kind) {
    case "wildcard":
      return "_";
    case "binding":
      return pattern.name;
    case "path":
      return pattern.path;
    case "tuple": {
      const elements = pattern.elements.map(printRustPattern).join(", ");
      return `(${elements}${pattern.elements.length === 1 ? "," : ""})`;
    }
    case "tuple-variant":
      return `${pattern.path}(${pattern.elements.map(printRustPattern).join(", ")})`;
  }
}

export function printRustPatternFitted(
  pattern: RustPattern,
  depth: number,
  column: number,
): string {
  const flat = printRustPattern(pattern);
  if (renderedFits(flat, column) ||
    (pattern.kind !== "tuple" && pattern.kind !== "tuple-variant")) {
    return flat;
  }
  const elementIndent = indentText(depth + 1);
  const elements = pattern.elements.flatMap((element, index) => {
    const rendered = printRustPatternFitted(
      element,
      depth + 1,
      elementIndent.length,
    );
    const separator = index + 1 < pattern.elements.length ||
        pattern.kind === "tuple" && pattern.elements.length === 1
      ? ","
      : "";
    return [`${elementIndent}${appendToLastLine(rendered, separator)}`];
  });
  return [
    pattern.kind === "tuple" ? "(" : `${pattern.path}(`,
    ...elements,
    `${indentText(depth)})`,
  ].join("\n");
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
    const flatPattern = printRustPattern(arm.pattern);
    const pattern = printRustPatternFitted(arm.pattern, depth + 1, armIndent.length);
    if (pattern.includes("\n") && arm.expression.kind !== "return-expression") {
      const directPrefix = appendToLastLine(`${armIndent}${pattern}`, " => ");
      const directValue = printRustExprFitted(
        arm.expression,
        depth + 1,
        lastLineLength(directPrefix),
      );
      const direct = appendToLastLine(`${directPrefix}${directValue}`, ",");
      if (!directValue.includes("\n") && renderedFits(direct, 0)) {
        return [direct];
      }
      const blockPrefix = appendToLastLine(`${armIndent}${pattern}`, " => {");
      const valueIndent = indentText(depth + 2);
      const value = printRustExprFitted(
        arm.expression,
        depth + 2,
        valueIndent.length,
      );
      return [
        blockPrefix,
        `${valueIndent}${value}`,
        `${armIndent}}`,
      ];
    }
    if (arm.expression.kind === "return-expression") {
      const valueIndent = indentText(depth + 2);
      const value = printRustExprFitted(arm.expression, depth + 2, valueIndent.length);
      const statement = arm.expression.kind === "return-expression"
        ? appendToLastLine(value, ";")
        : value;
      return [
        `${armIndent}${flatPattern} => {`,
        `${valueIndent}${statement}`,
        `${armIndent}}`,
      ];
    }
    if (arm.expression.kind !== "try" && rustExpressionContainsTry(arm.expression)) {
      const valueIndent = indentText(depth + 2);
      const value = printRustExprFitted(arm.expression, depth + 2, valueIndent.length);
      return [
        `${armIndent}${flatPattern} => {`,
        `${valueIndent}${value}`,
        `${armIndent}}`,
      ];
    }
    const prefix = `${armIndent}${flatPattern} => `;
    const flatValue = printRustExpr(arm.expression);
    const flatArm = `${flatPattern} => ${flatValue},`;
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
        `${armIndent}${flatPattern} => {`,
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
  return lines.every((line, index) =>
    (index === 0 ? firstColumn : 0) + line.length <= rustFormatWidth ||
      rustLineIsUnbreakableLiteral(line));
}

function rustLineIsUnbreakableLiteral(line: string): boolean {
  return /^"(?:\\.|[^"\\])*"[,;)}\]]*$/u.test(line.trim());
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
  return value === "'" ? "\\'" : escapeRustString(value);
}
