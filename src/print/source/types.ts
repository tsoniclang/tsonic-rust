import type {
  RustConstExpression,
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
  RustLifetime,
  RustType,
  RustTypeBound,
  RustWherePredicate,
} from "../../backend/target-ast/nodes.js";

export function printRustType(type: RustType): string {
  switch (type.kind) {
    case "infer": return "_";
    case "primitive": return type.name;
    case "string": return "String";
    case "str": return "str";
    case "unit": return "()";
    case "never": return "!";
    case "named":
      return `${type.path}${printRustGenericArguments(type.genericArguments)}`;
    case "qualified": {
      const owner = printRustType(type.owner);
      const prefix = type.trait === undefined
        ? owner
        : `<${owner} as ${printRustType(type.trait)}>`;
      return `${prefix}::${type.member}${printRustGenericArguments(type.genericArguments)}`;
    }
    case "trait-object": {
      const bounds = [...type.bounds.map(printRustTypeBound)];
      if (type.lifetime !== undefined) bounds.push(printRustLifetime(type.lifetime));
      return `dyn ${bounds.join(" + ")}`;
    }
    case "opaque":
      return `impl ${type.bounds.map(printRustTypeBound).join(" + ")}`;
    case "reference": {
      const lifetime = type.lifetime === undefined ? "" : `${printRustLifetime(type.lifetime)} `;
      return `&${lifetime}${type.mutable ? "mut " : ""}${printRustType(type.referent)}`;
    }
    case "raw-pointer":
      return `${type.mutable ? "*mut " : "*const "}${printRustType(type.pointee)}`;
    case "fixed-array":
      return `[${printRustType(type.element)}; ${printRustConstExpression(type.length)}]`;
    case "slice":
      return `[${printRustType(type.element)}]`;
    case "function-pointer": {
      const binder = printRustBinder(type.binder);
      const abi = type.abi === undefined || type.abi === "Rust"
        ? ""
        : `extern ${JSON.stringify(type.abi)} `;
      const parameters = type.parameters.map(printRustType);
      if (type.variadic === true) parameters.push("...");
      const result = isRustUnitType(type.result) ? "" : ` -> ${printRustType(type.result)}`;
      return `${binder}${type.isUnsafe === true ? "unsafe " : ""}${abi}fn(${parameters.join(", ")})${result}`;
    }
    case "tuple": {
      const elements = type.elements.map(printRustType).join(", ");
      return `(${elements}${type.elements.length === 1 ? "," : ""})`;
    }
  }
}

export function printRustLifetime(lifetime: RustLifetime): string {
  switch (lifetime.kind) {
    case "static": return "'static";
    case "inferred": return "'_";
    case "named": return `'${lifetime.name}`;
  }
}

export function printRustConstExpression(expression: RustConstExpression): string {
  switch (expression.kind) {
    case "integer": return expression.value.toString();
    case "boolean": return expression.value ? "true" : "false";
    case "character": return rustCharacterLiteral(expression.value);
    case "path": return expression.path;
    case "inferred": return "_";
    case "unary":
      return `${expression.operator}(${printRustConstExpression(expression.operand)})`;
    case "binary":
      return `(${printRustConstExpression(expression.left)} ${expression.operator} ${printRustConstExpression(expression.right)})`;
  }
}

export function printRustGenericArgument(argument: RustGenericArgument): string {
  switch (argument.kind) {
    case "lifetime": return printRustLifetime(argument.lifetime);
    case "type": return printRustType(argument.type);
    case "const": return printRustConstExpression(argument.expression);
    case "associated-equality":
      return `${argument.name}${printRustGenericArguments(argument.genericArguments)} = ${printRustType(argument.type)}`;
    case "associated-bounds":
      return `${argument.name}${printRustGenericArguments(argument.genericArguments)}: ${argument.bounds.map(printRustTypeBound).join(" + ")}`;
  }
}

