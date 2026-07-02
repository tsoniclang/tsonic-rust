import type {
  RustBlock,
  RustExpr,
  RustItem,
  RustSourceFileModel,
  RustStmt,
  RustType,
} from "../backend/rust-ast/nodes.js";

// Deterministic printer. Output must be `cargo fmt --check` clean for the
// supported construct set: 4-space indent, no trailing whitespace, one blank
// line between items, trailing newline.

export function printRustSourceFile(model: RustSourceFileModel): string {
  const parts: string[] = [`// ${model.headerComment}`];
  for (const item of model.items) {
    parts.push("");
    parts.push(printRustItem(item));
  }
  return `${parts.join("\n")}\n`;
}

export function printRustItem(item: RustItem): string {
  switch (item.kind) {
    case "mod-decl": {
      return `${item.pub ? "pub " : ""}mod ${item.name};`;
    }
    case "const": {
      return `${item.pub ? "pub " : ""}const ${item.name}: ${printRustType(item.type)} = ${printRustExpr(item.value)};`;
    }
    case "function": {
      const params = item.params.map((param) => `${param.name}: ${printRustType(param.type)}`).join(", ");
      const returnSuffix = item.returnType === undefined ? "" : ` -> ${printRustType(item.returnType)}`;
      const header = `${item.pub ? "pub " : ""}fn ${item.name}(${params})${returnSuffix} {`;
      const body = printRustBlockStatements(item.body, 1);
      return body.length === 0 ? `${header}}` : `${header}\n${body}\n}`;
    }
  }
}

export function printRustType(type: RustType): string {
  switch (type.kind) {
    case "primitive": {
      return type.name;
    }
    case "string": {
      return "String";
    }
    case "unit": {
      return "()";
    }
  }
}

function indentText(depth: number): string {
  return "    ".repeat(depth);
}

function printRustBlockStatements(block: RustBlock, depth: number): string {
  return block.statements.map((statement) => printRustStmt(statement, depth)).join("\n");
}

function printRustBlock(block: RustBlock, depth: number, header: string): string {
  const body = printRustBlockStatements(block, depth + 1);
  const indent = indentText(depth);
  return body.length === 0 ? `${indent}${header} {}` : `${indent}${header} {\n${body}\n${indent}}`;
}

function printRustStmt(statement: RustStmt, depth: number): string {
  const indent = indentText(depth);
  switch (statement.kind) {
    case "let": {
      const mutability = statement.mutable ? "mut " : "";
      const typeSuffix = statement.type === undefined ? "" : `: ${printRustType(statement.type)}`;
      return `${indent}let ${mutability}${statement.name}${typeSuffix} = ${printRustExpr(statement.init)};`;
    }
    case "expr": {
      return `${indent}${printRustExpr(statement.expr)};`;
    }
    case "assign": {
      return `${indent}${statement.target} ${statement.operator} ${printRustExpr(statement.value)};`;
    }
    case "return": {
      return statement.expr === undefined
        ? `${indent}return;`
        : `${indent}return ${printRustExpr(statement.expr)};`;
    }
    case "tail": {
      return `${indent}${printRustExpr(statement.expr)}`;
    }
    case "if": {
      const rendered = printRustBlock(statement.then, depth, `if ${printRustExpr(statement.condition)}`);
      if (statement.else === undefined) {
        return rendered;
      }
      const elseBody = printRustBlockStatements(statement.else, depth + 1);
      const indentStr = indentText(depth);
      const withoutTrailing = rendered.endsWith("{}") ? `${rendered.slice(0, -2)}{\n${indentStr}}` : rendered;
      return elseBody.length === 0
        ? `${withoutTrailing} else {}`
        : `${withoutTrailing} else {\n${elseBody}\n${indentStr}}`;
    }
    case "while": {
      return printRustBlock(statement.body, depth, `while ${printRustExpr(statement.condition)}`);
    }
    case "scope": {
      const body = printRustBlockStatements(statement.body, depth + 1);
      return body.length === 0 ? `${indent}{}` : `${indent}{\n${body}\n${indent}}`;
    }
  }
}

const enum RustPrecedence {
  Or = 1,
  And = 2,
  Comparison = 3,
  Additive = 4,
  Multiplicative = 5,
  Unary = 6,
  Postfix = 7,
  Atom = 8,
}

function operatorPrecedence(operator: string): RustPrecedence {
  switch (operator) {
    case "||":
      return RustPrecedence.Or;
    case "&&":
      return RustPrecedence.And;
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return RustPrecedence.Comparison;
    case "+":
    case "-":
      return RustPrecedence.Additive;
    default:
      return RustPrecedence.Multiplicative;
  }
}

function expressionPrecedence(expression: RustExpr): RustPrecedence {
  switch (expression.kind) {
    case "binary":
      return operatorPrecedence(expression.operator);
    case "unary":
      return RustPrecedence.Unary;
    case "method-call":
    case "field":
    case "index":
      return RustPrecedence.Postfix;
    default:
      return RustPrecedence.Atom;
  }
}

function printOperand(operand: RustExpr, parent: RustPrecedence, isRightSide: boolean): string {
  const own = expressionPrecedence(operand);
  const needsParens =
    own < parent ||
    (own === parent && (isRightSide || parent === RustPrecedence.Comparison));
  const text = printRustExpr(operand);
  return needsParens ? `(${text})` : text;
}

export function printRustExpr(expression: RustExpr): string {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal": {
      return expression.text;
    }
    case "bool-literal": {
      return expression.value ? "true" : "false";
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
    case "unary": {
      return `${expression.operator}${printOperand(expression.operand, RustPrecedence.Unary, false)}`;
    }
    case "binary": {
      const precedence = operatorPrecedence(expression.operator);
      const left = printOperand(expression.left, precedence, false);
      const right = printOperand(expression.right, precedence, true);
      return `${left} ${expression.operator} ${right}`;
    }
    case "call": {
      return `${expression.path}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "method-call": {
      const receiver = printOperand(expression.receiver, RustPrecedence.Postfix, false);
      return `${receiver}.${expression.method}(${expression.args.map(printRustExpr).join(", ")})`;
    }
    case "field": {
      return `${printOperand(expression.receiver, RustPrecedence.Postfix, false)}.${expression.name}`;
    }
    case "index": {
      return `${printOperand(expression.receiver, RustPrecedence.Postfix, false)}[${printRustExpr(expression.index)}]`;
    }
    case "string-concat": {
      const placeholders = expression.parts.map(() => "{}").join("");
      return `format!("${placeholders}", ${expression.parts.map(printRustExpr).join(", ")})`;
    }
  }
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
