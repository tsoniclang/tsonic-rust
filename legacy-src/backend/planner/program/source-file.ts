import { rustHiddenAttribute } from "../../target-ast/syntax/attributes.js";
import type { RustFallibleBoundary } from "./fallible-boundaries.js";
import { planRustErrorRegion } from "./error-regions.js";
import type { RustErrorRegionSelection } from "../../../target-model/records/error-regions.js";

import type { Node, SourceFile } from "@tsonic/tsts";
import { planRustNativeCallableProtocolItems } from "../declarations/callables/native-protocols.js";
import { planRustClassEnvironmentItems } from "../objects/class-environments.js";
import { planRustClassValueImplementations } from "../objects/constructor-values.js";
import { planRustProjectStructuralImplementations } from "../objects/project-structural-views.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";

import {
  KindFunctionDeclaration,
  KindImportDeclaration,
  KindExportAssignment,
  KindExportDeclaration,
  KindVariableStatement,
} from "@tsonic/target-api/source";

import {
  rustCarrierSupportsClone,
} from "../../../target-model/types/index.js";
import {
  createRustSourceFile,
  emptyRustGenerics,
} from "../../target-ast/syntax/nodes.js";
import { rustItemsReferenceModuleAlias } from "../../target-ast/inspection/source-module-usage.js";
import type {
  RustItem,
  RustSourceFileModel,
} from "../../target-ast/syntax/nodes.js";
import type { RustPlanningContext } from "../context.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { planExpression } from "../expressions/index.js";
import {
  planFunctionDeclarations,
} from "../declarations/callables/functions.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustRuntimeAliasUseItems,
} from "./plan-context.js";
import { planTopLevelVariableStatement } from "./module-bindings.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planBlockLike, planStatement } from "../statements/index.js";
import { applyFallibleShape } from "../types/fallible-shape.js";
import {
  createRustSyntheticNameState,
  type RustSyntheticNameState,
} from "../names/synthetic.js";
import {
  planClassDeclaration,
  planEnumDeclaration,
  planInterfaceDeclaration,
  planTypeAliasDeclaration,
} from "../declarations/index.js";
import {
  planPolymorphicClassDeclaration,
  planPolymorphicInterfaceDeclaration,
} from "../objects/polymorphism/index.js";
import {
  diagnoseRustSafetyApplications,
} from "../safety/explicit-safety.js";
import {
  planRustModuleCell,
  planRustHoistedModuleCell,
  type PlannedRustModuleCell,
} from "../project/module-storage.js";
import { planRustClassInitialization } from "../declarations/classes/static-fields.js";
import { planProjectStaticFunctionItems } from "../declarations/classes/methods.js";
import { planRustTypeFamilyImplementations } from "../declarations/type-families.js";
import { planRustGenericCallableItems } from "../declarations/callables/generic-implementations.js";
import { planRustFrameCallableItems } from "../declarations/callables/frame-implementations.js";
import { planRustSuspendedCallableItems } from "../declarations/callables/suspended.js";
import { completeRustAuthoredStructScopes } from "../../target-ast/normalization/authored-type-scopes.js";
import { createRustObjectLiteralImplementationRegistry } from "../objects/object-literal-implementations.js";
import { planRustSourceCallableValue } from "../expressions/source-callable-value.js";
import { rustModuleInitializerFunctionName } from "./source-package-initializers.js";
import type { RustSourcePackageErrorPlan } from "./source-package-errors.js";

export interface PlannedRustSourceFile {
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly model: RustSourceFileModel;
  readonly moduleInitialization?: {
    readonly functionName: string;
    readonly asynchronous: boolean;
    readonly errorRegion: RustErrorRegionSelection;
    readonly errorBoundary?: RustFallibleBoundary;
  };
}

