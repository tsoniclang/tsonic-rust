import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import type { RustGeneratorFact } from "../../../target-model/records/callables-and-resources.js";
import type { RustSourceBindingFact } from "../../../target-model/records/value-projections.js";
import type { RustPhysicalEmissionContext, RustPhysicalEmissionRole } from "../../../target-model/records/physical-emission-contexts.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSyntheticNameState } from "../names/synthetic.js";
import type { RustObjectLiteralImplementationRegistry } from "../objects/object-literal-implementations.js";
import type { RustFrameOwner } from "./frame-owners.js";
import { resolveRustSourcePackageErrorBoundary } from "./source-package-errors.js";
import type { RustSourcePackageErrorPlan } from "../../../target-model/records/error-regions.js";
import type { RustSourcePackageErrorBoundary } from "../../../target-model/records/error-regions.js";
import { rustSourceItemIdentity } from "../../../target-model/names/source-output-identities.js";
import type { RustFallibleBoundary } from "./fallible-boundaries.js";
export { rustErrorType } from "./fallible-boundaries.js";
import type { RustBlock, RustErrorDomain, RustExpr, RustItem, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import {
  isValidRustIdentifier,
  rustTargetIdentifier,
} from "../../../target-model/names/identifiers.js";
export { isValidRustIdentifier, rustReservedIdentifiers } from "../../../target-model/names/identifiers.js";

export interface RustEffectiveExpressionOverride {
  readonly expression: RustExpr;
  readonly carrier: TargetTypeRef;
  readonly valueForm: "value" | "shared-reference" | "storage";
}

export interface RustFlowReadOverride {
  readonly expression: RustExpr;
  readonly sourceCarrier: TargetTypeRef;
  readonly selectedCarrier: TargetTypeRef;
}

export interface RustCapturedBinding {
  readonly declaration: Node;
  readonly expression: RustExpr;
  readonly storage: "value" | "location" | "cell" | "borrow-cell";
  readonly valueCarrier: import("../../../target-model/types/model.js").TargetTypeRef;
  readonly borrowed?: "shared" | "mutable";
  readonly borrowedCarrier?: import("../../../target-model/types/model.js").TargetTypeRef;
}

interface RustControlTargetBase {
  readonly id: number;
  readonly label: string;
  readonly sourceTargets: readonly Node[];
  readonly resourceBoundary?: RustCompletionBoundary;
  readonly used: { value: boolean };
}

export type RustControlTarget =
  | (RustControlTargetBase & {
      readonly kind: "loop";
      readonly continuePrelude: readonly import("../../target-ast/syntax/nodes.js").RustStmt[];
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

export interface RustConstructionPreparation {
  readonly context: RustPlanContext;
  readonly before: readonly RustStmt[];
  finish(statements: readonly RustStmt[]): readonly RustStmt[];
}

export interface RustPlanContext {
  readonly emissionContext: RustPhysicalEmissionContext | undefined;
  readonly input: RustPlanningContext;
  readonly sourceFile: SourceFile;
  readonly sourcePackageComponentId: string;
  readonly moduleName: string;
  readonly crateName?: string;
  readonly moduleNameByFileName: ReadonlyMap<string, string>;
  readonly externalCrateNameByFileName: ReadonlyMap<string, string>;
  readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
  readonly externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>;
  readonly workerEntryIdentityByFileName: ReadonlyMap<string, string>;
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
  readonly functionAbsenceReturnCarrier?: TargetTypeRef;
  readonly asyncContext?: boolean;
  readonly explicitUnsafeContextDepth?: number;
  readonly fallibleBoundary?: RustFallibleBoundary;
  // Structured import requirements: runtime alias prefixes used by planned
  // operations and rendered types. Never inferred from printed text.
  readonly usedAliases?: Set<string>;
  // Exact callable contract whose generic obligations were sealed by target
  // analysis before this syntax-planning context was created.
  readonly callableDeclaration?: Node;
  readonly promiseBody?: true;
  readonly promiseBodyName?: string;
  readonly generator?: {
    readonly declaration: Node;
    readonly controllerName: string;
    readonly protocol: RustGeneratorFact;
  };
  readonly expressionOverrides?: ReadonlyMap<Node, RustEffectiveExpressionOverride>;
  readonly valueDestinations?: ReadonlyMap<Node, TargetTypeRef>;
  readonly construction?: {
    prepare(node: Node, context: RustPlanContext): RustConstructionPreparation | undefined;
    returnFor(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined;
  };
  readonly valueFieldLocations?: ReadonlyMap<Node, import("../objects/value-fields.js").RustValueFieldLocation>;
  readonly bindingLocations?: ReadonlyMap<Node, import("../objects/value-fields.js").RustValueFieldLocation>;
  readonly frameOwners?: ReadonlyMap<import("../../../analysis/callables/frame-values.js").RustFrameCallableDefinition, RustFrameOwner>;
  readonly capturedFieldOwners?: ReadonlyMap<Node, RustExpr>;
  readonly capturedFieldIdentities?: ReadonlyMap<Node, RustExpr>;
  readonly flowReadOverrides?: ReadonlyMap<Node, RustFlowReadOverride>;
  readonly capturedBindings?: readonly RustCapturedBinding[];
  readonly classEnvironment?: { readonly declaration: Node; readonly expression: RustExpr; readonly borrowed?: boolean };
  readonly projectDispatchRoot?: RustExpr;
  readonly objectLiteralImplementations?: RustObjectLiteralImplementationRegistry;
  readonly typeParameterSubstitutions?: ReadonlyMap<string, import("../../../target-model/types/model.js").TargetTypeRef>;
  readonly typeParameterNames?: ReadonlyMap<string, string>;
  readonly lifetimeSubstitutions?: ReadonlyMap<
    string,
    import("../../../target-model/lifetimes/model.js").RustLifetimeRef
  >;
}

export function requireRustEmissionContext(
  context: RustPlanContext, subject: object, role: RustPhysicalEmissionRole, node: Node,
): RustPhysicalEmissionContext {
  const selected = context.input.program.physicalEmissionContexts.contextForOwner(subject, role);
  if (selected === undefined) failRustPlannerInvariant("An emitted source body requires its original sealed physical context.", node);
  return selected;
}

export function rustContextForEmission(context: RustPlanContext, emissionContext: RustPhysicalEmissionContext): RustPlanContext {
  return { ...context, emissionContext, typeParameterSubstitutions: emissionContext.bindings.types,
    lifetimeSubstitutions: emissionContext.bindings.lifetimes };
}

export function requireRustCallableBodyContext(context: RustPlanContext, declaration: Node): RustPhysicalEmissionContext {
  const enclosing = context.emissionContext;
  if (enclosing === undefined) failRustPlannerInvariant("A callable creation requires its original sealed enclosing use.", declaration);
  const selected = context.input.program.physicalEmissionContexts.bodyContextFor(enclosing.use, declaration);
  if (selected === undefined) failRustPlannerInvariant("A callable body requires its original selected creation context.", declaration);
  return selected;
}

export function rustErrorBoundaryForDeclaration(
  declaration: Node,
  context: Pick<RustPlanContext, "sourcePackageErrors" | "sourcePackageComponentId"> & {
    readonly input: { readonly program: { readonly source: { readonly ast: import("@tsonic/tsts").AstReader } } };
  },
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
  context: Pick<RustPlanContext, "sourcePackageErrors" | "sourcePackageComponentId">,
): RustSourcePackageErrorBoundary | undefined {
  return resolveRustSourcePackageErrorBoundary(
    context.sourcePackageErrors,
    context.sourcePackageComponentId,
    context.sourcePackageComponentId,
  );
}

export function rustActiveErrorType(
  context: Pick<RustPlanContext, "fallibleBoundary">,
): RustType | undefined {
  return context.fallibleBoundary?.errorType;
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
  ["js_exact_string", { path: "tsonic_rust_js::exact_string", alias: "js_exact_string" }],
  ["js_string", { path: "tsonic_rust_js::string", alias: "js_string" }],
  ["rt", { path: "tsonic_rust_runtime", alias: "rt" }],
]);

export function rustRuntimeAliasUseItems(
  aliases: ReadonlySet<string>,
  programModuleName?: string,
): readonly Extract<RustItem, { readonly kind: "use" }>[] {
  return [...aliases].map(alias => alias === "rt" && programModuleName !== undefined
    ? { path: `crate::${programModuleName}`, alias: "rt" } : rustRuntimeAliasImports.get(alias))
    .filter((entry): entry is { path: string; alias: string } => entry !== undefined)
    .sort((left, right) => left.path.localeCompare(right.path, "en") || left.alias.localeCompare(right.alias, "en"))
    .map(entry => ({ kind: "use", path: entry.path, alias: entry.alias }));
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

export function rustLocalBindingName(name: string): string {
  return rustTargetIdentifier(name);
}

export function rustSourceBindingPath(
  context: RustPlanContext,
  binding: RustSourceBindingFact,
): string | undefined {
  const storageDeclaration = binding.scope === "lexical"
    ? context.input.program.localStorageAliases.owner(binding.sourceDeclaration) ?? binding.sourceDeclaration
    : binding.sourceDeclaration;
  const moduleBinding = binding.scope === "module"
    ? context.input.program.records.moduleBinding.get(binding.sourceDeclaration)
    : undefined;
  const name = moduleBinding?.storage === "native-callable" && moduleBinding.value !== undefined
    ? moduleBinding.value.name
    : context.input.program.names.nameForDeclaration(storageDeclaration);
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
  if (moduleName === undefined || typeName === undefined ||
    !typeName.split("::").every(isValidRustIdentifier)) {
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
