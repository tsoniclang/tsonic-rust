import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api";
import {
  KindFunctionDeclaration,
  KindImportDeclaration,
  KindExportDeclaration,
  KindVariableStatement,
  Node_Initializer,
} from "../../common/source-ast.js";
import {
  rustFallibleFactKey,
  rustModuleBindingFactKey,
} from "../../source/rust-facts/keys.js";
import {
  rustCarrierSupportsClone,
} from "../../source/rust-target-types.js";
import {
  createRustSourceFile,
} from "../rust-ast/nodes.js";
import type {
  RustItem,
  RustSourceFileModel,
} from "../rust-ast/nodes.js";
import type { RustTranslationContext } from "../../translate/context.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "./diagnostics.js";
import { planExpression } from "./expressions.js";
import {
  planFunctionDeclaration,
  planNativeModuleFunction,
} from "./functions.js";
import {
  diagnosticInput,
  isUpperSnakeName,
  isValidRustIdentifier,
  rustRuntimeAliasImports,
} from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { planBlockLike, planStatement } from "./statements.js";
import { applyFallibleShape } from "./fallible-shape.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "./synthetic-names.js";
import {
  planClassDeclaration,
  planEnumDeclaration,
  planInterfaceDeclaration,
  planTypeAliasDeclaration,
} from "./declarations-nominal.js";
import {
  planPolymorphicClassDeclaration,
  planPolymorphicInterfaceDeclaration,
} from "./project-polymorphism.js";
import {
  diagnoseRustSafetyApplications,
} from "./explicit-safety.js";
import { planRustModuleCell } from "./module-storage.js";
import { planRustClassStaticFields } from "./class-static-fields.js";

export interface PlannedRustSourceFile {
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly model: RustSourceFileModel;
  readonly moduleInitialization?: {
    readonly functionName: string;
    readonly asynchronous: boolean;
    readonly fallible: boolean;
  };
}

export function planRustSourceFile(
  sourceFile: SourceFile,
  moduleName: string,
  moduleNameByFileName: ReadonlyMap<string, string>,
  programModuleName: string,
  structuralShapesModuleName: string,
  childModuleNames: readonly string[],
  input: RustTranslationContext,
  diagnostics: TargetDiagnostic[],
): PlannedRustSourceFile {
  diagnoseRustSafetyApplications(sourceFile, input, diagnostics);
  const usedAliases = new Set<string>();
  const context: RustPlanContext = {
    input,
    sourceFile,
    moduleName,
    moduleNameByFileName,
    programModuleName,
    structuralShapesModuleName,
    diagnostics,
    errorDomain: input.projectTypes.programErrorDefinitions.length === 0 ? "runtime" : "project",
    usedAliases,
    planBlock: planBlockLike,
  };
  const plannedModule = planModuleItems(context);
  const aliases = Object.freeze(new Set(usedAliases));
  const useItems: RustItem[] = [...aliases]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((alias) => alias === "rt" && input.projectTypes.programErrorDefinitions.length > 0
      ? { path: `crate::${programModuleName}`, alias: "rt" }
      : rustRuntimeAliasImports.get(alias))
    .filter((entry): entry is { path: string; alias: string } =>
      entry !== undefined)
    .map((entry) => ({ kind: "use", path: entry.path, alias: entry.alias }));
  return Object.freeze({
    sourceFile,
    moduleName,
    model: createRustSourceFile([
      ...useItems,
      ...childModuleNames.map((name): RustItem => ({
        kind: "mod-decl",
        name,
        visibility: "public",
      })),
      ...plannedModule.items,
    ]),
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
    readonly fallible: boolean;
  };
}

function planModuleItems(context: RustPlanContext): PlannedRustModuleItems {
  const { ast } = context.input;
  const items: RustItem[] = [];
  const initializationStatements = [] as import("../rust-ast/nodes.js").RustStmt[];
  const syntheticNames = createRustSyntheticNameState(ast, context.sourceFile, []);
  const initializationFunctionName = allocateRustSyntheticName(
    syntheticNames,
    "module_init",
  );
  const asynchronous = context.input.source.navigation.moduleHasTopLevelAwait(
    context.sourceFile,
  );
  const fallible = context.input.facts.getFact(
    context.sourceFile,
    rustFallibleFactKey,
  ) !== undefined;
  const initializationContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: { kind: "unit" },
    ...(asynchronous ? { asyncContext: true } : {}),
    ...(fallible ? { fallibleContext: true } : {}),
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
      const item = planFunctionDeclaration(statement, context);
      if (item !== undefined) {
        items.push(item);
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
    if (kind === "KindClassDeclaration") {
      const diagnosticCount = context.diagnostics.length;
      const definition = context.input.projectTypes.definitionForDeclaration(statement);
      const staticFields = planRustClassStaticFields(statement, initializationContext);
      const planned = definition !== undefined && context.input.projectTypes.isPolymorphic(definition)
        ? planPolymorphicClassDeclaration(statement, context)
        : planClassDeclaration(statement, context);
      if (planned !== undefined && staticFields !== undefined) {
        items.push(...staticFields.items);
        items.push(...planned);
        initializationStatements.push(...staticFields.initialization);
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
    fallible,
  };
  items.push({
    kind: "function",
    name: initializationFunctionName,
    visibility: "public",
    attrs: [
      "#[doc(hidden)]",
    ],
    ...(asynchronous ? { isAsync: true } : {}),
    ...(fallible ? { fallible: true } : {}),
    params: [],
    body: applyFallibleShape(
      { statements: initializationStatements },
      {
        fallible,
        hasReturnValue: false,
        errorDomain: context.errorDomain,
      },
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
  readonly initialization: readonly import("../rust-ast/nodes.js").RustStmt[];
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
  const initialization: import("../rust-ast/nodes.js").RustStmt[] = [];
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
    const visibility = ast.hasModifierKind(statement, "export")
      ? "public" as const
      : "crate" as const;
    if (binding.storage === "native-function") {
      const item = planNativeModuleFunction(
        declaration,
        binding.callableDeclaration,
        binding.name,
        visibility === "public",
        context,
      );
      if (item === undefined) {
        return undefined;
      }
      items.push(item);
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
      items.push({
        kind: "const",
        name,
        visibility,
        ...(isUpperSnakeName(name)
          ? {}
          : { attrs: ["#[allow(non_upper_case_globals)]"] }),
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
      isUpperSnakeName(name) ? [] : ["#[allow(non_upper_case_globals)]"],
    );
    items.push(planned.item);
    initialization.push(planned.initialization);
  }
  return { items, initialization };
}