export function planRustSourceFile(
  sourceFile: SourceFile,
  moduleName: string,
  sourcePackageComponentId: string,
  crateName: string | undefined,
  moduleNameByFileName: ReadonlyMap<string, string>,
  externalCrateNameByFileName: ReadonlyMap<string, string>,
  externalItemPathByIdentity: ReadonlyMap<string, string>,
  externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>,
  workerEntryIdentityByFileName: ReadonlyMap<string, string>,
  programModuleName: string,
  structuralShapesModuleName: string,
  childModuleNames: readonly string[],
  publicModuleNames: ReadonlySet<string>,
  publicImplementationModuleNames: ReadonlySet<string>,
  publicImplementationItemIdentities: ReadonlySet<string>,
  publishesImplementationAbi: boolean,
  errorDomain: import("../../../target-model/operations/error-boundary.js").RustErrorDomain,
  sourcePackageErrors: RustSourcePackageErrorPlan,
  input: RustPlanningContext,
  diagnostics: TargetDiagnostic[],
): PlannedRustSourceFile {
  const diagnosticsBeforePlanning = diagnostics.length;
  diagnoseRustSafetyApplications(sourceFile, input, diagnostics);
  const usedAliases = new Set<string>();
  const baseContext: RustPlanContext = {
    input,
    sourceFile,
    sourcePackageComponentId,
    moduleName,
    ...(crateName === undefined ? {} : { crateName }),
    moduleNameByFileName,
    externalCrateNameByFileName,
    externalItemPathByIdentity,
    externalStructuralShapeModuleByFileName,
    workerEntryIdentityByFileName,
    programModuleName,
    structuralShapesModuleName,
    publicImplementationItemIdentities,
    publishesImplementationAbi,
    diagnostics,
    errorDomain,
    sourcePackageErrors,
    usedAliases,
    planBlock: planBlockLike,
  };
  const syntheticNames = createRustSyntheticNameState(input.program.source.ast, sourceFile, []);
  const objectLiteralImplementations = createRustObjectLiteralImplementationRegistry(
    sourceFile,
    { ...baseContext, syntheticNames },
    syntheticNames,
  );
  const context: RustPlanContext = { ...baseContext, objectLiteralImplementations };
  const baseModule = planModuleItems(context, syntheticNames);
  const plannedModule = { ...baseModule,
    items: [...input.errorRegions.itemsFor(input.program.source.ast.getFileName(sourceFile)),
      ...objectLiteralImplementations.items, ...baseModule.items, ...planRustTypeFamilyImplementations(context),
      ...planRustGenericCallableItems(context), ...planRustNativeCallableProtocolItems(context),
      ...planRustFrameCallableItems(context), ...planRustSuspendedCallableItems(context)] };
  const initializationRequirement = input.program.moduleInitialization.requirementFor(sourceFile);
  if (initializationRequirement.kind === "unresolved") {
    diagnostics.push(unsupportedConstructDiagnostic(
      { ast: input.program.source.ast, sourceFile, node: initializationRequirement.node },
      "rust.backend.module-initialization-facts",
      initializationRequirement.reason,
    ));
  } else if (diagnostics.length === diagnosticsBeforePlanning &&
    (initializationRequirement.kind === "required") !==
    (plannedModule.initialization !== undefined)) {
    diagnostics.push(unsupportedConstructDiagnostic(
      { ast: input.program.source.ast, sourceFile, node: sourceFile },
      "rust.backend.module-initialization-facts",
      initializationRequirement.kind === "required"
        ? "Finalized module facts require initialization, but planning produced no initializer."
        : "Planning produced a module initializer although finalized module facts prove initialization unnecessary.",
    ));
  }
  const aliases = Object.freeze(new Set(
    [...usedAliases].filter((alias) =>
      rustItemsReferenceModuleAlias(plannedModule.items, alias)),
  ));
  const useItems = rustRuntimeAliasUseItems(aliases, errorDomain === "project" ? programModuleName : undefined);
  const selectedScopes = input.program.records.sourceTypeScopes.get(sourceFile);
  if (selectedScopes === undefined) failRustPlannerInvariant("An admitted source module requires its authored native type scope inventory.", sourceFile);
  const scopes = new Set(selectedScopes);
  const model = createRustSourceFile(completeRustAuthoredStructScopes([
    ...useItems,
    ...childModuleNames.map((name): RustItem => {
      const childModuleName = `${moduleName}::${name}`;
      const sourcePublic = publicModuleNames.has(childModuleName);
      const implementationPublic = publicImplementationModuleNames.has(childModuleName);
      return {
        kind: "mod-decl",
        name,
        visibility: sourcePublic || implementationPublic ? "public" : "crate",
        ...(implementationPublic && !sourcePublic
          ? { attrs: [rustHiddenAttribute] }
          : {}),
      };
    }),
    ...plannedModule.items,
  ], scopes));
  return Object.freeze({
    sourceFile,
    moduleName,
    model,
    ...(plannedModule.initialization === undefined
      ? {}
      : { moduleInitialization: plannedModule.initialization }),
  });
}

