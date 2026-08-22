import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import type { RustGeneratorFact, RustSourceBindingFact } from "../../../analysis/facts/keys.js";
import { rustModuleBindingFactKey } from "../../../analysis/facts/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSyntheticNameState } from "../names/synthetic.js";
import type { RustObjectLiteralImplementationRegistry } from "../objects/object-literal-implementations.js";
import {
  resolveRustSourcePackageErrorBoundary,
  type RustSourcePackageErrorBoundary,
  type RustSourcePackageErrorPlan,
} from "./source-package-errors.js";
import { rustSourceItemIdentity } from "./source-package-facades.js";
import type { RustBlock, RustErrorDomain, RustExpr, RustType } from "../../target-ast/nodes.js";
import {
  isValidRustIdentifier,
  rustSnakeCaseIdentifier,
} from "../../../target-model/names/identifiers.js";
export { isValidRustIdentifier, rustReservedIdentifiers } from "../../../target-model/names/identifiers.js";

export interface RustEffectiveExpressionOverride {
  readonly expression: RustExpr;
  readonly carrier: TargetTypeRef;
  readonly valueForm: "value" | "shared-reference" | "storage";
}

export interface RustCapturedBinding {
  readonly declaration: Node;
  readonly path: string;
  readonly storage: "value" | "location";
  readonly valueCarrier: import("../../../target-model/types/model.js").TargetTypeRef;
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
      readonly continuePrelude: readonly import("../../target-ast/nodes.js").RustStmt[];
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
  readonly input: RustPlanningContext;
  readonly sourceFile: SourceFile;
  readonly sourcePackageComponentId: string;
  readonly moduleName: string;
  readonly crateName?: string;
  readonly moduleNameByFileName: ReadonlyMap<string, string>;
  readonly externalCrateNameByFileName: ReadonlyMap<string, string>;
  readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
  readonly externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>;
  readonly programModuleName: string;
  readonly structuralShapesModuleName: string;
  readonly publicImplementationItemIdentities: ReadonlySet<string>;
  readonly publishesImplementationAbi: boolean;
  readonly diagnostics: TargetDiagnostic[];
  readonly errorDomain: RustErrorDomain;
  readonly sourcePackageErrors: RustSourcePackageErrorPlan;
  readonly planBlock: (node: Node, context: RustPlanContext) => RustBlock | undefined;
  readonly syntheticNames?: RustSyntheticNameState;
  readonly controlFlow?: RustControlFlowState;
  readonly controlTargets?: readonly RustControlTarget[];
  readonly completionBoundary?: RustCompletionBoundary;
  readonly functionReturnType?: RustType;
  readonly asyncContext?: boolean;
  readonly explicitUnsafeContextDepth?: number;
  // Exact Result error ABI for the active function or synthetic try region.
  // Its owner can differ from the source file when implementing a contract
  // declared by another source-package component.
  readonly fallibleBoundary?: RustSourcePackageErrorBoundary;
  // Structured import requirements: runtime alias prefixes used by planned
  // operations and rendered types. Never inferred from printed text.
  readonly usedAliases?: Set<string>;
  // Exact callable contract whose generic obligations were sealed by target
  // analysis before this syntax-planning context was created.
  readonly callableDeclaration?: Node;
  readonly generator?: {
    readonly declaration: Node;
    readonly controllerName: string;
    readonly protocol: RustGeneratorFact;
  };
  readonly expressionOverrides?: ReadonlyMap<Node, RustEffectiveExpressionOverride>;
  readonly capturedBindings?: readonly RustCapturedBinding[];
  readonly projectDispatchRoot?: RustExpr;
  readonly objectLiteralImplementations?: RustObjectLiteralImplementationRegistry;
  readonly typeParameterSubstitutions?: ReadonlyMap<string, import("../../../target-model/types/model.js").TargetTypeRef>;
}

export function rustErrorBoundaryForDeclaration(
  declaration: Node,
  context: RustPlanContext,
): RustSourcePackageErrorBoundary | undefined {
  const sourceFile = context.input.program.source.ast.getSourceFile(declaration);
  const fileName = sourceFile === undefined
    ? undefined
    : context.input.program.source.ast.getFileName(sourceFile);
  const ownerComponentId = fileName === undefined
    ? undefined
    : context.sourcePackageErrors.componentIdByFileName.get(fileName);
  return ownerComponentId === undefined
    ? undefined
    : resolveRustSourcePackageErrorBoundary(
        context.sourcePackageErrors,
        context.sourcePackageComponentId,
        ownerComponentId,
      );
}

