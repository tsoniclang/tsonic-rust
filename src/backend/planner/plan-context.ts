import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api";
import type { RustTranslationContext } from "../../translate/context.js";
import type { RustGenericRequirementSet } from "./generic-requirements.js";
import type { RustGeneratorFact } from "../../source/rust-facts/keys.js";
import type { TargetTypeRef } from "../../policy/types.js";
import type { RustSyntheticNameState } from "./synthetic-names.js";
import type { RustBlock, RustExpr, RustType } from "../rust-ast/nodes.js";

export interface RustExpressionOverride {
  readonly expression: RustExpr;
  readonly carrier: TargetTypeRef;
  readonly valueForm: "value" | "shared-reference";
}

interface RustControlTargetBase {
  readonly id: number;
  readonly label: string;
  readonly sourceLabel?: string;
  readonly resourceBoundary?: RustCompletionBoundary;
  readonly used: { value: boolean };
}

export type RustControlTarget =
  | (RustControlTargetBase & {
      readonly kind: "loop";
      readonly continuePrelude: readonly import("../rust-ast/nodes.js").RustStmt[];
    })
  | (RustControlTargetBase & { readonly kind: "switch" | "label" });

export type RustLoopTarget = Extract<RustControlTarget, { readonly kind: "loop" }>;

export interface RustCompletionBoundary {
  readonly parent?: RustCompletionBoundary;
  readonly returnType: RustType;
  readonly fallible: boolean;
  readonly asynchronous: boolean;
  readonly dispatchReturn: { value: boolean };
  readonly dispatchTargets: Map<number, RustControlTarget>;
}

export interface RustControlFlowState {
  nextLoopId: number;
}

export interface RustPlanContext {
  readonly input: RustTranslationContext;
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly moduleNameByFileName: ReadonlyMap<string, string>;
  readonly diagnostics: TargetDiagnostic[];
  readonly planBlock: (node: Node, context: RustPlanContext) => RustBlock | undefined;
  // Identifier names with a proven write (assignment or increment) in the
  // enclosing function body. `let mut` is emitted only for proven writes.
  readonly mutatedNames?: ReadonlySet<string>;
  readonly syntheticNames?: RustSyntheticNameState;
  readonly controlFlow?: RustControlFlowState;
  readonly controlTargets?: readonly RustControlTarget[];
  readonly completionBoundary?: RustCompletionBoundary;
  readonly functionReturnType?: RustType;
  readonly asyncContext?: boolean;
  // Inside a fallible lowering (Result-returning fn body or try closure):
  // fallible calls take `?`, throws lower to Err returns.
  readonly fallibleContext?: boolean;
  // Structured import requirements: runtime alias prefixes used by planned
  // operations and rendered types. Never inferred from printed text.
  readonly usedAliases?: Set<string>;
  // Per-item flag: a non-snake_case user identifier was emitted.
  readonly nonSnakeSeen?: { value: boolean };
  // Rust-native obligations discovered while planning one generic function.
  // The finalized signature is rendered only after the complete body has been
  // planned, so late requirements cannot produce an invalid partial contract.
  readonly genericRequirements?: RustGenericRequirementSet;
  readonly generator?: {
    readonly declaration: Node;
    readonly controllerName: string;
    readonly protocol: RustGeneratorFact;
  };
  readonly expressionOverrides?: ReadonlyMap<Node, RustExpressionOverride>;
  readonly capturedBindingPaths?: ReadonlyMap<Node, string>;
  readonly projectDispatchRoot?: RustExpr;
  readonly typeParameterSubstitutions?: ReadonlyMap<string, import("../../policy/types.js").TargetTypeRef>;
}

// Target-owned runtime aliases: the shared runtime and the target's own JS
// surface crates. Capability crates contribute their aliases as row data.
export const rustRuntimeAliasImports: ReadonlyMap<string, { readonly path: string; readonly alias: string }> = new Map([
  ["js_abi", { path: "tsonic_rust_js::abi", alias: "js_abi" }],
  ["js_string", { path: "tsonic_rust_js::string", alias: "js_string" }],
  ["rt", { path: "tsonic_rust_runtime", alias: "rt" }],
]);

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

// Naming policy: every user-authored identifier is preserved verbatim
// wherever Rust can represent it; items containing non-snake_case names
// carry scoped #[allow(non_snake_case)]. This conversion exists ONLY for
// compiler-generated temporaries with no TypeScript source identity.
// Provider, library, and capability API identity flows exclusively through
// operation-row metadata, which the backend emits verbatim.
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

// Verbatim user-authored name plus whether the containing item needs a
// scoped #[allow(non_snake_case)].
export function rustPublicName(name: string): { readonly name: string; readonly needsAllow: boolean } {
  return { name, needsAllow: name !== rustLocalBindingName(name) };
}

// Verbatim user identifier; records non-snake usage so the enclosing item
// carries a scoped lint allowance.
export function rustSourceName(context: { readonly nonSnakeSeen?: { value: boolean } }, name: string): string {
  if (name !== rustLocalBindingName(name)) {
    if (context.nonSnakeSeen !== undefined) {
      context.nonSnakeSeen.value = true;
    }
  }
  return name;
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
