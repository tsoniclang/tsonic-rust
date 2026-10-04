import { printRustExpr } from "./expressions/core.js";
import { printRustItem } from "./items.js";
import { printRustAttribute, printRustAttributes as printRustStatementAttributes } from "./attributes.js";
import { indentText, printRustType } from "./types.js";
import type { RustBlock, RustStmt } from "../../backend/target-ast/nodes.js";

export function printRustBlockStatements(block: RustBlock, depth: number, separator = "\n"): string {
  if (block === undefined || !Array.isArray(block.statements)) {
    throw new Error("Rust block requires the canonical native statement body");
  }
  return [
    ...(block.innerAttrs ?? []).map((attribute) => `${indentText(depth)}${printRustAttribute(attribute, true)}`),
    ...block.statements.map((statement) => printRustStmt(statement, depth)),
  ].filter(value => value.length > 0).join(separator);
}

function printRustBlock(block: RustBlock, depth: number, header: string): string {
  const indent = indentText(depth);
  const body = printRustBlockStatements(block, depth + 1);
  return body.length === 0
    ? `${indent}${header} {}`
    : `${indent}${header} {\n${body}\n${indent}}`;
}

function printRustStmt(statement: RustStmt, depth: number): string {
  const indent = indentText(depth);
  switch (statement.kind) {
    case "item":
      return printRustItem(statement.item).split("\n").map(line => `${indent}${line}`).join("\n");
    case "let": {
      const attributes = printRustStatementAttributes(statement.attrs, depth);
      const type = statement.type === undefined ? "" : `: ${printRustType(statement.type)}`;
      const initializer = statement.init === undefined ? "" : ` = ${printRustExpr(statement.init)}`;
      return `${attributes}${indent}let ${statement.mutable ? "mut " : ""}${statement.name}${type}${initializer};`;
    }
    case "expr":
      return `${printRustStatementAttributes(statement.attrs, depth)}${indent}${printRustExpr(statement.expr)};`;
    case "assign":
      return `${indent}${printRustExpr(statement.target)} ${statement.operator} ${printRustExpr(statement.value)};`;
    case "return":
      return statement.expr === undefined
        ? `${indent}return;`
        : `${indent}return ${printRustExpr(statement.expr)};`;
    case "tail":
      return statement.expr.kind === "tuple-literal" && statement.expr.elements.length === 0 &&
        (statement.attrs?.length ?? 0) === 0 ? "" : `${printRustStatementAttributes(statement.attrs, depth)}${indent}${printRustExpr(statement.expr)}`;
    case "if": {
      const attributes = printRustStatementAttributes(statement.attrs, depth);
      const rendered = printRustBlock(
        statement.then,
        depth,
        `if ${printRustExpr(statement.condition)}`,
      );
      if (statement.else === undefined) {
        return `${attributes}${rendered}`;
      }
      const nested = nestedMarkedElseIf(statement.elseIf, statement.else);
      if (nested !== undefined) {
        const nestedText = printRustStmt(nested, depth).slice(indent.length);
        return `${attributes}${rendered} else ${nestedText}`;
      }
      const otherwise = printRustBlockStatements(statement.else, depth + 1);
      return `${attributes}${rendered} else ${otherwise.length === 0
        ? "{}"
        : `{\n${otherwise}\n${indent}}`}`;
    }
    case "loop":
      return printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}loop`,
      );
    case "while": {
      const block = printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}while ${printRustExpr(statement.condition)}`,
      );
      return `${printRustStatementAttributes(statement.attrs, depth)}${block}`;
    }
    case "while-let-some":
      return printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}while let Some(${statement.bindingMutable === true ? "mut " : ""}${statement.binding}) = ${printRustExpr(statement.expression)}`,
      );
    case "for": {
      const block = printRustBlock(
        statement.body,
        depth,
        `${statement.label === undefined ? "" : `'${statement.label}: `}for ${statement.bindingMutable === true ? "mut " : ""}${statement.binding} in ${printRustExpr(statement.iterable)}`,
      );
      return `${printRustStatementAttributes(statement.attrs, depth)}${block}`;
    }

    case "break":
      return `${indent}break${statement.label === undefined ? "" : ` '${statement.label}`};`;
    case "continue":
      return `${indent}continue${statement.label === undefined ? "" : ` '${statement.label}`};`;
    case "completion-exit":
    case "resource-scope":
      throw new Error("Rust completion regions must be normalized to native AST before printing.");
    case "index-assign":
      return `${indent}${printRustExpr(statement.receiver)}[${printRustExpr(statement.index)}] = ${printRustExpr(statement.value)};`;
    case "scope": {
      const body = printRustBlockStatements(statement.body, depth + 1);
      const label = statement.label === undefined ? "" : `'${statement.label}: `;
      return body.length === 0
        ? `${indent}${label}{}`
        : `${indent}${label}{\n${body}\n${indent}}`;
    }
    case "unsafe-scope":
      return printRustBlock(statement.body, depth, "unsafe");
    case "throw": {
      const result = `Err(${printRustExpr(statement.error)})`;
      return statement.tail === true ? `${indent}${result}` : `${indent}return ${result};`;
    }
    case "try-scope":
      throw new Error("Rust completion regions must be normalized to native AST before printing.");
  }
  const unsupported: never = statement;
  throw new Error(`Unsupported Rust statement: ${JSON.stringify(unsupported)}`);
}

function nestedMarkedElseIf(
  marked: true | undefined,
  block: RustBlock,
): Extract<RustStmt, { readonly kind: "if" }> | undefined {
  if (marked !== true || block.statements.length !== 1 ||
    (block.innerAttrs?.length ?? 0) !== 0) {
    return undefined;
  }
  const nested = block.statements[0];
  if (nested?.kind !== "if") {
    return undefined;
  }
  return (nested.attrs?.length ?? 0) !== 0
    ? undefined
    : nested;
}

export function printRustElseBranch(block: RustBlock): string | undefined {
  if (block.statements.length === 1 && (block.innerAttrs?.length ?? 0) === 0) {
    const only = block.statements[0]!;
    if (only.kind === "tail" && (only.attrs?.length ?? 0) === 0 &&
      (only.expr.kind === "if-let" || only.expr.kind === "conditional")) {
      return printRustExpr(only.expr);
    }
  }
  const nested = nestedMarkedElseIf(true, block);
  return nested === undefined ? undefined : printRustStmt(nested, 0);
}
