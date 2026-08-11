import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api";
import {
  KindFunctionDeclaration,
  KindIdentifier,
  KindImportDeclaration,
  KindExportDeclaration,
  KindVariableStatement,
  Node_Initializer,
  Node_Name,
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
import { planFunctionDeclaration } from "./functions.js";
import {
  diagnosticInput,
  isUpperSnakeName,
  isValidRustIdentifier,
  rustSourceName,
  rustRuntimeAliasImports,
} from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { planBlockLike, planStatement } from "./statements.js";
import { applyFallibleShape } from "./functions.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "./synthetic-names.js";
import {
  planClassDeclaration,
  planEnumDeclaration,
  planInterfaceDeclaration,
  planUnionAliasDeclaration,
} from "./declarations-nominal.js";

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
  input: RustTranslationContext,
  diagnostics: TargetDiagnostic[],
): PlannedRustSourceFile {
  const usedAliases = new Set<string>();
  const context: RustPlanContext = {
    input,
    sourceFile,
    moduleName,
    moduleNameByFileName,
    diagnostics,
    usedAliases,
    planBlock: planBlockLike,
  };
  const plannedModule = planModuleItems(context);
  const aliases = Object.freeze(new Set(usedAliases));
  const useItems: RustItem[] = [...aliases]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((alias) => rustRuntimeAliasImports.get(alias))
    .filter((entry): entry is { path: string; alias: string } =>
      entry !== undefined)
    .map((entry) => ({ kind: "use", path: entry.path, alias: entry.alias }));
  return Object.freeze({
    sourceFile,
    moduleName,
    model: createRustSourceFile([...useItems, ...plannedModule.items]),
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
  const nonSnakeSeen = { value: false };
  const initializationContext: RustPlanContext = {
    ...context,
    nonSnakeSeen,
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
      const planned = planClassDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
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
      const planned = planInterfaceDeclaration(statement, context);
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
      const planned = planUnionAliasDeclaration(statement, context);
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
      ...(nonSnakeSeen.value ? ["#[allow(non_snake_case)]"] : []),
    ],
    ...(asynchronous ? { isAsync: true } : {}),
    ...(fallible ? { fallible: true } : {}),
    params: [],
    body: applyFallibleShape(
      { statements: initializationStatements },
      fallible,
      false,
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
    const nameNode = Node_Name(ast, declaration);
    const sourceName = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier
      ? ast.text(nameNode)
      : "";
    const name = rustSourceName(context, sourceName);
    const initializer = Node_Initializer(ast, declaration);
    const binding = context.input.facts.getFact(declaration, rustModuleBindingFactKey);
    const rustType = rustTypeFromCarrierInContext(binding?.valueCarrier, context);
    if (initializer === undefined || binding === undefined || rustType === undefined ||
      !isValidRustIdentifier(name)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        { ast, sourceFile: context.sourceFile, node: declaration },
        "rust.backend.module-binding",
        "Top-level bindings require a plain Rust identifier, an initializer, and one finalized module-binding carrier fact.",
      ));
      return undefined;
    }
    const value = planExpression(initializer, context);
    if (value === undefined) {
      return undefined;
    }
    const visibility = ast.hasModifierKind(statement, "export")
      ? "public" as const
      : "private" as const;
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
    items.push({
      kind: "thread-local",
      name,
      visibility,
      ...(isUpperSnakeName(name)
        ? {}
        : { attrs: ["#[allow(non_upper_case_globals)]"] }),
      type: {
        kind: "named",
        path: "rt::ModuleCell",
        typeArguments: [rustType],
      },
      value: { kind: "call", path: "rt::ModuleCell::new", args: [] },
    });
    const bindingName = allocateRustSyntheticName(
      context.syntheticNames!,
      "module_binding",
    );
    const valueName = allocateRustSyntheticName(
      context.syntheticNames!,
      "module_value",
    );
    initialization.push({
      kind: "expr",
      expr: {
        kind: "block",
        bindings: [{ name: valueName, value }],
        value: {
          kind: "method-call",
          receiver: { kind: "path", path: name },
          method: "with",
          args: [{
            kind: "closure",
            params: [{ name: bindingName, byRefCopy: false }],
            body: {
              kind: "method-call",
              receiver: { kind: "path", path: bindingName },
              method: "initialize",
              args: [{ kind: "path", path: valueName }],
            },
          }],
        },
      },
    });
  }
  return { items, initialization };
}
