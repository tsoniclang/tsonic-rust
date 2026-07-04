import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput, TargetDiagnostic } from "@tsonic/target-api";

export interface RustPlanContext {
  readonly input: TargetCompileInput;
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly moduleNameByFileName: ReadonlyMap<string, string>;
  readonly diagnostics: TargetDiagnostic[];
  // Identifier names with a proven write (assignment or increment) in the
  // enclosing function body. `let mut` is emitted only for proven writes.
  // Both sets operate in source-name space; renaming happens at emission.
  readonly mutatedNames?: ReadonlySet<string>;
  // Emitted binding names in the enclosing function scope, used to detect
  // deterministic-rename collisions (TS fooBar and foo_bar both exist).
  readonly emittedLocalNames?: Set<string>;
  // Call nodes appearing directly under an await expression; future-carrier
  // calls anywhere else fail closed.
  readonly awaitedCalls?: WeakSet<object>;
  // Inside a fallible lowering (Result-returning fn body or try closure):
  // fallible calls take `?`, throws lower to Err returns.
  readonly fallibleContext?: boolean;
  // Structured import requirements: runtime alias prefixes used by planned
  // operations and rendered types. Never inferred from printed text.
  readonly usedAliases?: Set<string>;
}

// Target-owned runtime aliases: the shared runtime and the target's own JS
// surface crates. Capability crates contribute their aliases as row data.
export const rustRuntimeAliasImports: ReadonlyMap<string, { readonly path: string; readonly alias: string }> = new Map([
  ["js_abi", { path: "tsonic_rust_js::abi", alias: "js_abi" }],
  ["js_string", { path: "tsonic_rust_js::string", alias: "js_string" }],
  ["rt", { path: "tsonic_rust_runtime", alias: "rt" }],
]);

export function capabilityAliasImportsOf(input: object): ReadonlyMap<string, { readonly path: string; readonly alias: string }> {
  return (input as { capabilityAliasImports?: ReadonlyMap<string, { readonly path: string; readonly alias: string }> })
    .capabilityAliasImports ?? new Map();
}

export function registerAliasFromPath(
  context: { readonly usedAliases?: Set<string>; readonly input?: object },
  path: string,
): void {
  const prefix = path.split("::")[0];
  if (prefix === undefined) {
    return;
  }
  // Every operation path prefix is activation evidence; use-item assembly
  // filters to declared alias tables, and manifest generation activates
  // only crates the plan actually referenced.
  context.usedAliases?.add(prefix);
}

// Deterministic value-name policy: camelCase lowers to snake_case so
// generated code satisfies Rust naming lints. Collisions are diagnosed, not
// silently merged.
// Naming policy: this conversion applies ONLY to user-authored local
// bindings, parameters, functions, fields, and module-local items — the
// Rust lint boundary for generated user code. Provider, library, and
// capability API identity never flows through it: runtime helper names may
// differ from source names only through explicit operation-row metadata
// (target.name / target.path), which the backend emits verbatim.
export function rustLocalBindingName(name: string): string {
  if (/^[A-Z][A-Z0-9_]*$/u.test(name)) {
    // UPPER_SNAKE names are constant references and pass through unchanged.
    return name;
  }
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .toLowerCase();
}

export function isUpperSnakeName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/u.test(name);
}

export const rustReservedIdentifiers: ReadonlySet<string> = new Set([
  "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else",
  "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop",
  "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self",
  "static", "struct", "super", "trait", "true", "type", "unsafe", "use",
  "where", "while", "abstract", "become", "box", "do", "final", "macro",
  "override", "priv", "try", "typeof", "unsized", "virtual", "yield", "gen",
]);

const rustIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function isValidRustIdentifier(name: string): boolean {
  return rustIdentifierPattern.test(name) && !rustReservedIdentifiers.has(name);
}

export function diagnosticInput(context: RustPlanContext, node: Node) {
  return { ast: context.input.ast, sourceFile: context.sourceFile, node };
}

export function sourceTypePath(
  context: RustPlanContext,
  value: { readonly fileName: string; readonly typeName: string },
): string | undefined {
  const moduleName = context.moduleNameByFileName.get(value.fileName);
  if (moduleName === undefined || !isValidRustIdentifier(value.typeName)) {
    return undefined;
  }
  return moduleName === context.moduleName ? value.typeName : `crate::${moduleName}::${value.typeName}`;
}
