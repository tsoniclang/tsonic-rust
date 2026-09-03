import { printRustBlockStatements } from "./blocks.js";
import { printRustExpr } from "./expressions/core.js";
import {
  indentText,
  printRustConstArgument,
  printRustLifetime,
  printRustLifetimeParameter,
  printRustType,
  printRustTypeBound,
} from "./types.js";
import type {
  RustGenerics,
  RustGenericParameter,
  RustImplFunction,
  RustItem,
  RustSelfParam,
  RustSourceFileModel,
  RustStructField,
  RustTraitFunction,
  RustType,
  RustVisibility,
} from "../../backend/target-ast/nodes.js";

export function printRustSourceFile(model: RustSourceFileModel): string {
  const sections: string[] = [`// ${model.headerComment}`];
  if (model.innerAttrs !== undefined) {
    sections.push(...model.innerAttrs);
  }
  let previousWasUse = false;
  for (const item of model.items) {
    const currentIsUse = item.kind === "use";
    sections.push(previousWasUse && currentIsUse ? printRustItem(item) : `\n${printRustItem(item)}`);
    previousWasUse = currentIsUse;
  }
  return `${sections.join("\n")}\n`;
}

export function printRustItem(item: RustItem): string {
  switch (item.kind) {
    case "extern-crate":
      return `extern crate ${item.name};`;
    case "mod-decl":
      return `${printAttributes(item.attrs, 0)}${printRustVisibility(item.visibility)}mod ${item.name};`;
    case "use": {
      const visibility = printRustVisibility(item.visibility ?? "private");
      return item.alias === undefined
        ? `${visibility}use ${item.path};`
        : `${visibility}use ${item.path} as ${item.alias};`;
    }
    case "type-alias": {
      const generics = printRustGenerics(item.generics);
      const declaration = `${printRustVisibility(item.visibility)}type ${item.name}${generics.parameters}`;
      return `${printAttributes(item.attrs, 0)}${appendRustWhereEnding(
        declaration,
        generics,
        0,
        `= ${printRustType(item.target)};`,
      )}`;
    }
    case "const":
      return `${printAttributes(item.attrs, 0)}${printRustVisibility(item.visibility)}const ${item.name}: ${printRustType(item.type)} = ${printRustExpr(item.value)};`;
    case "thread-local": {
      const value = printRustExpr(item.value);
      const initializer = item.constInitializer ? `const { ${value} }` : value;
      const declaration = `${printRustVisibility(item.visibility)}static ${item.name}: ${printRustType(item.type)} = ${initializer};`;
      return `std::thread_local! {\n${printAttributes(item.attrs, 1)}    ${declaration}\n}`;
    }
    case "struct": {
      const generics = printRustGenerics(item.generics);
      const declaration = `${printRustVisibility(item.visibility)}struct ${item.name}${generics.parameters}`;
      const header = appendRustWhereEnding(declaration, generics, 0, "{");
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const fields = item.fields.map(printRustStructField).join("\n");
      return `${printAttributes(item.attrs, 0)}${derives}${header}${fields.length === 0 ? "}" : `\n${fields}\n}`}`;
    }
    case "enum": {
      const generics = printRustGenerics(item.generics);
      const declaration = `${printRustVisibility(item.visibility)}enum ${item.name}${generics.parameters}`;
      const header = appendRustWhereEnding(declaration, generics, 0, "{");
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const variants = item.variants.map((variant) => {
        const fields = variant.fields === undefined
          ? ""
          : `(${variant.fields.map(printRustType).join(", ")})`;
        const discriminant = variant.discriminant === undefined
          ? ""
          : ` = ${variant.discriminant}`;
        return `${printAttributes(variant.attrs, 1)}    ${variant.name}${fields}${discriminant},`;
      }).join("\n");
      return `${printAttributes(item.attrs, 0)}${derives}${header}\n${variants}\n}`;
    }
    case "trait": {
      const generics = printRustGenerics(item.generics);
      const superTraits = item.superTraits === undefined || item.superTraits.length === 0
        ? ""
        : `: ${item.superTraits.map(printRustType).join(" + ")}`;
      const declaration = `${printRustVisibility(item.visibility)}trait ${item.name}${generics.parameters}${superTraits}`;
      const header = appendRustWhereEnding(declaration, generics, 0, "{");
      const functions = item.functions.map(printRustTraitFunction).join("\n");
      return `${printAttributes(item.attrs, 0)}${header}${functions.length === 0 ? "}" : `\n${functions}\n}`}`;
    }
    case "impl": {
      const generics = printRustGenerics(item.generics);
      const target = printRustType(item.target);
      const declaration = item.trait === undefined
        ? `impl${generics.parameters} ${target}`
        : `impl${generics.parameters} ${printRustType(item.trait)} for ${target}`;
      const header = appendRustWhereEnding(declaration, generics, 0, "{");
      const constants = (item.constants ?? []).map((constant) => {
        const visibility = item.trait === undefined
          ? printRustVisibility(constant.visibility)
          : "";
        return `${printAttributes(constant.attrs, 1)}    ${visibility}const ${constant.name}: ${printRustType(constant.type)} = ${printRustExpr(constant.value)};`;
      });
      const functions = item.functions.map((fn) => printRustImplFunction(fn, item.trait === undefined));
      const members = [...constants, ...functions].join("\n\n");
      return members.length === 0 ? `${header}}` : `${header}\n${members}\n}`;
    }
    case "function":
      return printRustFunction(item);
  }
}

