import { appendToLastLine, firstLine, lastLineLength, renderedFits } from "./patterns.js";
import {
  indentText,
  printRustConstArgument,
  printRustLifetime,
  printRustLifetimeParameter,
  printRustType,
  printRustTypeBound,
} from "./types.js";
import { printRustBlockStatements } from "./blocks.js";
import { printRustExpr } from "./expressions/core.js";
import { printRustExprFitted } from "./expressions/fitted.js";
import { printRustTypeFitted } from "./expressions/blocks.js";
import { rustFormatWidth } from "./formatting.js";
import type {
  RustItem,
  RustSourceFileModel,
  RustStructField,
  RustType,
  RustVisibility,
} from "../../backend/target-ast/nodes.js";
import type { RustFunctionParameterPrint } from "./formatting.js";

function printRustVisibility(visibility: RustVisibility): string {
  return visibility === "public" ? "pub " : visibility === "crate" ? "pub(crate) " : "";
}

export function printRustSourceFile(model: RustSourceFileModel): string {
  const parts: string[] = [`// ${model.headerComment}`];
  if (model.innerAttrs !== undefined) {
    parts.push(...model.innerAttrs);
  }
  for (let index = 0; index < model.items.length;) {
    const item = model.items[index]!;
    parts.push("");
    if (item.kind !== "use") {
      parts.push(printRustItem(item));
      index += 1;
      continue;
    }
    while (model.items[index]?.kind === "use") {
      parts.push(printRustItem(model.items[index]!));
      index += 1;
    }
  }
  return `${parts.join("\n")}\n`;
}

