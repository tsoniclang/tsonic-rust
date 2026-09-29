import type { RustAttribute } from "../attributes.js";
import type { RustExpr, RustGenerics, RustImplFunction, RustItem, RustPattern, RustStmt, RustTraitFunction } from "../nodes.js";
import { rustLintAttributes } from "./lint-policy.js";

export type RustNameStyle = "snake" | "camel" | "upper";

export function rustNameNeedsStyleAllowance(name: string, style: RustNameStyle): boolean {
  const semantic = name.startsWith("r#") ? name.slice(2) : name;
  if (style === "upper") return [...semantic].some(character => character.toUpperCase() !== character);
  const trimmed = semantic.replace(/^'+/u, "").replace(/^_+|_+$/gu, "");
  if (style === "snake") {
    return trimmed.includes("__") || [...trimmed].some(character => character.toLowerCase() !== character);
  }
  const characters = [...trimmed];
  if (characters[0] !== undefined && /\p{Changes_When_Titlecased}/u.test(characters[0])) return true;
  return characters.some((character, index) => {
    const previous = characters[index - 1];
    return previous === "_" && (character === "_" || characterHasCase(character)) ||
      character === "_" && previous !== undefined && characterHasCase(previous) ||
      /\p{Uppercase}/u.test(character) && /\p{Changes_When_Titlecased}/u.test(character);
  });
}

function characterHasCase(character: string): boolean {
  return /[\p{Changes_When_Lowercased}\p{Changes_When_Titlecased}]/u.test(character);
}

export function appendRustNamingAllowance(
  attrs: readonly RustAttribute[] | undefined, style: RustNameStyle,
): readonly RustAttribute[] {
  const attribute = style === "snake" ? rustLintAttributes.nonSnakeCaseName
    : style === "camel" ? rustLintAttributes.nonCamelCaseType : rustLintAttributes.nonUpperCaseGlobal;
  return attrs?.includes(attribute) === true ? attrs : [...attrs ?? [], attribute];
}

function named<Value extends { readonly name: string; readonly attrs?: readonly RustAttribute[] }>(
  value: Value, style: RustNameStyle,
): Value {
  return rustNameNeedsStyleAllowance(value.name, style)
    ? { ...value, attrs: appendRustNamingAllowance(value.attrs, style) } : value;
}

function generic<Value extends { readonly generics: RustGenerics; readonly attrs?: readonly RustAttribute[] }>(value: Value): Value {
  let attrs = value.attrs;
  for (const parameter of value.generics.parameters) {
    const style = parameter.kind === "lifetime" ? "snake" : parameter.kind === "const" ? "upper" : "camel";
    if (rustNameNeedsStyleAllowance(parameter.name, style)) attrs = appendRustNamingAllowance(attrs, style);
  }
  return attrs === value.attrs ? value : { ...value, attrs };
}

export function finalizeRustFunctionNames<Value extends RustImplFunction | RustTraitFunction>(
  value: Value, checkName = true,
): Value {
  const fn = generic(checkName ? named(value, "snake") : value);
  return fn.params.some(parameter => rustNameNeedsStyleAllowance(parameter.name, "snake"))
    ? { ...fn, attrs: appendRustNamingAllowance(fn.attrs, "snake") } : fn;
}

export function finalizeRustItemNames(item: RustItem): RustItem {
  switch (item.kind) {
    case "function": return finalizeRustFunctionNames(item);
    case "mod-decl": return named(item, "snake");
    case "const":
    case "thread-local": return named(item, "upper");
    case "struct": {
      const declaration = generic(namedType(item));
      return item.fields.some(field => rustNameNeedsStyleAllowance(field.name, "snake"))
        ? { ...declaration, attrs: appendRustNamingAllowance(declaration.attrs, "snake") } : declaration;
    }
    case "enum": return { ...generic(namedType(item)), variants: item.variants.map(variant => named(variant, "camel")) };
    case "type-alias": return generic(namedType(item));
    case "trait": return { ...generic(namedType(item)), members: item.members.map(member =>
      member.kind === "type" ? named(member, "camel") : member) };
    case "impl": return { ...generic(item), members: item.members.map(member =>
      member.kind === "const" && item.trait === undefined ? named(member, "upper") : member) };
    case "extern-crate":
    case "use": return item;
  }
}

function namedType<Value extends { readonly name: string; readonly attrs?: readonly RustAttribute[] }>(value: Value): Value {
  const hasCRepresentation = value.attrs?.some(attribute => attribute.kind === "list" && attribute.path === "repr" &&
    attribute.arguments.some(argument => argument.kind === "word" && argument.path === "C")) === true;
  return hasCRepresentation ? value : named(value, "camel");
}

export function rustStatementDeclaresNonSnakeName(statement: RustStmt): boolean {
  switch (statement.kind) {
    case "let": return rustNameNeedsStyleAllowance(statement.name, "snake");
    case "for":
    case "while-let-some":
    case "if-let-some": return rustNameNeedsStyleAllowance(statement.binding, "snake");
    case "try-scope": return statement.catchClause !== undefined &&
      rustNameNeedsStyleAllowance(statement.catchClause.binding, "snake");
    default: return false;
  }
}

export function rustExpressionDeclaresNonSnakeName(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "closure":
    case "closure-block": return expression.params.some(parameter => rustNameNeedsStyleAllowance(parameter.name, "snake"));
    case "block": return expression.bindings.some(binding => rustNameNeedsStyleAllowance(binding.name, "snake"));
    case "match": return expression.arms.some(arm => patternDeclaresNonSnakeName(arm.pattern));
    case "matches": return patternDeclaresNonSnakeName(expression.pattern);
    default: return false;
  }
}

function patternDeclaresNonSnakeName(pattern: RustPattern): boolean {
  switch (pattern.kind) {
    case "binding": return rustNameNeedsStyleAllowance(pattern.name, "snake");
    case "tuple":
    case "tuple-variant": return pattern.elements.some(patternDeclaresNonSnakeName);
    case "or": return pattern.alternatives.some(patternDeclaresNonSnakeName);
    case "path":
    case "wildcard": return false;
  }
}