function printRustStructField(field: RustStructField): string {
  return `${printAttributes(field.attrs, 1)}    ${printRustVisibility(field.visibility)}${field.name}: ${printRustType(field.type)},`;
}

function printRustTraitFunction(fn: RustTraitFunction): string {
  const generics = printRustGenerics(fn.generics);
  const parameters = printRustParameters(fn.selfParam, fn.params);
  const signature = `    ${fn.isUnsafe === true ? "unsafe " : ""}fn ${fn.name}${generics.parameters}(${parameters})${printRustReturnSuffix(rustFunctionReturnType(fn.returnType, fn.errorType))}`;
  const attrs = printAttributes(fn.attrs, 1);
  if (fn.body === undefined) {
    return `${attrs}${appendRustWhereEnding(signature, generics, 1, ";")}`;
  }
  const header = appendRustWhereEnding(signature, generics, 1, "{");
  const body = printRustBlockStatements(fn.body, 2);
  return `${attrs}${header}${body.length === 0 ? "}" : `\n${body}\n    }`}`;
}

function printRustImplFunction(fn: RustImplFunction, inherent: boolean): string {
  const generics = printRustGenerics(fn.generics);
  const parameters = printRustParameters(fn.selfParam, fn.params);
  const signature = `    ${inherent ? printRustVisibility(fn.visibility) : ""}${fn.isAsync === true ? "async " : ""}${fn.isUnsafe === true ? "unsafe " : ""}fn ${fn.name}${generics.parameters}(${parameters})${printRustReturnSuffix(rustFunctionReturnType(fn.returnType, fn.errorType))}`;
  const header = appendRustWhereEnding(signature, generics, 1, "{");
  const body = printRustBlockStatements(fn.body, 2);
  return `${printAttributes(fn.attrs, 1)}${header}${body.length === 0 ? "}" : `\n${body}\n    }`}`;
}

function printRustFunction(
  item: Extract<RustItem, { readonly kind: "function" }>,
): string {
  const generics = printRustGenerics(item.generics);
  const signature = `${printRustVisibility(item.visibility)}${item.isAsync === true ? "async " : ""}${item.isUnsafe === true ? "unsafe " : ""}fn ${item.name}${generics.parameters}(${printRustParameters(undefined, item.params)})${printRustReturnSuffix(rustFunctionReturnType(item.returnType, item.errorType))}`;
  const header = appendRustWhereEnding(signature, generics, 0, "{");
  const body = printRustBlockStatements(item.body, 1);
  return `${printAttributes(item.attrs, 0)}${header}${body.length === 0 ? "}" : `\n${body}\n}`}`;
}

function printRustParameters(
  selfParam: RustSelfParam | undefined,
  parameters: readonly { readonly name: string; readonly mutable?: boolean; readonly type: RustType }[],
): string {
  const self = printRustSelfParam(selfParam);
  const rest = parameters.map((parameter) =>
    `${parameter.mutable === true ? "mut " : ""}${parameter.name}: ${printRustType(parameter.type)}`);
  return [...(self === undefined ? [] : [self]), ...rest].join(", ");
}