export function printRustGenericArguments(
  argumentsList: readonly RustGenericArgument[] | undefined,
  turbofish = false,
): string {
  if (argumentsList === undefined || argumentsList.length === 0) return "";
  return `${turbofish ? "::" : ""}<${argumentsList.map(printRustGenericArgument).join(", ")}>`;
}

export function printRustTypeBound(bound: RustTypeBound): string {
  if (bound.kind === "lifetime") return printRustLifetime(bound.lifetime);
  if (bound.kind === "callable-trait") {
    const binder = printRustBinder(bound.binder);
    const result = isRustUnitType(bound.result) ? "" : ` -> ${printRustType(bound.result)}`;
    return `${binder}${bound.trait}(${bound.parameters.map(printRustType).join(", ")})${result}`;
  }
  if (bound.kind === "precise-capture") {
    return `use<${bound.captures.map(printRustGenericArgument).join(", ")}>`;
  }
  const binder = printRustBinder(bound.binder);
  const polarity = bound.polarity === "maybe" ? "?" : "";
  return `${binder}${polarity}${printRustType(bound.trait)}`;
}

function isRustUnitType(type: RustType): boolean {
  return type.kind === "unit" || type.kind === "tuple" && type.elements.length === 0;
}

export function printRustGenericParameter(parameter: RustGenericParameter): string {
  switch (parameter.kind) {
    case "lifetime": {
      const bounds = parameter.bounds.map(printRustLifetime);
      return `'${parameter.name}${bounds.length === 0 ? "" : `: ${bounds.join(" + ")}`}`;
    }
    case "type": {
      const bounds = parameter.bounds.map(printRustTypeBound);
      const defaultType = parameter.defaultType === undefined ? "" : ` = ${printRustType(parameter.defaultType)}`;
      return `${parameter.name}${bounds.length === 0 ? "" : `: ${bounds.join(" + ")}`}${defaultType}`;
    }
    case "const": {
      const defaultValue = parameter.defaultValue === undefined
        ? ""
        : ` = ${printRustConstExpression(parameter.defaultValue)}`;
      return `const ${parameter.name}: ${printRustType(parameter.type)}${defaultValue}`;
    }
  }
}

export function printRustGenerics(generics: RustGenerics): string {
  return generics.parameters.length === 0
    ? ""
    : `<${generics.parameters.map(printRustGenericParameter).join(", ")}>`;
}

export function printRustWhereClause(generics: RustGenerics, depth = 0): string {
  if (generics.wherePredicates.length === 0) return "";
  return `\n${indentText(depth)}where\n${generics.wherePredicates.map((predicate) =>
    `${indentText(depth + 1)}${printRustWherePredicate(predicate)},`).join("\n")}`;
}

export function printRustWherePredicate(predicate: RustWherePredicate): string {
  switch (predicate.kind) {
    case "lifetime":
      return `${printRustLifetime(predicate.lifetime)}: ${predicate.outlives.map(printRustLifetime).join(" + ")}`;
    case "type": {
      const binder = printRustBinder(predicate.binder);
      return `${binder}${printRustType(predicate.type)}: ${predicate.bounds.map(printRustTypeBound).join(" + ")}`;
    }
    case "equality":
      return `${printRustType(predicate.projection)} = ${printRustType(predicate.value)}`;
  }
}

function printRustBinder(
  parameters: readonly Extract<RustGenericParameter, { readonly kind: "lifetime" }>[] | undefined,
): string {
  return parameters === undefined || parameters.length === 0
    ? ""
    : `for<${parameters.map((parameter) => `'${parameter.name}`).join(", ")}> `;
}

function rustCharacterLiteral(value: string): string {
  if ([...value].length !== 1) {
    throw new Error("A Rust character literal must contain exactly one Unicode scalar value.");
  }
  const escaped = value
    .split("\\").join("\\\\")
    .split("'").join("\\'")
    .split("\n").join("\\n")
    .split("\r").join("\\r")
    .split("\t").join("\\t")
    .split("\0").join("\\0");
  return `'${escaped}'`;
}

export function indentText(depth: number): string {
  return "    ".repeat(depth);
}
