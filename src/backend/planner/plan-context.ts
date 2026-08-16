import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api";
import type { RustTranslationContext } from "../../translate/context.js";
import type { RustGenericRequirementSet } from "./generic-requirements.js";
import type { RustGeneratorFact, RustSourceBindingFact } from "../../source/rust-facts/keys.js";
import type { TargetTypeRef } from "../../policy/types.js";
import type { RustSyntheticNameState } from "./synthetic-names.js";
import type { RustBlock, RustErrorDomain, RustExpr, RustType } from "../rust-ast/nodes.js";
import {
  isValidRustIdentifier,
  rustSnakeCaseIdentifier,
} from "../../common/rust-identifiers.js";
export { isValidRustIdentifier, rustReservedIdentifiers } from "../../common/rust-identifiers.js";

export interface RustEffectiveExpressionOverride {
  readonly expression: RustExpr;
  readonly carrier: TargetTypeRef;
  readonly valueForm: "value" | "shared-reference" | "storage";
}

export interface RustCapturedBinding {
  readonly declaration: Node;
  readonly path: string;
  readonly storage: "value" | "location";
  readonly valueCarrier: import("../../policy/types.js").TargetTypeRef;
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
      readonly breakUsed: { value: boolean };
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
  readonly errorDomain: RustErrorDomain;
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
  readonly explicitUnsafeContextDepth?: number;
  // Inside a fallible lowering (Result-returning fn body or try closure):
  // fallible calls take `?`, throws lower to Err returns.
  readonly fallibleContext?: boolean;
  // Structured import requirements: runtime alias prefixes used by planned
  // operations and rendered types. Never inferred from printed text.
  readonly usedAliases?: Set<string>;
  // Rust-native obligations discovered while planning one generic function.
  // The finalized signature is rendered only after the complete body has been
  // planned, so late requirements cannot produce an invalid partial contract.
  readonly genericRequirements?: RustGenericRequirementSet;
  readonly generator?: {
    readonly declaration: Node;
    readonly controllerName: string;
    readonly protocol: RustGeneratorFact;
  };
  readonly expressionOverrides?: ReadonlyMap<Node, RustEffectiveExpressionOverride>;
  readonly capturedBindings?: readonly RustCapturedBinding[];
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
// wherever Rust can represent it. This conversion exists ONLY for
// compiler-generated temporaries with no TypeScript source identity.
// Provider, library, and capability API identity flows exclusively through
// operation-row metadata, which the backend emits verbatim.
export function rustLocalBindingName(name: string): string {
  if (/^[A-Z][A-Z0-9_]*$/u.test(name)) {
    // UPPER_SNAKE names are constant references and pass through unchanged.
    return name;
  }
  return rustSnakeCaseIdentifier(name);
}

export function rustSourceBindingPath(
  context: RustPlanContext,
  binding: RustSourceBindingFact,
): string | undefined {
  const name = context.input.names.nameForDeclaration(binding.sourceDeclaration);
  if (name === undefined || !isValidRustIdentifier(name)) {
    return undefined;
  }
  if (binding.scope === "lexical") {
    return name;
  }
  const declarationModule = context.moduleNameByFileName.get(binding.fileName);
  return declarationModule !== undefined && declarationModule !== context.moduleName
    ? `crate::${declarationModule}::${name}`
    : name;
}

export function isUpperSnakeName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/u.test(name);
}

export function diagnosticInput(context: RustPlanContext, node: Node) {
  return { ast: context.input.ast, sourceFile: context.sourceFile, node };
}

export function sourceTypePath(
  context: RustPlanContext,
  value: { readonly fileName: string; readonly typeName: string },
): string | undefined {
  const moduleName = context.moduleNameByFileName.get(value.fileName);
  const typeName = context.input.names.nameForSourceType(value.fileName, value.typeName);
  if (moduleName === undefined || typeName === undefined || !isValidRustIdentifier(typeName)) {
    return undefined;
  }
  return moduleName === context.moduleName ? typeName : `crate::${moduleName}::${typeName}`;
}