function printRustSelfParam(selfParam: RustSelfParam | undefined): string | undefined {
  if (selfParam === undefined) {
    return undefined;
  }
  if (selfParam.kind === "value") {
    return "self";
  }
  if (selfParam.kind === "reference") {
    const lifetime = selfParam.lifetime === undefined
      ? ""
      : `${printRustLifetime(selfParam.lifetime)} `;
    return `&${lifetime}${selfParam.mutable ? "mut " : ""}self`;
  }
  return "self: alloc::rc::Rc<Self>";
}

interface PrintedRustGenerics {
  readonly parameters: string;
  readonly wherePredicates: readonly string[];
}

function printRustGenerics(generics: RustGenerics): PrintedRustGenerics {
  return {
    parameters: generics.parameters.length === 0
      ? ""
      : `<${generics.parameters.map(printRustGenericParameter).join(", ")}>`,
    wherePredicates: generics.wherePredicates.map((predicate) => {
      if (predicate.kind === "lifetime") {
        return `${printRustLifetime(predicate.lifetime)}: ${predicate.outlives.map(printRustLifetime).join(" + ")}`;
      }
      const binder = predicate.binder === undefined || predicate.binder.length === 0
        ? ""
        : `for<${predicate.binder.map(printRustLifetimeParameter).join(", ")}> `;
      return `${binder}${printRustType(predicate.type)}: ${predicate.bounds.map(printRustTypeBound).join(" + ")}`;
    }),
  };
}

function appendRustWhereEnding(
  declaration: string,
  generics: PrintedRustGenerics,
  depth: number,
  ending: string,
): string {
  if (generics.wherePredicates.length === 0) {
    return ending === ";" ? `${declaration};` : `${declaration} ${ending}`;
  }
  const indent = indentText(depth);
  const predicateIndent = indentText(depth + 1);
  if (ending === ";") {
    return [
      declaration,
      `${indent}where`,
      ...generics.wherePredicates.map((predicate, index) =>
        `${predicateIndent}${predicate}${index === generics.wherePredicates.length - 1 ? ";" : ","}`),
    ].join("\n");
  }
  return [
    declaration,
    `${indent}where`,
    ...generics.wherePredicates.map((predicate) => `${predicateIndent}${predicate},`),
    `${indent}${ending}`,
  ].join("\n");
}

function rustFunctionReturnType(
  returnType: RustType | undefined,
  errorType: RustType | undefined,
): RustType | undefined {
  return errorType === undefined
    ? returnType
    : {
        kind: "named",
        path: "Result",
        genericArguments: [
          { kind: "type", type: returnType ?? { kind: "unit" } },
          { kind: "type", type: errorType },
        ],
      };
}

function printRustReturnSuffix(returnType: RustType | undefined): string {
  return returnType === undefined ? "" : ` -> ${printRustType(returnType)}`;
}

function printRustGenericParameter(parameter: RustGenericParameter): string {
  if (parameter.kind === "lifetime") {
    return printRustLifetimeParameter(parameter);
  }
  if (parameter.kind === "const") {
    const defaultValue = parameter.defaultValue === undefined
      ? ""
      : ` = ${printRustConstArgument(parameter.defaultValue)}`;
    return `const ${parameter.name}: ${printRustType(parameter.type)}${defaultValue}`;
  }
  const bounds = parameter.bounds.length === 0
    ? ""
    : `: ${parameter.bounds.map(printRustTypeBound).join(" + ")}`;
  const defaultType = parameter.defaultType === undefined
    ? ""
    : ` = ${printRustType(parameter.defaultType)}`;
  return `${parameter.name}${bounds}${defaultType}`;
}

function printRustVisibility(visibility: RustVisibility): string {
  return visibility === "public" ? "pub " : visibility === "crate" ? "pub(crate) " : "";
}

function printAttributes(attrs: readonly string[] | undefined, depth: number): string {
  const indent = indentText(depth);
  return attrs?.map((attr) => `${indent}${attr}\n`).join("") ?? "";
}
