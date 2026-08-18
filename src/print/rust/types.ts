import type { RustType } from "../../backend/rust-ast/nodes.js";

export function printRustType(type: RustType): string {
  switch (type.kind) {
    case "primitive": {
      return type.name;
    }
    case "string": {
      return "String";
    }
    case "str-ref": {
      return "&str";
    }
    case "unit": {
      return "()";
    }
    case "never": {
      return "!";
    }
    case "named": {
      const args = [
        ...(type.lifetimeArguments ?? []).map((lifetime) => `'${lifetime}`),
        ...(type.typeArguments ?? []).map(printRustType),
      ];
      return args.length === 0
        ? type.path
        : `${type.path}<${args.join(", ")}>`;
    }
    case "trait-object": {
      return `dyn ${printRustType(type.trait)}`;
    }
    case "reference": {
      return `${type.mutable ? "&mut " : "&"}${printRustType(type.referent)}`;
    }
    case "raw-pointer": {
      return `${type.mutable ? "*mut " : "*const "}${printRustType(type.pointee)}`;
    }
    case "fixed-array": {
      return `[${printRustType(type.element)}; ${type.length}]`;
    }
    case "slice": {
      return `[${printRustType(type.element)}]`;
    }
    case "function-pointer": {
      const abiName = type.abi?.length === 1 && type.abi[0] !== "target-default"
        ? type.abi[0]
        : undefined;
      const abi = abiName === undefined ? "" : `extern ${JSON.stringify(abiName)} `;
      return `${type.isUnsafe === true ? "unsafe " : ""}${abi}fn(${type.parameters.map(printRustType).join(", ")}) -> ${printRustType(type.result)}`;
    }
    case "tuple": {
      const elements = type.elements.map(printRustType).join(", ");
      return `(${elements}${type.elements.length === 1 ? "," : ""})`;
    }
  }
}

export function indentText(depth: number): string {
  return "    ".repeat(depth);
}
