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
  Node_Type,
} from "../../common/source-ast.js";
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
  unsupportedStatementDiagnostic,
} from "./diagnostics.js";
import { planExpression } from "./expressions.js";
import { planFunctionDeclaration } from "./functions.js";
import {
  diagnosticInput,
  isUpperSnakeName,
  isValidRustIdentifier,
  rustRuntimeAliasImports,
} from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { isConstLiteralInitializer } from "./statements.js";
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
  };
  const items = planModuleItems(context);
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
    model: createRustSourceFile([...useItems, ...items]),
  });
}

function planModuleItems(context: RustPlanContext): readonly RustItem[] {
  const { ast } = context.input;
  const items: RustItem[] = [];
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
      const item = planTopLevelConst(statement, context);
      if (item !== undefined) {
        items.push(item);
      } else {
        ensureTopLevelPlanningDiagnostic(
          context,
          statement,
          diagnosticCount,
          "const",
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
    context.diagnostics.push(unsupportedStatementDiagnostic(
      { ast, sourceFile: context.sourceFile, node: statement },
      "rust.backend.statement",
    ));
  }
  return items;
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

function planTopLevelConst(
  statement: Node,
  context: RustPlanContext,
): RustItem | undefined {
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
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  const nameNode = declaration === undefined
    ? undefined
    : Node_Name(ast, declaration);
  const name = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier
    ? ast.text(nameNode)
    : "";
  const initializer = declaration === undefined
    ? undefined
    : Node_Initializer(ast, declaration);
  const typeNode = declaration === undefined
    ? undefined
    : Node_Type(ast, declaration);
  const carrier = typeNode === undefined
    ? undefined
    : context.input.facts.getRuntimeCarrierFact(typeNode)?.carrier;
  const rustType = rustTypeFromCarrierInContext(carrier, context);
  if (declaration === undefined ||
    ast.variableDeclarationKind(statement) !== "const" ||
    initializer === undefined ||
    typeNode === undefined ||
    rustType === undefined ||
    rustType.kind === "string" ||
    !isValidRustIdentifier(name) ||
    !isConstLiteralInitializer(initializer, context) ||
    ast.kindName(initializer) === "KindStringLiteral") {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      { ast, sourceFile: context.sourceFile, node: statement },
      "rust.backend.const",
      "Top-level declarations support only annotated const bindings with numeric or boolean literals.",
    ));
    return undefined;
  }
  const value = planExpression(initializer, context);
  if (value === undefined) {
    return undefined;
  }
  return {
    kind: "const",
    name,
    pub: ast.hasModifierKind(statement, "export"),
    ...(isUpperSnakeName(name)
      ? {}
      : { attrs: ["#[allow(non_upper_case_globals)]"] }),
    type: rustType,
    value,
  };
}