export function rustErrorBoundaryForProjectMember(
  declaration: Node,
  context: RustPlanContext,
): RustSourcePackageErrorBoundary | undefined {
  const parent = context.input.program.source.ast.parent(declaration);
  const kind = context.input.program.source.ast.kindName(declaration);
  const projectMember = parent !== undefined &&
    (context.input.program.source.ast.is.IsClassDeclaration(parent) ||
      context.input.program.source.ast.is.IsInterfaceDeclaration(parent)) &&
    !context.input.program.source.ast.hasModifierKind(declaration, "static") &&
    (kind === "KindMethodDeclaration" || kind === "KindMethodSignature" ||
      kind === "KindGetAccessor" || kind === "KindSetAccessor" ||
      kind === "KindPropertyDeclaration" || kind === "KindPropertySignature");
  if (!projectMember) {
    return rustErrorBoundaryForDeclaration(declaration, context);
  }
  const contracts = context.input.program.sourceNavigation.memberContracts(declaration);
  if (contracts.kind === "unresolved") {
    return undefined;
  }
  const owners = contracts.contracts.length === 0
    ? [declaration]
    : contracts.contracts;
  const boundaries = owners.map((owner) =>
    rustErrorBoundaryForDeclaration(owner, context));
  const first = boundaries[0];
  return first !== undefined && boundaries.every((boundary) =>
    boundary?.errorTypeIdentity === first.errorTypeIdentity)
    ? first
    : undefined;
}

export function rustCurrentErrorBoundary(
  context: RustPlanContext,
): RustSourcePackageErrorBoundary | undefined {
  return resolveRustSourcePackageErrorBoundary(
    context.sourcePackageErrors,
    context.sourcePackageComponentId,
    context.sourcePackageComponentId,
  );
}

export function rustErrorType(
  boundary: RustSourcePackageErrorBoundary,
): RustType {
  return {
    kind: "named",
    path: boundary.errorTypePath,
    identity: boundary.errorTypeIdentity,
  };
}

export function rustActiveErrorType(
  context: Pick<RustPlanContext, "fallibleBoundary">,
): RustType | undefined {
  return context.fallibleBoundary === undefined
    ? undefined
    : rustErrorType(context.fallibleBoundary);
}

export function rustSourceItemIsPubliclyReachable(
  context: RustPlanContext,
  itemName: string,
): boolean {
  return context.publishesImplementationAbi ||
    context.publicImplementationItemIdentities.has(rustSourceItemIdentity(
    context.input.program.source.ast.getFileName(context.sourceFile),
    itemName,
  ));
}

export function rustProjectTypeHasPublicImplementationAbi(
  context: RustPlanContext,
  itemName: string,
): boolean {
  return rustSourceItemIsPubliclyReachable(context, itemName);
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

// Naming policy: source declarations use the immutable compilation-wide Rust
// name plan. This helper applies the same value-name spelling to compiler-owned
// names that are introduced after that plan is sealed. Provider, library, and
// capability API identity flows exclusively through operation-row metadata.
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
  const moduleBinding = binding.scope === "module"
    ? context.input.program.facts.getFact(binding.sourceDeclaration, rustModuleBindingFactKey)
    : undefined;
  const name = moduleBinding?.storage === "native-callable" && moduleBinding.value !== undefined
    ? moduleBinding.value.name
    : context.input.program.names.nameForDeclaration(binding.sourceDeclaration);
  if (name === undefined || !isValidRustIdentifier(name)) {
    return undefined;
  }
  if (binding.scope === "lexical") {
    return name;
  }
  return sourceModuleItemPath(context, binding.fileName, name);
}

export function isUpperSnakeName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/u.test(name);
}

export function diagnosticInput(context: RustPlanContext, node: Node) {
  return { ast: context.input.program.source.ast, sourceFile: context.sourceFile, node };
}

export function sourceTypePath(
  context: RustPlanContext,
  value: { readonly fileName: string; readonly typeName: string },
): string | undefined {
  const moduleName = context.moduleNameByFileName.get(value.fileName);
  const typeName = context.input.program.names.nameForSourceType(value.fileName, value.typeName);
  if (moduleName === undefined || typeName === undefined || !isValidRustIdentifier(typeName)) {
    return undefined;
  }
  return sourceModuleItemPath(context, value.fileName, typeName);
}

export function sourceModuleItemPath(
  context: Pick<
    RustPlanContext,
    "moduleName" | "crateName" | "moduleNameByFileName" | "externalCrateNameByFileName" |
      "externalItemPathByIdentity"
  >,
  fileName: string,
  itemName: string,
): string | undefined {
  const moduleName = context.moduleNameByFileName.get(fileName);
  if (moduleName === undefined) {
    return undefined;
  }
  const externalCrate = context.externalCrateNameByFileName.get(fileName);
  if (externalCrate !== undefined && externalCrate !== context.crateName) {
    return context.externalItemPathByIdentity.get(
      rustSourceItemIdentity(fileName, itemName),
    );
  }
  return moduleName === context.moduleName
    ? itemName
    : `crate::${moduleName}::${itemName}`;
}
