import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import type { RustCallableEntryHeaderPlacement, RustCallableEntryHeaderSelection } from "../../../target-model/records/callables/callable-entry-headers.js";
import type { RustGeneratorFact } from "../../../target-model/records/callables/callables-and-resources.js";
import type { RustSourceBindingFact } from "../../../target-model/records/objects/value-projections.js";
import type { RustConstructionLayer } from "../../../target-model/records/objects/construction.js";
import type { RustProviderFormEmission } from "../../../target-model/records/native/provider-forms.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSyntheticNameState } from "../names/synthetic.js";
import type { RustObjectLiteralImplementationRegistry } from "../objects/object-literals/model.js";
import type { RustFrameOwner } from "./frame-owners.js";
import type { RustBlockPlanner } from "../statements/model.js";
import { resolveRustSourcePackageErrorBoundary } from "./source-package-errors.js";
import type { RustSourcePackageErrorBoundary, RustSourcePackageErrorPlan } from "../../../target-model/records/errors/source-package-errors.js";
import { rustSourceItemIdentity } from "../../../target-model/names/source-output-identities.js";
import type { RustFallibleBoundary } from "./fallible-boundaries.js";
import type { RustNativeTaskScope } from "../../../target-model/records/native/native-tasks.js";
import type { RustErrorDomain } from "../../../target-model/operations/error-boundary.js";
import type { RustExpr, RustItem, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import {
  isValidRustIdentifier,
  rustTargetIdentifier,
} from "../../../target-model/names/identifiers.js";

export type RustEffectiveExpressionOverride = {
  readonly expression: RustExpr;
  readonly carrier: TargetTypeRef;
} & (
  | { readonly valueForm: "value" | "shared-reference" }
  | { readonly valueForm: "storage"; readonly storageForm: "plain" | "borrow-guard" }
);

export interface RustFlowReadOverride {
  readonly expression: RustExpr;
  readonly sourceCarrier: TargetTypeRef;
  readonly selectedCarrier: TargetTypeRef;
}

export interface RustCapturedBinding {
  readonly declaration: Node;
  readonly expression: RustExpr;
  readonly referent: RustExpr | undefined;
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
  readonly nativeHeaderPlacement: RustCallableEntryHeaderPlacement;
  readonly nativeHeaderParent: RustCallableEntryHeaderSelection | undefined;
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
  readonly nativeTaskScope?: {
    readonly scope: RustNativeTaskScope;
    readonly expression: RustExpr;
    readonly borrowed: boolean;
  };
  readonly sourcePackageErrors: RustSourcePackageErrorPlan;
  readonly planBlock: RustBlockPlanner;
  readonly syntheticNames?: RustSyntheticNameState;
  readonly controlFlow?: RustControlFlowState;
  readonly controlTargets?: readonly RustControlTarget[];
  readonly completionBoundary?: RustCompletionBoundary;
  readonly functionReturnType?: RustType;
  readonly returnResult?: { readonly errorType: RustType };
  readonly functionAbsenceReturnCarrier?: TargetTypeRef;
  readonly asyncContext?: boolean;
  readonly explicitUnsafeContextDepth?: number;
  readonly fallibleBoundary?: RustFallibleBoundary;
  readonly providerCallbackBody?: RustProviderFormEmission["callbackBody"];
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
    readonly errorUninhabited: boolean;
  };
  readonly expressionOverrides?: ReadonlyMap<Node, RustEffectiveExpressionOverride>;
  readonly valueDestinations?: ReadonlyMap<Node, TargetTypeRef>;
  readonly construction?: {
    readonly layer: RustConstructionLayer;
    prepare(node: Node, context: RustPlanContext): RustConstructionPreparation | undefined;
    returnFor(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined;
  };
  readonly valueFieldLocations?: ReadonlyMap<Node, import("../objects/value-fields.js").RustValueFieldLocation>;
  readonly bindingLocations?: ReadonlyMap<Node, import("../objects/value-fields.js").RustValueFieldLocation>;
  readonly frameOwners?: ReadonlyMap<import("../../../target-model/records/callables/frame-callables.js").RustFrameCallableDefinition, RustFrameOwner>;
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

export function rustErrorBoundaryForDeclaration(
  declaration: Node,
  context: Pick<RustPlanContext, "sourcePackageErrors" | "sourcePackageComponentId"> & {
    readonly input: { readonly program: { readonly source: { readonly ast: import("@tsonic/tsts").AstReader };
      readonly records: import("../../../target-model/records/program.js").RustProgramRecords } };
  },
): RustSourcePackageErrorBoundary | undefined {
  const owner = context.input.program.records.errorDeclarationOwner.get(declaration);
  return owner === undefined ? undefined
    : context.input.program.records.sourcePackageErrorBoundary.get(context.sourcePackageComponentId, owner);
}

export function rustErrorBoundaryForProjectMember(
  declaration: Node,
  context: RustPlanContext,
): RustSourcePackageErrorBoundary | undefined {
  const owner = context.input.program.records.errorMemberOwner.get(declaration);
  return owner === undefined ? undefined
    : context.input.program.records.physicalProgramErrorBoundary.get(context.sourcePackageComponentId, owner);
}

export function rustCurrentErrorBoundary(
  context: Pick<RustPlanContext, "sourcePackageErrors" | "sourcePackageComponentId"> & {
    readonly input: { readonly program: { readonly records: import("../../../target-model/records/program.js").RustProgramRecords } };
  },
): RustSourcePackageErrorBoundary | undefined {
  return resolveRustSourcePackageErrorBoundary(
    context.input.program.records,
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
  const bindings = rustRuntimeAliasBindings(programModuleName);
  return [...aliases].flatMap(alias => {
    const path = bindings.get(alias);
    return path === undefined ? [] : [{ path, alias }];
  })
    .sort((left, right) => left.path.localeCompare(right.path, "en") || left.alias.localeCompare(right.alias, "en"))
    .map(entry => ({ kind: "use", path: entry.path, alias: entry.alias }));
}

export function rustRuntimeAliasBindings(programModuleName?: string): ReadonlyMap<string, string> {
  return new Map([...rustRuntimeAliasImports].map(([alias, entry]) => [alias,
    alias === "rt" && programModuleName !== undefined ? `crate::${programModuleName}` : entry.path]));
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
  const selected = context.input.program.records.sourceBindingEmission.get(binding.sourceDeclaration);
  if (selected === undefined) return undefined;
  return selected.scope === "lexical" ? selected.name : sourceModuleItemPath(context, selected.fileName, selected.name);
}

export function isUpperSnakeName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/u.test(name);
}

export function sourceTypePath(
  context: RustPlanContext,
  value: { readonly fileName: string; readonly typeName: string },
): string | undefined {
  const moduleName = context.moduleNameByFileName.get(value.fileName);
  const typeName = context.input.program.records.sourceTypeIdentity.get(value.fileName, value.typeName)?.targetName;
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
