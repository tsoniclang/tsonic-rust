export type RustAttributeLiteral =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "integer"; readonly value: bigint }
  | { readonly kind: "boolean"; readonly value: boolean };

export type RustAttributeArgument =
  | RustAttribute
  | RustAttributeLiteral
  | { readonly kind: "tuple"; readonly elements: readonly RustAttributeArgument[] };

export interface RustAttribute {
  readonly path: string;
  readonly tokens: readonly RustTokenTree[];
}

export function rustWordAttribute(path: string): RustAttribute {
  return Object.freeze({ path, tokens: Object.freeze([]) });
}

export function rustListAttribute(path: string, arguments_: readonly RustAttributeArgument[]): RustAttribute {
  return Object.freeze({ path, tokens: Object.freeze([Object.freeze({
    kind: "group" as const, delimiter: "parentheses" as const, tokens: argumentTokens(arguments_),
  })]) });
}

export function rustValueAttribute(path: string, value: RustAttributeArgument): RustAttribute {
  return Object.freeze({ path, tokens: Object.freeze([
    Object.freeze({ kind: "punctuation" as const, text: "=", joint: false }), ...valueTokens(value),
  ]) });
}

export function rustDeriveAttributes(paths: readonly string[]): readonly RustAttribute[] {
  return paths.length === 0 ? [] : [rustListAttribute("derive", paths.map(rustWordAttribute))];
}

export const rustHiddenAttribute = rustListAttribute("doc", [rustWordAttribute("hidden")]);

function argumentTokens(arguments_: readonly RustAttributeArgument[]): readonly RustTokenTree[] {
  return Object.freeze(arguments_.flatMap((argument, index): readonly RustTokenTree[] => [
    ...(index === 0 ? [] : [Object.freeze({ kind: "punctuation" as const, text: ",", joint: false })]),
    ...valueTokens(argument),
  ]));
}

function valueTokens(argument: RustAttributeArgument): readonly RustTokenTree[] {
  if ("path" in argument) return [Object.freeze({ kind: "fragment", fragment: Object.freeze({
    kind: "expression", expression: Object.freeze({ kind: "path", path: argument.path }),
  }) }), ...argument.tokens];
  if (argument.kind === "tuple") return [Object.freeze({
    kind: "group", delimiter: "parentheses", tokens: Object.freeze([
      ...argumentTokens(argument.elements),
      ...(argument.elements.length === 1
        ? [Object.freeze({ kind: "punctuation" as const, text: ",", joint: false })] : []),
    ]),
  })];
  return [Object.freeze({ kind: "fragment", fragment: Object.freeze({
    kind: "expression", expression: Object.freeze(argument.kind === "string"
      ? { kind: "str-literal", value: argument.value }
      : argument.kind === "boolean" ? { kind: "bool-literal", value: argument.value }
        : { kind: "int-literal", text: String(argument.value) }),
  }) })];
}
import type { RustTokenTree } from "./macro-input.js";
