import { rustHiddenAttribute } from "../../target-ast/syntax/attributes.js";
import type { RustFallibleBoundary } from "./fallible-boundaries.js";
import { planRustErrorRegion, planRustErrorJoinDeclarations } from "./error-regions.js";
import { planRustNativeTaskInitializer } from "./native-tasks.js";
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

import { createRustSourceFile, emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import { rustItemsReferenceModuleAlias } from "../../target-ast/syntax/module-references.js";
import type { RustItem, RustSourceFileModel } from "../../target-ast/syntax/nodes.js";
import type { RustPlanningContext } from "../context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "../expressions/index.js";
import {
  planFunctionDeclarations,
} from "../declarations/callables/functions.js";
import { rustRuntimeAliasUseItems } from "./plan-context.js";
import { planTopLevelVariableStatement } from "./module-bindings.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planBlockLike, planStatement } from "../statements/index.js";
import { applyFallibleShape } from "../types/fallible-shape.js";
import { applyRustTailShape } from "../../target-ast/normalization/block-flow.js";
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
  planRustModuleCell,
  planRustHoistedModuleCell,
  rustModuleCellCallableAlias,
  type PlannedRustModuleCell,
} from "../project/module-storage.js";
import { planRustClassInitialization } from "../declarations/classes/static-fields.js";
import { planProjectStaticFunctionItems } from "../declarations/classes/methods.js";
import { planRustTypeFamilyImplementations } from "../declarations/type-families.js";
import { planRustGenericCallableItems } from "../declarations/callables/generic-implementations.js";
import { planRustFrameCallableItems } from "../declarations/callables/frame-implementations.js";
import { planRustSuspendedCallableItems } from "../declarations/callables/suspended.js";
import { completeRustAuthoredStructScopes } from "./authored-type-scopes.js";
import { createRustObjectLiteralImplementationRegistry } from "../objects/object-literals/model.js";
import { planRustSourceCallableValue } from "../expressions/source-callable-value.js";
import { rustModuleInitializerFunctionName } from "./source-package-initializers.js";
import type { RustSourcePackageErrorPlan } from "../../../target-model/records/source-package-errors.js";

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
  const usedAliases = new Set<string>();
  const baseContext: RustPlanContext = {
    nativeHeaderPlacement: sourceFile,
    nativeHeaderParent: undefined,
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
    items: [...planRustErrorJoinDeclarations(sourceFile, input),
      ...objectLiteralImplementations.items, ...baseModule.items, ...planRustTypeFamilyImplementations(context),
      ...planRustGenericCallableItems(context), ...planRustNativeCallableProtocolItems(context),
      ...planRustFrameCallableItems(context), ...planRustSuspendedCallableItems(context)] };
  const emission = input.program.records.sourceFileEmission.get(sourceFile);
  if (emission === undefined) failRustPlannerInvariant("An admitted source module requires its sealed native module plan.", sourceFile);
  if (emission.initialization.required !== (plannedModule.initialization !== undefined))
    failRustPlannerInvariant("An admitted native module initializer must match its sealed source demand.", sourceFile);
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
  const emission = context.input.program.records.sourceFileEmission.get(context.sourceFile);
  if (emission === undefined) failRustPlannerInvariant("An admitted source module requires its sealed native declaration inventory.", context.sourceFile);
  const viewOwners = emission.instanceViewOwners;
  for (const declaration of viewOwners) {
    const views = planRustProjectStructuralImplementations(declaration, context);
    if (views === undefined) requireTopLevelNativeItems(context, declaration, "instance-view");
    else items.push(...views);
  }
  const constructorOwners = emission.constructorViewOwners;
  for (const declaration of constructorOwners) {
    const views = planRustClassValueImplementations(declaration, context);
    if (views === undefined) requireTopLevelNativeItems(context, declaration, "constructor-view");
    else items.push(...views);
  }
  const asynchronous = emission.initialization.asynchronous;
  const errorRegion = emission.initialization.region;
  const region = planRustErrorRegion(context.sourceFile, context);
  if (errorRegion === undefined || region === undefined) {
    failRustPlannerInvariant(
      "Module initializer has no exact finalized error region.",
      context.sourceFile);
  }
  const errorBoundary = region.boundary;
  const fallible = errorBoundary !== undefined;
  const nativeTasks = planRustNativeTaskInitializer(context.sourceFile, context);
  const initializationContext: RustPlanContext = {
    ...nativeTasks.context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: { kind: "unit" },
    functionAbsenceReturnCarrier: undefined,
    ...(asynchronous ? { asyncContext: true } : {}),
    fallibleBoundary: errorBoundary,
  };
  for (const statement of ast.statements(context.sourceFile)) {
    if (statement === undefined) {
      failRustPlannerInvariant("A checked source file requires its dense native top-level statement inventory.", context.sourceFile);
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
      const plannedFunctions = planFunctionDeclarations(statement, context);
      if (plannedFunctions !== undefined) {
        items.push(...plannedFunctions);
        const binding = context.input.program.records.moduleBinding.get(statement);
        const storage = context.input.program.records.moduleCallableStorage.get(statement);
        if (binding?.storage === "native-callable" && binding.value !== undefined && storage === undefined) {
          failRustPlannerInvariant("An admitted module callable value requires its finalized native storage selection.", statement);
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
          const physical = context.input.program.records.moduleHoistedCallable.get(statement)?.carrier;
          if (physical === undefined) failRustPlannerInvariant("An admitted hoisted callable requires its exact native value carrier.", statement);
          const type = rustTypeFromCarrierInContext(physical, initializationContext);
          if (value === undefined || type === undefined) {
            failRustPlannerInvariant("An admitted hoisted callable requires its renderable native value.", statement);
          } else {
            initializationContext.usedAliases?.add("rt");
            items.push(...planRustHoistedModuleCell(
              binding.value.name,
              type,
              value,
              ast.hasModifierKind(statement, "export") ? "public" : "crate",
              syntheticNames,
              rustModuleCellCallableAlias(physical, context.input),
              [],
            ));
          }
        }
      } else {
        requireTopLevelNativeItems(
          context,
          statement,
          "function",
        );
      }
      continue;
    }
    if (kind === KindVariableStatement) {
      if (context.input.program.records.typeOnlyDeclaration.get(statement) !== undefined) continue;
      const planned = planTopLevelVariableStatement(
        statement,
        initializationContext,
      );
      if (planned !== undefined) {
        items.push(...planned.items);
        initializationStatements.push(...planned.initialization);
      } else {
        requireTopLevelNativeItems(
          context,
          statement,
          "variable",
        );
      }
      continue;
    }
    if (kind === KindExportAssignment) {
      const planned = planDefaultExportAssignment(
        statement,
        initializationContext,
      );
      if (planned !== undefined) {
        items.push(...planned.items);
        initializationStatements.push(planned.initialization);
      } else {
        requireTopLevelNativeItems(
          context,
          statement,
          "default-export",
        );
      }
      continue;
    }
    if (kind === "KindClassDeclaration") {
      const form = context.input.program.records.moduleTypeForm.get(statement);
      if (form === undefined) failRustPlannerInvariant("An admitted module type requires its sealed native form.", statement);
      const classInitialization = planRustClassInitialization(
        statement,
        initializationContext,
      );
      const planned = form === "polymorphic"
        ? planPolymorphicClassDeclaration(statement, context)
        : planClassDeclaration(statement, context);
      if (planned !== undefined && classInitialization !== undefined) {
        items.push(...classInitialization.items);
        items.push(...planned);
        initializationStatements.push(...classInitialization.initialization);
      } else {
        requireTopLevelNativeItems(
          context,
          statement,
          "class",
        );
      }
      continue;
    }
    if (kind === "KindInterfaceDeclaration") {
      if (context.input.program.records.typeOnlyDeclaration.get(statement) !== undefined) continue;
      const form = context.input.program.records.moduleTypeForm.get(statement);
      if (form === undefined) failRustPlannerInvariant("An admitted module type requires its sealed native form.", statement);
      const planned = form === "polymorphic"
        ? planPolymorphicInterfaceDeclaration(statement, context)
        : planInterfaceDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      } else {
        requireTopLevelNativeItems(
          context,
          statement,
          "interface",
        );
      }
      continue;
    }
    if (kind === "KindTypeAliasDeclaration") {
      const planned = planTypeAliasDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      } else {
        requireTopLevelNativeItems(
          context,
          statement,
          "type-alias",
        );
      }
      continue;
    }
    if (kind === "KindEnumDeclaration") {
      const planned = planEnumDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      } else {
        requireTopLevelNativeItems(
          context,
          statement,
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
  for (const { definition, local, polymorphic } of emission.classes) {
    {
      const environmentItems = planRustClassEnvironmentItems(definition.declaration, context);
      if (environmentItems === undefined) {
        requireTopLevelNativeItems(context, definition.declaration, "class-environment");
      } else items.push(...environmentItems);
      const staticFunctions = planProjectStaticFunctionItems(definition, context);
      if (staticFunctions === undefined) {
        requireTopLevelNativeItems(context, definition.declaration, "static-function");
      } else items.push(...staticFunctions);
    }
    if (!local) continue;
    const planned = polymorphic
      ? planPolymorphicClassDeclaration(definition.declaration, context)
      : planClassDeclaration(definition.declaration, context);
    if (planned === undefined) {
      requireTopLevelNativeItems(context, definition.declaration, "local-class");
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
  const sourceFallthrough = context.input.program.records.moduleFallthrough.get(context.sourceFile);
  if (sourceFallthrough === undefined) failRustPlannerInvariant("An admitted module initializer requires its sealed source completion.", context.sourceFile);
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
    params: nativeTasks.parameters,
    body: applyFallibleShape(
      applyRustTailShape({ statements: initializationStatements }, false, new Set(nativeTasks.parameters.map(parameter => parameter.name))),
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

function requireTopLevelNativeItems(
  _context: RustPlanContext,
  statement: Node,
  construct: string,
): void {
  failRustPlannerInvariant(`An admitted top-level ${construct} requires its exact native items.`, statement);
}

function planDefaultExportAssignment(
  declaration: Node,
  context: RustPlanContext,
): PlannedRustModuleCell | undefined {
  const selected = context.input.program.records.defaultExport.get(declaration);
  if (selected === undefined) failRustPlannerInvariant("An admitted default export requires its exact native module-cell snapshot.", declaration);
  const rustType = rustTypeFromCarrierInContext(selected.carrier, context);
  const value = planExpression(selected.expression, context);
  if (rustType === undefined || value === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted default export requires its renderable native value and name scope.", declaration);
  context.usedAliases?.add("rt");
  return planRustModuleCell(selected.name, rustType, value, "public", context.syntheticNames,
    rustModuleCellCallableAlias(selected.carrier, context.input));
}
