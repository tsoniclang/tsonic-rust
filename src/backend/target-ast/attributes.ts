export type RustAttributeLiteral =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "integer"; readonly value: bigint }
  | { readonly kind: "boolean"; readonly value: boolean };

export type RustAttributeArgument =
  | RustAttribute
  | RustAttributeLiteral
  | { readonly kind: "tuple"; readonly elements: readonly RustAttributeArgument[] };

export type RustAttribute =
  | { readonly kind: "word"; readonly path: string }
  | { readonly kind: "list"; readonly path: string; readonly arguments: readonly RustAttributeArgument[] }
  | { readonly kind: "value"; readonly path: string; readonly value: RustAttributeArgument };

export function rustWordAttribute(path: string): RustAttribute {
  return Object.freeze({ kind: "word", path });
}

export function rustListAttribute(path: string, arguments_: readonly RustAttributeArgument[]): RustAttribute {
  return Object.freeze({ kind: "list", path, arguments: Object.freeze([...arguments_]) });
}

export function rustValueAttribute(path: string, value: RustAttributeArgument): RustAttribute {
  return Object.freeze({ kind: "value", path, value });
}

export function rustDeriveAttributes(paths: readonly string[]): readonly RustAttribute[] {
  return paths.length === 0 ? [] : [rustListAttribute("derive", paths.map(rustWordAttribute))];
}

export const rustHiddenAttribute = rustListAttribute("doc", [rustWordAttribute("hidden")]);