interface PlannedRustModuleItems {
  readonly items: readonly RustItem[];
  readonly initialization?: {
    readonly functionName: string;
    readonly asynchronous: boolean;
    readonly errorRegion: RustErrorRegionSelection;
    readonly errorBoundary?: RustFallibleBoundary;
  };
}

function planModuleItems(
  context: RustPlanContext,
  syntheticNames: RustSyntheticNameState,
): PlannedRustModuleItems {
  const { ast } = context.input.program.source;
  const items: RustItem[] = [];
  const initializationStatements = [] as import("../../target-ast/syntax/nodes.js").RustStmt[];
  const initializationFunctionName = rustModuleInitializerFunctionName(
    context.input,
    context.sourceFile,
  );
  const viewOwners = new Set(context.input.program.classValues.instanceViewImplementations.filter(view =>
    view.ownerFileName === ast.getFileName(context.sourceFile)).map(view => view.declaration));
  for (const declaration of viewOwners) {
    const diagnosticCount = context.diagnostics.length;
    const views = planRustProjectStructuralImplementations(declaration, context);
    if (views === undefined) ensureTopLevelPlanningDiagnostic(context, declaration, diagnosticCount, "instance-view");
    else items.push(...views);
  }
  const constructorOwners = new Set(context.input.program.classValues.constructorViewImplementations.filter(view =>
    view.ownerFileName === ast.getFileName(context.sourceFile)).map(view => view.declaration));
  for (const declaration of constructorOwners) {
    const diagnosticCount = context.diagnostics.length;
    const views = planRustClassValueImplementations(declaration, context);
    if (views === undefined) ensureTopLevelPlanningDiagnostic(context, declaration, diagnosticCount, "constructor-view");
    else items.push(...views);
  }
  const asynchronous = context.input.program.errorRegions.initialization.moduleFor(context.sourceFile)?.asynchronous === true;
  const errorRegion = context.input.program.errorRegions.get(context.sourceFile);
  const region = planRustErrorRegion(context.sourceFile, context);
  if (errorRegion === undefined || region === undefined) {
    failRustPlannerInvariant(
      "Module initializer has no exact finalized error region.",
      context.sourceFile);
  }
  const errorBoundary = region.boundary;
  const fallible = errorBoundary !== undefined;
  const initializationContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: { kind: "unit" },
    functionAbsenceReturnCarrier: undefined,
    ...(asynchronous ? { asyncContext: true } : {}),
    fallibleBoundary: errorBoundary,
  };
  for (const statement of ast.statements(context.sourceFile)) {
    if (statement === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, context.sourceFile),
        "rust.backend.top-level-statement",
        "Source file contains an undefined top-level statement slot.",
      ));
      continue;
    }
    const kind = ast.kindName(statement);
    if (kind === KindImportDeclaration || kind === KindExportDeclaration ||
      kind === "KindEndOfFile") {
      continue;
    }
    if (kind === KindFunctionDeclaration) {
      const participation = context.input.program.records.nativeParticipation.get(statement);
      if (participation === undefined) failRustPlannerInvariant(
        "Authored function placement requires its sealed native participation.", statement);
      if (participation === "erased") continue;
      const diagnosticCount = context.diagnostics.length;
      const plannedFunctions = planFunctionDeclarations(statement, context);
      if (plannedFunctions !== undefined) {
        items.push(...plannedFunctions);
        const binding = context.input.program.records.moduleBinding.get(statement);
        const storage = context.input.program.records.moduleCallableStorage.get(statement);
        if (binding?.storage === "native-callable" && binding.value !== undefined && storage === undefined) {
          context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, statement),
            "rust.backend.module-callable-storage", "Module callable values require their finalized native storage selection."));
        }
        if (binding?.storage === "native-callable" && binding.value !== undefined &&
          storage?.kind === "stored") {
          const value = planRustSourceCallableValue({
            form: "function",
            sourceDeclaration: statement,
            fileName: ast.getFileName(context.sourceFile),
            name: binding.name,
            carrier: binding.value.carrier,
            parameterCarriers: binding.value.parameterCarriers,
            resultCarrier: binding.value.resultCarrier,
          }, initializationContext);
          const physical = context.input.program.callableValues.nativeProducers.physicalFor(statement, binding.value.carrier);
          const type = rustTypeFromCarrierInContext(physical, initializationContext);
          if (value === undefined || type === undefined ||
            !rustCarrierSupportsClone(binding.value.carrier, context.input.program.typeDefinitions)) {
            context.diagnostics.push(unsupportedConstructDiagnostic(
              diagnosticInput(context, statement),
              "rust.backend.hoisted-callable-value",
              "Observed function declarations require one exact renderable Clone-capable callable value.",
            ));
          } else {
            initializationContext.usedAliases?.add("rt");
            items.push(...planRustHoistedModuleCell(
              binding.value.name,
              type,
              value,
              ast.hasModifierKind(statement, "export") ? "public" : "crate",
              syntheticNames,
              [],
            ));
          }
        }
      } else {
        ensureTopLevelPlanningDiagnostic(
          context,
          statement,
          diagnosticCount,
          "function",
        );
      }
      continue;
    }
    if (kind === KindVariableStatement) {
      if (context.input.program.records.typeOnlyDeclaration.get(statement) !== undefined) continue;
      const diagnosticCount = context.diagnostics.length;
      const planned = planTopLevelVariableStatement(
        statement,
        initializationContext,
      );
      if (planned !== undefined) {
        items.push(...planned.items);
        initializationStatements.push(...planned.initialization);
      } else {
        ensureTopLevelPlanningDiagnostic(
          context,
          statement,
          diagnosticCount,
          "variable",
        );
      }
      continue;
    }
    if (kind === KindExportAssignment) {
      const diagnosticCount = context.diagnostics.length;
      const planned = planDefaultExportAssignment(
        statement,
        initializationContext,
      );
      if (planned !== undefined) {
        items.push(...planned.items);
        initializationStatements.push(planned.initialization);
      } else {
        ensureTopLevelPlanningDiagnostic(
          context,
          statement,
          diagnosticCount,
          "default-export",
        );
      }
      continue;
    }
    if (kind === "KindClassDeclaration") {
      const diagnosticCount = context.diagnostics.length;
      const definition = context.input.program.projectTypes.definitionForDeclaration(statement);
      const classInitialization = planRustClassInitialization(
        statement,
        initializationContext,
      );
      const planned = definition !== undefined && context.input.program.projectTypes.isPolymorphic(definition)
        ? planPolymorphicClassDeclaration(statement, context)
        : planClassDeclaration(statement, context);
      if (planned !== undefined && classInitialization !== undefined) {
        items.push(...classInitialization.items);
        items.push(...planned);
        initializationStatements.push(...classInitialization.initialization);
      } else {
        ensureTopLevelPlanningDiagnostic(
          context,
          statement,
          diagnosticCount,
          "class",
        );
      }
      continue;
    }
    if (kind === "KindInterfaceDeclaration") {
      if (context.input.program.records.typeOnlyDeclaration.get(statement) !== undefined) continue;
      const diagnosticCount = context.diagnostics.length;
      const definition = context.input.program.projectTypes.definitionForDeclaration(statement);
      const planned = definition !== undefined && context.input.program.projectTypes.isPolymorphic(definition)
        ? planPolymorphicInterfaceDeclaration(statement, context)
        : planInterfaceDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      } else {
        ensureTopLevelPlanningDiagnostic(
          context,
          statement,
          diagnosticCount,
          "interface",
        );
      }
      continue;
    }
    if (kind === "KindTypeAliasDeclaration") {
      const diagnosticCount = context.diagnostics.length;
      const planned = planTypeAliasDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      } else {
        ensureTopLevelPlanningDiagnostic(
          context,
          statement,
          diagnosticCount,
          "type-alias",
        );
      }
      continue;
    }
    if (kind === "KindEnumDeclaration") {
      const diagnosticCount = context.diagnostics.length;
      const planned = planEnumDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      } else {
        ensureTopLevelPlanningDiagnostic(
          context,
          statement,
          diagnosticCount,
          "enum",
        );
      }
      continue;
    }
    const planned = planStatement(statement, initializationContext);
    if (planned !== undefined) {
      initializationStatements.push(...planned);
    }
  }
  for (const definition of context.input.program.projectTypes.definitions) {
    if (definition.sourceFile === context.sourceFile && definition.kind === "class") {
      const diagnosticCount = context.diagnostics.length;
      const environmentItems = planRustClassEnvironmentItems(definition.declaration, context);
      if (environmentItems === undefined) {
        ensureTopLevelPlanningDiagnostic(context, definition.declaration, diagnosticCount, "class-environment");
      } else items.push(...environmentItems);
      const staticFunctions = planProjectStaticFunctionItems(definition, context);
      if (staticFunctions === undefined) {
        ensureTopLevelPlanningDiagnostic(context, definition.declaration, diagnosticCount, "static-function");
      } else items.push(...staticFunctions);
    }
    if (definition.sourceFile !== context.sourceFile || definition.kind !== "class" ||
      ast.parent(definition.declaration) === context.sourceFile) continue;
    const diagnosticCount = context.diagnostics.length;
    const planned = context.input.program.projectTypes.isPolymorphic(definition)
      ? planPolymorphicClassDeclaration(definition.declaration, context)
      : planClassDeclaration(definition.declaration, context);
    if (planned === undefined) {
      ensureTopLevelPlanningDiagnostic(context, definition.declaration, diagnosticCount, "local-class");
    } else {
      items.push(...planned);
    }
  }
  if (initializationStatements.length === 0) {
    return { items };
  }
  if (fallible) {
    context.usedAliases?.add("rt");
  }
  const sourceFallthrough = context.input.program.records.moduleFallthrough.get(sourceFile);
  if (sourceFallthrough === undefined) failRustPlannerInvariant("An admitted module initializer requires its sealed source completion.", sourceFile);
  const initialization: NonNullable<PlannedRustModuleItems["initialization"]> = {
    functionName: initializationFunctionName,
    asynchronous,
    errorRegion,
    ...(errorBoundary === undefined ? {} : { errorBoundary }),
  };
  items.push({
    kind: "function",
    name: initializationFunctionName,
    visibility: "public",
    generics: emptyRustGenerics,
    attrs: [
      rustHiddenAttribute,
    ],
    ...(asynchronous ? { isAsync: true } : {}),
    ...(errorBoundary === undefined ? {} : { errorType: errorBoundary.errorType }),
    params: [],
    body: applyFallibleShape(
      { statements: initializationStatements },
      fallible
        ? {
            fallible: true,
            hasReturnValue: false,
            errorType: errorBoundary!.errorType,
            inferErrorTypeFromReturnType: true,
            canFallThrough: sourceFallthrough,
          }
        : { fallible: false, hasReturnValue: false },
    ),
  });
  return { items, initialization };
}

