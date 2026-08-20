import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  KindFunctionDeclaration,
  KindImportDeclaration,
  KindExportAssignment,
  KindExportDeclaration,
  KindVariableStatement,
  Node_Initializer,
} from "@tsonic/target-api/source";
import {
  rustFallibleFactKey,
  rustModuleBindingFactKey,
} from "../../../analysis/facts/keys.js";
import {
  rustCarrierSupportsClone,
} from "../../../policy/types/target-types.js";
import {
  createRustSourceFile,
} from "../../rust-ast/nodes.js";
import { rustItemsReferenceModuleAlias } from "../../rust-ast/source-module-usage.js";
import type {
  RustItem,
  RustSourceFileModel,
} from "../../rust-ast/nodes.js";
import { rustLintAttributes } from "../../rust-ast/lint-policy.js";
import type { RustPlanningContext } from "../context.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "../diagnostics.js";
import { planExpression } from "../expressions/index.js";
import {
  planFunctionDeclarations,
  planNativeModuleFunction,
} from "../declarations/functions.js";
import {
  diagnosticInput,
  isUpperSnakeName,
  isValidRustIdentifier,
  rustCurrentErrorBoundary,
  rustErrorType,
  rustSourceItemIsPubliclyReachable,
  rustRuntimeAliasImports,
} from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planBlockLike, planStatement } from "../statements/index.js";
import { applyFallibleShape } from "../types/fallible-shape.js";
import {
  createRustSyntheticNameState,
} from "../names/synthetic.js";
import {
  planClassDeclaration,
  planEnumDeclaration,
  planInterfaceDeclaration,
  planTypeAliasDeclaration,
} from "../declarations/nominal.js";
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
import { planRustClassInitialization } from "../declarations/class-static-fields.js";
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
    readonly errorBoundary?: import("./source-package-errors.js").RustSourcePackageErrorBoundary;
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
  programModuleName: string,
  structuralShapesModuleName: string,
  childModuleNames: readonly string[],
  publicModuleNames: ReadonlySet<string>,
  publicImplementationItemIdentities: ReadonlySet<string>,
  errorDomain: import("../../rust-ast/nodes.js").RustErrorDomain,
  sourcePackageErrors: RustSourcePackageErrorPlan,
  input: RustPlanningContext,
  diagnostics: TargetDiagnostic[],
): PlannedRustSourceFile {
  const diagnosticsBeforePlanning = diagnostics.length;
  diagnoseRustSafetyApplications(sourceFile, input, diagnostics);
  const usedAliases = new Set<string>();
  const context: RustPlanContext = {
    input,
    sourceFile,
    sourcePackageComponentId,
    moduleName,
    ...(crateName === undefined ? {} : { crateName }),
    moduleNameByFileName,
    externalCrateNameByFileName,
    externalItemPathByIdentity,
    externalStructuralShapeModuleByFileName,
    programModuleName,
    structuralShapesModuleName,
    publicImplementationItemIdentities,
    diagnostics,
    errorDomain,
    sourcePackageErrors,
    usedAliases,
    planBlock: planBlockLike,
  };
  const plannedModule = planModuleItems(context);
  const initializationRequirement = input.moduleInitialization.requirementFor(sourceFile);
  if (initializationRequirement.kind === "unresolved") {
    diagnostics.push(unsupportedConstructDiagnostic(
      { ast: input.ast, sourceFile, node: initializationRequirement.node },
      "rust.backend.module-initialization-facts",
      initializationRequirement.reason,
    ));
  } else if (diagnostics.length === diagnosticsBeforePlanning &&
    (initializationRequirement.kind === "required") !==
    (plannedModule.initialization !== undefined)) {
    diagnostics.push(unsupportedConstructDiagnostic(
      { ast: input.ast, sourceFile, node: sourceFile },
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
  const useItems: RustItem[] = [...aliases]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((alias) => alias === "rt" && errorDomain === "project"
      ? { path: `crate::${programModuleName}`, alias: "rt" }
      : rustRuntimeAliasImports.get(alias))
    .filter((entry): entry is { path: string; alias: string } =>
      entry !== undefined)
    .map((entry) => ({ kind: "use", path: entry.path, alias: entry.alias }));
  const model = createRustSourceFile([
    ...useItems,
    ...childModuleNames.map((name): RustItem => ({
      kind: "mod-decl",
      name,
      visibility: publicModuleNames.has(`${moduleName}::${name}`) ? "public" : "crate",
    })),
    ...plannedModule.items,
  ]);
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
    readonly errorBoundary?: import("./source-package-errors.js").RustSourcePackageErrorBoundary;
  };
}

function planModuleItems(context: RustPlanContext): PlannedRustModuleItems {
  const { ast } = context.input;
  const items: RustItem[] = [];
  const initializationStatements = [] as import("../../rust-ast/nodes.js").RustStmt[];
  const syntheticNames = createRustSyntheticNameState(ast, context.sourceFile, []);
  const initializationFunctionName = rustModuleInitializerFunctionName(
    context.input,
    context.sourceFile,
  );
  const objectLiteralImplementations = createRustObjectLiteralImplementationRegistry(
    context.sourceFile,
    { ...context, syntheticNames },
    syntheticNames,
  );
  context = {
    ...context,
    objectLiteralImplementations,
  };
  items.push(...objectLiteralImplementations.items);
  const asynchronous = context.input.source.navigation.moduleHasTopLevelAwait(
    context.sourceFile,
  );
  const fallible = context.input.facts.getFact(
    context.sourceFile,
    rustFallibleFactKey,
  ) !== undefined;
  const errorBoundary = fallible ? rustCurrentErrorBoundary(context) : undefined;
  if (fallible && errorBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.module-initializer-error-boundary",
      "Module initializer has no exact source-package error boundary.",
    ));
    return { items };
  }
  const initializationContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: { kind: "unit" },
    ...(asynchronous ? { asyncContext: true } : {}),
    ...(errorBoundary === undefined ? {} : { fallibleBoundary: errorBoundary }),
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
      if (ast.body(statement) === undefined) {
        const implementation = context.input.source.navigation
          .callableImplementation(statement);
        if (implementation.kind === "resolved" &&
          implementation.implementation.declaration !== statement) {
          continue;
        }
      }
      const diagnosticCount = context.diagnostics.length;
      const plannedFunctions = planFunctionDeclarations(statement, context);
      if (plannedFunctions !== undefined) {
        items.push(...plannedFunctions);
        const binding = context.input.facts.getFact(statement, rustModuleBindingFactKey);
        if (binding?.storage === "native-callable" && binding.value !== undefined) {
          const value = planRustSourceCallableValue({
            form: "function",
            sourceDeclaration: statement,
            fileName: ast.getFileName(context.sourceFile),
            name: binding.name,
            carrier: binding.value.carrier,
            parameterCarriers: binding.value.parameterCarriers,
            argumentModes: binding.value.argumentModes,
            resultCarrier: binding.value.resultCarrier,
          }, initializationContext);
          const type = rustTypeFromCarrierInContext(binding.value.carrier, initializationContext);
          if (value === undefined || type === undefined ||
            !rustCarrierSupportsClone(binding.value.carrier)) {
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
              rustSourceItemIsPubliclyReachable(context, binding.value.name)
                ? []
                : [rustLintAttributes.deadCode],
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
      const definition = context.input.projectTypes.definitionForDeclaration(statement);
      const classInitialization = planRustClassInitialization(
        statement,
        initializationContext,
      );
      const planned = definition !== undefined && context.input.projectTypes.isPolymorphic(definition)
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
      const diagnosticCount = context.diagnostics.length;
      const definition = context.input.projectTypes.definitionForDeclaration(statement);
      const planned = definition !== undefined && context.input.projectTypes.isPolymorphic(definition)
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
  if (initializationStatements.length === 0) {
    return { items };
  }
  if (fallible) {
    context.usedAliases?.add("rt");
  }
  const initialization: NonNullable<PlannedRustModuleItems["initialization"]> = {
    functionName: initializationFunctionName,
    asynchronous,
    ...(errorBoundary === undefined ? {} : { errorBoundary }),
  };
  items.push({
    kind: "function",
    name: initializationFunctionName,
    visibility: "public",
    attrs: [
      "#[doc(hidden)]",
    ],
    ...(asynchronous ? { isAsync: true } : {}),
    ...(errorBoundary === undefined ? {} : { errorType: rustErrorType(errorBoundary) }),
    params: [],
    body: applyFallibleShape(
      { statements: initializationStatements },
      fallible
        ? { fallible: true, hasReturnValue: false, errorType: rustErrorType(errorBoundary!) }
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
    { ast: context.input.ast, sourceFile: context.sourceFile, node: statement },
    `rust.backend.${construct}-finalization`,
    `Top-level ${construct} planning returned no Rust AST and no specific diagnostic.`,
  ));
}

interface PlannedTopLevelVariableStatement {
  readonly items: readonly RustItem[];
  readonly initialization: readonly import("../../rust-ast/nodes.js").RustStmt[];
}

function planDefaultExportAssignment(
  declaration: Node,
  context: RustPlanContext,
): PlannedRustModuleCell | undefined {
  const { ast } = context.input;
  const assignment = ast.as.AsExportAssignment(declaration);
  const binding = context.input.facts.getFact(declaration, rustModuleBindingFactKey);
  const name = context.input.names.nameForDeclaration(declaration) ?? "";
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
  if (!rustCarrierSupportsClone(binding.valueCarrier)) {
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

function planTopLevelVariableStatement(
  statement: Node,
  context: RustPlanContext,
): PlannedTopLevelVariableStatement | undefined {
  const { ast } = context.input;
  const declarations: Node[] = [];
  const visit = (candidate: Node): void => {
    if (ast.kindName(candidate) === "KindVariableDeclaration") {
      declarations.push(candidate);
      return;
    }
    ast.forEachChild(candidate, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(statement);
  if (declarations.length === 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      { ast, sourceFile: context.sourceFile, node: statement },
      "rust.backend.module-binding",
      "Top-level variable statements require at least one exact variable declaration.",
    ));
    return undefined;
  }
  const items: RustItem[] = [];
  const initialization: import("../../rust-ast/nodes.js").RustStmt[] = [];
  for (const declaration of declarations) {
    const name = context.input.names.nameForDeclaration(declaration) ?? "";
    const initializer = Node_Initializer(ast, declaration);
    const binding = context.input.facts.getFact(declaration, rustModuleBindingFactKey);
    if (initializer === undefined || binding === undefined || !isValidRustIdentifier(name)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        { ast, sourceFile: context.sourceFile, node: declaration },
        "rust.backend.module-binding",
        "Top-level bindings require a plain Rust identifier, an initializer, and one finalized module-binding fact.",
      ));
      return undefined;
    }
    const visibility = ast.hasModifierKind(statement, "export") ||
        rustSourceItemIsPubliclyReachable(context, name)
      ? "public" as const
      : "crate" as const;
    if (binding.storage === "native-callable") {
      const item = planNativeModuleFunction(
        declaration,
        binding.callableDeclaration,
        binding.name,
        binding.value === undefined && visibility === "public",
        context,
      );
      if (item === undefined) {
        return undefined;
      }
      items.push(item);
      if (binding.value === undefined) {
        continue;
      }
      const value = planRustSourceCallableValue({
        form: "function",
        sourceDeclaration: binding.callableDeclaration,
        fileName: ast.getFileName(context.sourceFile),
        name: binding.name,
        carrier: binding.value.carrier,
        parameterCarriers: binding.value.parameterCarriers,
        argumentModes: binding.value.argumentModes,
        resultCarrier: binding.value.resultCarrier,
      }, context);
      const rustType = rustTypeFromCarrierInContext(binding.value.carrier, context);
      if (value === undefined || rustType === undefined ||
        !rustCarrierSupportsClone(binding.value.carrier)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          { ast, sourceFile: context.sourceFile, node: declaration },
          "rust.backend.module-callable-value",
          "Observed module callable values require one exact renderable Clone-capable carrier.",
        ));
        return undefined;
      }
      context.usedAliases?.add("rt");
      const planned = planRustModuleCell(
        binding.value.name,
        rustType,
        value,
        visibility,
        context.syntheticNames!,
        [
          ...(isUpperSnakeName(binding.value.name) ? [] : [rustLintAttributes.nonUpperCaseGlobal]),
          ...(rustSourceItemIsPubliclyReachable(context, binding.value.name)
            ? []
            : [rustLintAttributes.deadCode]),
        ],
      );
      items.push(...planned.items);
      initialization.push(planned.initialization);
      continue;
    }
    const rustType = rustTypeFromCarrierInContext(binding.valueCarrier, context);
    if (rustType === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        { ast, sourceFile: context.sourceFile, node: declaration },
        "rust.backend.module-binding-carrier",
        "Top-level value binding has no finalized renderable Rust carrier.",
      ));
      return undefined;
    }
    const value = planExpression(initializer, context);
    if (value === undefined) {
      return undefined;
    }
    if (binding.storage === "native-const") {
      const attrs = [
        ...(isUpperSnakeName(name) ? [] : [rustLintAttributes.nonUpperCaseGlobal]),
        ...(rustSourceItemIsPubliclyReachable(context, name)
          ? []
          : [rustLintAttributes.deadCode]),
      ];
      items.push({
        kind: "const",
        name,
        visibility,
        ...(attrs.length === 0 ? {} : { attrs }),
        type: rustType,
        value,
      });
      continue;
    }
    if (!rustCarrierSupportsClone(binding.valueCarrier)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        { ast, sourceFile: context.sourceFile, node: declaration },
        "rust.backend.module-binding-carrier",
        "Runtime module bindings require one exact Clone-capable Rust value carrier.",
      ));
      return undefined;
    }
    context.usedAliases?.add("rt");
    const planned = planRustModuleCell(
      name,
      rustType,
      value,
      visibility,
      context.syntheticNames!,
      [
        ...(isUpperSnakeName(name) ? [] : [rustLintAttributes.nonUpperCaseGlobal]),
        ...(rustSourceItemIsPubliclyReachable(context, name)
          ? []
          : [rustLintAttributes.deadCode]),
      ],
    );
    items.push(...planned.items);
    initialization.push(planned.initialization);
  }
  return { items, initialization };
}