export function printRustItem(item: RustItem): string {
  switch (item.kind) {
    case "extern-crate":
      return `extern crate ${item.name};`;
    case "mod-decl": {
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      return `${attrs}${printRustVisibility(item.visibility)}mod ${item.name};`;
    }
    case "use": {
      const visibility = printRustVisibility(item.visibility ?? "private");
      return item.alias === undefined
        ? `${visibility}use ${item.path};`
        : `${visibility}use ${item.path} as ${item.alias};`;
    }
    case "type-alias": {
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const generics = printRustGenerics(item.generics);
      const prefix = appendRustWhereTerminator(
        `${printRustVisibility(item.visibility)}type ${item.name}${generics.parameters}`,
        generics,
        0,
        "=",
      );
      const target = printRustType(item.target);
      if (renderedFits(`${prefix} ${target};`, 0)) {
        return `${attrs}${prefix} ${target};`;
      }
      const targetIndent = indentText(1);
      if (!target.includes("\n") && renderedFits(`${target};`, targetIndent.length)) {
        return `${attrs}${prefix}\n${targetIndent}${target};`;
      }
      const prefixColumn = lastLineLength(prefix);
      const fitted = printRustTypeFitted(item.target, 0, prefixColumn + 1);
      if (prefixColumn + 1 + firstLine(fitted).length <= rustFormatWidth) {
        return `${attrs}${appendToLastLine(`${prefix} ${fitted}`, ";")}`;
      }
      return `${attrs}${prefix}\n${appendToLastLine(`${targetIndent}${printRustTypeFitted(item.target, 1, targetIndent.length)}`, ";")}`;
    }
    case "const": {
      const constAttrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const prefix = `${constAttrs}${printRustVisibility(item.visibility)}const ${item.name}: ${printRustType(item.type)} = `;
      return `${prefix}${printRustExprFitted(item.value, 0, lastLineLength(prefix) + 1)};`;
    }
    case "thread-local": {
      const attrs = (item.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
      const value = printRustExpr(item.value);
      const initializer = item.constInitializer ? `const { ${value} }` : value;
      const declaration = `${printRustVisibility(item.visibility)}static ${item.name}: ${printRustType(item.type)} = ${initializer};`;
      return `std::thread_local! {\n${attrs}    ${declaration}\n}`;
    }
    case "struct": {
      const structAttrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const generics = printRustGenerics(item.generics);
      const header = `${structAttrs}${derives}${appendRustWhereTerminator(
        `${printRustVisibility(item.visibility)}struct ${item.name}${generics.parameters}`,
        generics,
        0,
        "{",
      )}`;
      const fields = item.fields.map(printRustStructField).join("\n");
      return fields.length === 0 ? `${header}}` : `${header}\n${fields}\n}`;
    }
    case "enum": {
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const derives = item.derives.length === 0 ? "" : `#[derive(${item.derives.join(", ")})]\n`;
      const variants = item.variants
        .map((variant) => {
          const variantAttrs = (variant.attrs ?? [])
            .map((attr) => `    ${attr}\n`)
            .join("");
          const fields = variant.fields === undefined
            ? ""
            : `(${variant.fields.map(printRustType).join(", ")})`;
          const discriminant = variant.discriminant === undefined
            ? ""
            : ` = ${variant.discriminant}`;
          return `${variantAttrs}    ${variant.name}${fields}${discriminant},`;
        })
        .join("\n");
      const generics = printRustGenerics(item.generics);
      const header = appendRustWhereTerminator(
        `${printRustVisibility(item.visibility)}enum ${item.name}${generics.parameters}`,
        generics,
        0,
        "{",
      );
      return `${attrs}${derives}${header}\n${variants}\n}`;
    }
    case "trait": {
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const generics = printRustGenerics(item.generics);
      const renderedSuperTraits = item.superTraits?.map(printRustType) ?? [];
      const superTraits = renderedSuperTraits.length === 0
        ? ""
        : `: ${renderedSuperTraits.join(" + ")}`;
      const functions = item.functions.map((fn) => {
        const selfParam = printRustSelfParam(fn.selfParam);
        const params = fn.params.map(rustFunctionParameter);
        const allParams = selfParam === undefined ? params : [selfParam, ...params];
        const fnAttrs = (fn.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
        const prefix = `    ${fn.isUnsafe === true ? "unsafe " : ""}fn `;
        const generics = printRustGenerics(fn.generics);
        const returnType = rustFunctionReturnType(fn.returnType, fn.errorType);
        if (fn.body === undefined) {
          return `${fnAttrs}${printRustFunctionSignature(
            prefix,
            fn.name,
            generics,
            allParams,
            returnType,
            1,
          )}`;
        }
        const header = `${fnAttrs}${printRustFunctionHeader(
          prefix,
          fn.name,
          generics,
          allParams,
          returnType,
          1,
        )}`;
        const body = printRustBlockStatements(fn.body, 2);
        return body.length === 0 ? `${header}}` : `${header}\n${body}\n    }`;
      }).join("\n");
      const declaration = `${printRustVisibility(item.visibility)}trait ${item.name}${generics.parameters}`;
      const flatHeader = `${declaration}${superTraits}`;
      const traitHeader = `${flatHeader} {`;
      const expanded = renderedSuperTraits.length > 0 &&
        (traitHeader.length > rustFormatWidth ||
          functions.length > 0 &&
            traitHeader.length + printRustVisibility(item.visibility).length >
              rustFormatWidth - indentText(1).length);
      const headerBase = expanded
        ? `${declaration}:\n    ${renderedSuperTraits.join(" + ")}`
        : flatHeader;
      const header = appendRustWhereTerminator(
        headerBase,
        generics,
        0,
        functions.length === 0 ? "{}" : "{",
        expanded,
      );
      return functions.length === 0
        ? `${attrs}${header}`
        : `${attrs}${header}\n${functions}\n}`;
    }
    case "impl": {
      const constants = (item.constants ?? []).map((constant) => {
        const attrs = (constant.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
        const visibility = item.trait === undefined
          ? printRustVisibility(constant.visibility)
          : "";
        return `${attrs}    ${visibility}const ${constant.name}: ${printRustType(constant.type)} = ${printRustExpr(constant.value)};`;
      });
      const functions = item.functions.map((fn) => {
        const selfPrefix = printRustSelfParam(fn.selfParam);
        const params = fn.params.map(rustFunctionParameter);
        const allParams = selfPrefix === undefined ? params : [selfPrefix, ...params];
        const fnAttrs = (fn.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
        const visibility = item.trait === undefined ? printRustVisibility(fn.visibility) : "";
        const generics = printRustGenerics(fn.generics);
        const header = `${fnAttrs}${printRustFunctionHeader(
          `    ${visibility}${fn.isAsync === true ? "async " : ""}${fn.isUnsafe === true ? "unsafe " : ""}fn `,
          fn.name,
          generics,
          allParams,
          rustFunctionReturnType(fn.returnType, fn.errorType),
          1,
        )}`;
        const body = printRustBlockStatements(fn.body, 2);
        return body.length === 0 ? `${header}}` : `${header}\n${body}\n    }`;
      });
      const rendered = [...constants, ...functions].join("\n\n");
      const generics = printRustGenerics(item.generics);
      const target = printRustType(item.target);
      const trait = item.trait === undefined ? undefined : printRustType(item.trait);
      const flatDeclaration = trait === undefined
        ? `impl${generics.parameters} ${target}`
        : `impl${generics.parameters} ${trait} for ${target}`;
      const declaration = trait !== undefined && `${flatDeclaration} {`.length > rustFormatWidth
        ? `impl${generics.parameters} ${trait}\n    for ${target}`
        : flatDeclaration;
      const header = appendRustWhereTerminator(
        declaration,
        generics,
        0,
        rendered.length === 0 ? "{}" : "{",
        declaration.includes("\n"),
      );
      return rendered.length === 0 ? header : `${header}\n${rendered}\n}`;
    }
    case "function": {
      const params = item.params.map(rustFunctionParameter);
      const generics = printRustGenerics(item.generics);
      const attrs = (item.attrs ?? []).map((attr) => `${attr}\n`).join("");
      const header = `${attrs}${printRustFunctionHeader(
        `${printRustVisibility(item.visibility)}${item.isAsync === true ? "async " : ""}${item.isUnsafe === true ? "unsafe " : ""}fn `,
        item.name,
        generics,
        params,
        rustFunctionReturnType(item.returnType, item.errorType),
        0,
      )}`;
      const body = printRustBlockStatements(item.body, 1);
      return body.length === 0 ? `${header}}` : `${header}\n${body}\n}`;
    }
  }
}

function printRustStructField(field: RustStructField): string {
  const attrs = (field.attrs ?? []).map((attr) => `    ${attr}\n`).join("");
  const prefix = `    ${printRustVisibility(field.visibility)}${field.name}:`;
  const flatType = printRustType(field.type);
  const flat = `${prefix} ${flatType},`;
  if (!flatType.includes("\n") && renderedFits(flat, 0)) {
    return `${attrs}${flat}`;
  }
  const typeIndent = indentText(2);
  if (!flatType.includes("\n") && renderedFits(`${flatType},`, typeIndent.length)) {
    return `${attrs}${prefix}\n${typeIndent}${flatType},`;
  }
  const fittedAtField = printRustTypeFitted(
    field.type,
    1,
    prefix.length + 1,
  );
  if (firstLine(fittedAtField).length + prefix.length + 1 <= rustFormatWidth) {
    return `${attrs}${appendToLastLine(`${prefix} ${fittedAtField}`, ",")}`;
  }
  return `${attrs}${[
    prefix,
    appendToLastLine(
      `${typeIndent}${printRustTypeFitted(field.type, 2, typeIndent.length)}`,
      ",",
    ),
  ].join("\n")}`;
}

function printRustSelfParam(
  selfParam: import("../../backend/target-ast/nodes.js").RustSelfParam | undefined,
): RustFunctionParameterPrint | undefined {
  return selfParam === undefined
    ? undefined
    : selfParam.kind === "value"
      ? { prefix: "self" }
      : selfParam.kind === "reference"
        ? {
            prefix: `&${selfParam.lifetime === undefined ? "" : `${printRustLifetime(selfParam.lifetime)} `}${selfParam.mutable ? "mut " : ""}self`,
          }
        : {
            prefix: "self: ",
            type: {
              kind: "named",
              path: "alloc::rc::Rc",
              genericArguments: [{
                kind: "type",
                type: { kind: "named", path: "Self" },
              }],
            },
          };
}

function rustFunctionParameter(
  parameter: { readonly name: string; readonly mutable?: boolean; readonly type: RustType },
): RustFunctionParameterPrint {
  return {
    prefix: `${parameter.mutable === true ? "mut " : ""}${parameter.name}: `,
    type: parameter.type,
  };
}

function printRustFunctionParameterFlat(parameter: RustFunctionParameterPrint): string {
  return parameter.type === undefined
    ? parameter.prefix
    : `${parameter.prefix}${printRustType(parameter.type)}`;
}

function printRustFunctionParameterFitted(
  parameter: RustFunctionParameterPrint,
  depth: number,
): string {
  const indent = indentText(depth);
  if (parameter.type === undefined) {
    return `${indent}${parameter.prefix},`;
  }
  const renderedType = printRustTypeFitted(
    parameter.type,
    depth,
    indent.length + parameter.prefix.length,
  );
  return appendToLastLine(`${indent}${parameter.prefix}${renderedType}`, ",");
}

function printRustGenerics(
  generics: import("../../backend/target-ast/nodes.js").RustGenerics,
): PrintedRustGenerics {
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

interface PrintedRustGenerics {
  readonly parameters: string;
  readonly wherePredicates: readonly string[];
}

function appendRustWhereTerminator(
  declaration: string,
  generics: PrintedRustGenerics,
  depth: number,
  terminator: "{" | "{}" | "=" | ";",
  breakWithoutWhere = false,
): string {
  const declarationIndent = indentText(depth);
  if (generics.wherePredicates.length === 0) {
    if (terminator === ";") return `${declaration};`;
    if (terminator === "{}" && breakWithoutWhere) {
      return `${declaration}\n${declarationIndent}{\n${declarationIndent}}`;
    }
    const separator = breakWithoutWhere ? `\n${declarationIndent}` : " ";
    return `${declaration}${separator}${terminator}`;
  }
  const predicateIndent = indentText(depth + 1);
  const predicates = generics.wherePredicates.map((predicate, index) => {
    const isSignatureTerminator = terminator === ";" &&
      index === generics.wherePredicates.length - 1;
    return `${predicateIndent}${predicate}${isSignatureTerminator ? ";" : ","}`;
  });
  return [
    declaration,
    `${declarationIndent}where`,
    ...predicates,
    ...(terminator === ";" ? [] : [`${declarationIndent}${terminator}`]),
  ].join("\n");
}

function rustFunctionReturnType(returnType: RustType | undefined, errorType: RustType | undefined): RustType | undefined {
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

function printRustFittedReturnSuffix(
  returnType: RustType | undefined,
  depth: number,
  column: number,
): string {
  return returnType === undefined
    ? ""
    : ` -> ${printRustTypeFitted(returnType, depth, column + " -> ".length)}`;
}

function printRustFunctionHeader(
  prefix: string,
  name: string,
  generics: PrintedRustGenerics,
  parameters: readonly RustFunctionParameterPrint[],
  returnType: RustType | undefined,
  depth: number,
): string {
  const flatReturnSuffix = printRustReturnSuffix(returnType);
  const flatParameters = parameters.map(printRustFunctionParameterFlat);
  const flat = `${prefix}${name}${generics.parameters}(${flatParameters.join(", ")})${flatReturnSuffix}`;
  const flatTerminatorWidth = generics.wherePredicates.length === 0 ? " {".length : 0;
  if (flat.length + flatTerminatorWidth <= rustFormatWidth) {
    return appendRustWhereTerminator(flat, generics, depth, "{");
  }
  const closingIndent = indentText(depth);
  const closingPrefix = parameters.length === 0
    ? `${prefix}${name}${generics.parameters}()`
    : `${closingIndent})`;
  const flatClosingLine = `${closingPrefix}${flatReturnSuffix}`;
  const flatReturnType = returnType === undefined ? "" : printRustType(returnType);
  const rustfmtReturnOverflowAllowance = 2;
  const flatReturnTypeLimit = rustFormatWidth - indentText(1).length -
    ") -> ".length + rustfmtReturnOverflowAllowance;
  const selectedReturnSuffix = lastLineLength(flatClosingLine) <= rustFormatWidth ||
      flatReturnType.length <= flatReturnTypeLimit
    ? flatReturnSuffix
    : printRustFittedReturnSuffix(
        returnType,
        depth,
        closingPrefix.length + 1,
      );
  const declaration = [
    ...(parameters.length === 0
      ? []
      : [
          `${prefix}${name}${generics.parameters}(`,
          ...parameters.map((parameter) => printRustFunctionParameterFitted(parameter, depth + 1)),
        ]),
    `${closingPrefix}${selectedReturnSuffix}`,
  ].join("\n");
  const returnHasOverwideLine = selectedReturnSuffix
    .split("\n")
    .some((line) => line.length > rustFormatWidth);
  return appendRustWhereTerminator(
    declaration,
    generics,
    depth,
    "{",
    returnHasOverwideLine ||
      !selectedReturnSuffix.includes("\n") &&
        lastLineLength(declaration) + " {".length >= rustFormatWidth - 3,
  );
}

function printRustFunctionSignature(
  prefix: string,
  name: string,
  generics: PrintedRustGenerics,
  parameters: readonly RustFunctionParameterPrint[],
  returnType: RustType | undefined,
  depth: number,
): string {
  const returnSuffix = printRustReturnSuffix(returnType);
  const flatParameters = parameters.map(printRustFunctionParameterFlat);
  const invocation = `${prefix}${name}${generics.parameters}(${flatParameters.join(", ")})`;
  const flat = `${invocation}${returnSuffix}`;
  const terminatedLength = flat.length + ";".length;
  if (terminatedLength < rustFormatWidth ||
    terminatedLength === rustFormatWidth && returnSuffix.length === 0) {
    return appendRustWhereTerminator(flat, generics, depth, ";");
  }
  if (terminatedLength === rustFormatWidth && returnSuffix.length > 0) {
    return appendRustWhereTerminator(
      `${invocation}\n${indentText(depth + 1)}${returnSuffix.trimStart()}`,
      generics,
      depth,
      ";",
    );
  }
  const closingIndent = indentText(depth);
  const closingPrefix = parameters.length === 0
    ? `${prefix}${name}${generics.parameters}()`
    : `${closingIndent})`;
  const fittedReturnSuffix = printRustFittedReturnSuffix(
    returnType,
    depth,
    closingPrefix.length,
  );
  const declaration = [
    ...(parameters.length === 0
      ? []
      : [
          `${prefix}${name}${generics.parameters}(`,
          ...parameters.map((parameter) => printRustFunctionParameterFitted(parameter, depth + 1)),
        ]),
    `${closingPrefix}${fittedReturnSuffix}`,
  ].join("\n");
  return appendRustWhereTerminator(declaration, generics, depth, ";");
}

function printRustGenericParameter(
  parameter: import("../../backend/target-ast/nodes.js").RustGenericParameter,
): string {
  if (parameter.kind === "lifetime") {
    return printRustLifetimeParameter(parameter);
  }
  if (parameter.kind === "const") {
    const value = parameter.defaultValue === undefined
      ? ""
      : ` = ${printRustConstArgument(parameter.defaultValue)}`;
    return `const ${parameter.name}: ${printRustType(parameter.type)}${value}`;
  }
  const bounds = parameter.bounds.length === 0
    ? ""
    : `: ${parameter.bounds.map(printRustTypeBound).join(" + ")}`;
  const defaultType = parameter.defaultType === undefined
    ? ""
    : ` = ${printRustType(parameter.defaultType)}`;
  return `${parameter.name}${bounds}${defaultType}`;
}
