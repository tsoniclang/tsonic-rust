import type {
  RustConstArgument,
  RustGenericArgument,
  RustLifetime,
  RustLifetimeParameter,
  RustTraitReference,
  RustType,
  RustTypeBound,
} from "../../backend/target-ast/nodes.js";
import { escapeRustChar } from "./patterns.js";

export function printRustType(type: RustType): string {
  switch (type.kind) {
    case "infer":
      return "_";
    case "primitive": {
      return type.name;
    }
    case "string": {
      return "String";
    }
    case "str": {
      return "str";
    }
    case "unit": {
      return "()";
    }
    case "never": {
      return "!";
    }
    case "named": {
      const args = (type.genericArguments ?? []).map(printRustGenericArgument);
      return args.length === 0
        ? type.path
        : `${type.path}<${args.join(", ")}>`;
    }
    case "qualified": {
      const owner = printRustType(type.owner);
      const qualification = type.trait === undefined
        ? owner
        : `<${owner} as ${printRustType(type.trait)}>`;
      const args = (type.genericArguments ?? []).map(printRustGenericArgument);
      return `${qualification}::${type.member}${args.length === 0 ? "" : `<${args.join(", ")}>`}`;
    }
    case "trait-object": {
      const bounds = [
        printRustTraitReference(type.principal),
        ...type.autoTraits.map(printRustTraitReference),
        ...(type.lifetime === undefined ? [] : [printRustLifetime(type.lifetime)]),
      ];
      return `dyn ${bounds.join(" + ")}`;
    }
    case "impl-trait": {
      const bounds = [
        ...type.bounds.map(printRustTypeBound),
        ...type.outlives.map(printRustLifetime),
        ...(type.captures.length === 0
          ? []
          : [`use<${type.captures.map(printRustLifetime).join(", ")}>`]),
      ];
      return `impl ${bounds.join(" + ")}`;
    }
    case "reference": {
      const lifetime = type.lifetime === undefined
        ? ""
        : `${printRustLifetime(type.lifetime)} `;
      return `${type.mutable ? `&${lifetime}mut ` : `&${lifetime}`}${printRustType(type.referent)}`;
    }
    case "raw-pointer": {
      return `${type.mutable ? "*mut " : "*const "}${printRustType(type.pointee)}`;
    }
    case "fixed-array": {
      return `[${printRustType(type.element)}; ${printRustConstArgument(type.length)}]`;
    }
    case "slice": {
      return `[${printRustType(type.element)}]`;
    }
    case "function-pointer": {
      const abiName = type.abi?.length === 1 && type.abi[0] !== "target-default"
        ? type.abi[0]
        : undefined;
      const abi = abiName === undefined ? "" : `extern ${JSON.stringify(abiName)} `;
      const binder = printRustBinder(type.binder);
      return `${binder}${type.isUnsafe === true ? "unsafe " : ""}${abi}fn(${type.parameters.map(printRustType).join(", ")}) -> ${printRustType(type.result)}`;
    }
    case "tuple": {
      const elements = type.elements.map(printRustType).join(", ");
      return `(${elements}${type.elements.length === 1 ? "," : ""})`;
    }
  }
}

export function printRustLifetime(lifetime: RustLifetime): string {
  return lifetime.kind === "static"
    ? "'static"
    : lifetime.kind === "placeholder"
      ? "'_"
      : `'${lifetime.name}`;
}

export function printRustLifetimeParameter(
  parameter: RustLifetimeParameter,
): string {
  const name = `'${parameter.name}`;
  return parameter.outlives.length === 0
    ? name
    : `${name}: ${parameter.outlives.map(printRustLifetime).join(" + ")}`;
}

export function printRustGenericArgument(argument: RustGenericArgument): string {
  switch (argument.kind) {
    case "lifetime":
      return printRustLifetime(argument.lifetime);
    case "type":
      return printRustType(argument.type);
    case "const":
      return printRustConstArgument(argument.value);
    case "associated-equality": {
      const generics = argument.genericArguments.length === 0
        ? ""
        : `<${argument.genericArguments.map(printRustGenericArgument).join(", ")}>`;
      return `${argument.name}${generics} = ${printRustType(argument.type)}`;
    }
    case "associated-bounds": {
      const generics = argument.genericArguments.length === 0
        ? ""
        : `<${argument.genericArguments.map(printRustGenericArgument).join(", ")}>`;
      return `${argument.name}${generics}: ${argument.bounds.map(printRustTypeBound).join(" + ")}`;
    }
  }
}

export function printRustConstArgument(value: RustConstArgument): string {
  switch (value.kind) {
    case "integer":
      return value.value.toString();
    case "boolean":
      return value.value ? "true" : "false";
    case "char":
      return `'${escapeRustChar(value.value)}'`;
    case "path":
      return value.path;
    case "infer":
      return "_";
  }
}

export function printRustTypeBound(bound: RustTypeBound): string {
  switch (bound.kind) {
    case "trait":
      return bound.path;
    case "trait-type":
      return printRustTraitReference(bound.reference);
    case "lifetime":
      return printRustLifetime(bound.lifetime);
    case "maybe-sized":
      return "?Sized";
    case "callable": {
      const binder = printRustBinder(bound.binder);
      return `${binder}${bound.trait}(${bound.parameters.map(printRustType).join(", ")}) -> ${printRustType(bound.result)}`;
    }
  }
}

export function printRustTraitReference(reference: RustTraitReference): string {
  return `${printRustBinder(reference.binder)}${printRustType(reference.trait)}`;
}

function printRustBinder(
  parameters: readonly RustLifetimeParameter[] | undefined,
): string {
  return parameters === undefined || parameters.length === 0
    ? ""
    : `for<${parameters.map(printRustLifetimeParameter).join(", ")}> `;
}

export function indentText(depth: number): string {
  return "    ".repeat(depth);
}
