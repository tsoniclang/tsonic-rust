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
    case "use": {
      return item.alias === undefined ? `use ${item.path};` : `use ${item.path} as ${item.alias};`;
    }
    case "const": {
      return `${item.pub ? "pub " : ""}const ${item.name}: ${printRustType(item.type)} = ${printRustExpr(item.value)};`;
    }
    case "struct": {
      const structAttrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const header = `${structAttrs}${derives}${item.pub ? "pub " : ""}struct ${item.name} {`;
      const fields = item.fields.map((field) => `    pub ${field.name}: ${printRustType(field.type)},`).join("\n");
      return fields.length === 0 ? `${structAttrs}${derives}${item.pub ? "pub " : ""}struct ${item.name};` : `${header}\n${fields}\n}`;
    }
    case "enum": {
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const variants = item.variants
        .map((variant) => `    ${variant.name}${variant.discriminant === undefined ? "" : ` = ${variant.discriminant}`},`)
        .join("\n");
      return `${derives}${item.pub ? "pub " : ""}enum ${item.name} {\n${variants}\n}`;
    }
    case "impl": {
      const rendered = item.functions.map((fn) => {
        const selfPrefix = fn.selfParam === undefined ? "" : fn.selfParam === "ref" ? "&self" : "&mut self";
        const params = fn.params.map((param) => `${param.mutable === true ? "mut " : ""}${param.name}: ${printRustType(param.type)}`).join(", ");
        const allParams = selfPrefix.length === 0 ? params : params.length === 0 ? selfPrefix : `${selfPrefix}, ${params}`;
        const returnSuffix = fn.fallible === true
          ? ` -> rt::TsonicResult<${fn.returnType === undefined ? "()" : printRustType(fn.returnType)}>`
          : fn.returnType === undefined ? "" : ` -> ${printRustType(fn.returnType)}`;
        const fnAttrs = (fn.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
        const header = `${fnAttrs}    ${fn.pub ? "pub " : ""}fn ${fn.name}(${allParams})${returnSuffix} {`;
        const body = printRustBlockStatements(fn.body, 2);
        return body.length === 0 ? `${header}}` : `${header}\n${body}\n    }`;
      }).join("\n\n");
      return `impl ${item.name} {\n${rendered}\n}`;
    }
    case "function": {
      const params = item.params.map((param) => `${param.mutable === true ? "mut " : ""}${param.name}: ${printRustType(param.type)}`).join(", ");
      const generics = item.typeParams === undefined || item.typeParams.length === 0 ? "" : `<${item.typeParams.join(", ")}>`;
      const returnSuffix = item.fallible === true
        ? ` -> rt::TsonicResult<${item.returnType === undefined ? "()" : printRustType(item.returnType)}>`
        : item.returnType === undefined ? "" : ` -> ${printRustType(item.returnType)}`;
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const header = `${attrs}${item.pub ? "pub " : ""}${item.isAsync === true ? "async " : ""}fn ${item.name}${generics}(${params})${returnSuffix} {`;
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
    case "named": {
      const args = type.typeArguments ?? [];
      return args.length === 0
        ? type.path
        : `${type.path}<${args.map(printRustType).join(", ")}>`;
    }
    case "slice-ref": {
      return `${type.mutable ? "&mut " : "&"}[${printRustType(type.element)}]`;
    }
    case "tuple": {
      return `(${type.elements.map(printRustType).join(", ")})`;
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
      return `${indent}${printRustExpr(statement.target)} ${statement.operator} ${printRustExpr(statement.value)};`;
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
    case "for": {
      return printRustBlock(statement.body, depth, `for ${statement.binding} in ${printRustExpr(statement.iterable)}`);
    }
    case "index-assign": {
      return `${indent}${printOperand(statement.receiver, RustPrecedence.Postfix, false)}[${printRustExpr(statement.index)}] = ${printRustExpr(statement.value)};`;
    }
    case "scope": {
      const body = printRustBlockStatements(statement.body, depth + 1);
      return body.length === 0 ? `${indent}{}` : `${indent}{\n${body}\n${indent}}`;
    }
    case "throw": {
      return [
        `${indent}return Err(rt::TsonicError::from(rt::JsError::new(`,
        `${indent}    rt::JsErrorKind::Error,`,
        `${indent}    ${printRustExpr(statement.message)},`,
        `${indent})));`,
      ].join("\n");
    }
    case "try-catch": {
      const tryBody = printRustBlockStatements(statement.body, depth + 1);
      const okTail = `${indentText(depth + 1)}Ok(())`;
      const catchBody = printRustBlockStatements(statement.catchBody, depth + 1);
      const lines = [
        `${indent}let __try: rt::TsonicResult<()> = (|| {`,
        ...(tryBody.length === 0 ? [] : [tryBody]),
        okTail,
        `${indent}})();`,
        `${indent}if let Err(${statement.catchBinding}) = __try {`,
        ...(catchBody.length === 0 ? [] : [catchBody]),
        `${indent}}`,
      ];
      return lines.join("\n");
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
    case "cast":
    case "reference":
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
    case "cast": {
      if (expression.expr.kind === "int-literal") {
        return `${expression.expr.text}${expression.to}`;
      }
      if (expression.expr.kind === "unary" && expression.expr.operator === "-" && expression.expr.operand.kind === "int-literal") {
        return `-${expression.expr.operand.text}${expression.to}`;
      }
      return `${printOperand(expression.expr, RustPrecedence.Unary, false)} as ${expression.to}`;
    }
    case "reference": {
      const prefix = expression.mutable === true ? "&mut " : "&";
      return `${prefix}${printOperand(expression.expr, RustPrecedence.Unary, false)}`;
    }
    case "vec-literal": {
      return `vec![${expression.elements.map(printRustExpr).join(", ")}]`;
    }
    case "slice-literal": {
      return `[${expression.elements.map(printRustExpr).join(", ")}]`;
    }
    case "closure": {
      const params = expression.params
        .map((param) => (param.byRefCopy ? `&${param.name}` : param.name))
        .join(", ");
      return `|${params}| ${printRustExpr(expression.body)}`;
    }
    case "try": {
      return `${printOperand(expression.expr, RustPrecedence.Postfix, false)}?`;
    }
    case "tuple-literal": {
      return `(${expression.elements.map(printRustExpr).join(", ")})`;
    }
    case "struct-literal": {
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