function ensureTopLevelPlanningDiagnostic(
  context: RustPlanContext,
  statement: Node,
  diagnosticCount: number,
  construct: string,
): void {
  if (context.diagnostics.length !== diagnosticCount) {
    return;
  }
  context.diagnostics.push(missingFactDiagnostic(
    { ast: context.input.program.source.ast, sourceFile: context.sourceFile, node: statement },
    `rust.backend.${construct}-finalization`,
    `Top-level ${construct} planning returned no Rust AST and no specific diagnostic.`,
  ));
}

function planDefaultExportAssignment(
  declaration: Node,
  context: RustPlanContext,
): PlannedRustModuleCell | undefined {
  const { ast } = context.input.program.source;
  const assignment = ast.as.AsExportAssignment(declaration);
  const binding = context.input.program.records.moduleBinding.get(declaration);
  const name = context.input.program.names.nameForDeclaration(declaration) ?? "";
  if (assignment === undefined || assignment.IsExportEquals === true ||
    assignment.Expression === undefined || binding?.storage !== "module-cell" ||
    !isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      { ast, sourceFile: context.sourceFile, node: declaration },
      "rust.backend.default-export",
      "Default exports require one exact expression, binding name, and finalized module-cell snapshot.",
    ));
    return undefined;
  }
  if (!rustCarrierSupportsClone(binding.valueCarrier, context.input.program.typeDefinitions)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      { ast, sourceFile: context.sourceFile, node: declaration },
      "rust.backend.default-export-carrier",
      "Default export snapshots require one exact Clone-capable Rust value carrier.",
    ));
    return undefined;
  }
  const rustType = rustTypeFromCarrierInContext(binding.valueCarrier, context);
  const value = planExpression(assignment.Expression, context);
  if (rustType === undefined || value === undefined || context.syntheticNames === undefined) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  return planRustModuleCell(
    name,
    rustType,
    value,
    "public",
    context.syntheticNames,
  );
}
