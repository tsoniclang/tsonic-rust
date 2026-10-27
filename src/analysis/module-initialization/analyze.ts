import { validateSourceBinaryEntry } from "@tsonic/target-api/analysis";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFoundation } from "../../target-model/foundation/model.js";
import { resolve } from "node:path";

import {
  KindExportAssignment,
  KindExportDeclaration,
  KindFunctionDeclaration,
  KindImportDeclaration,
  KindVariableStatement,
  Node_Expression,
} from "@tsonic/target-api/source";

import { rustProjectStaticFieldStorage } from "../project-types/object-layout.js";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustClassValuePlan } from "../../target-model/records/objects/class-values.js";

import type { RustModuleInitializationIssue, RustModuleInitializationPlan, RustModuleInitializationRequirement,
  RustUnsupportedTopLevelStatementIssue } from "../../target-model/records/program/module-initialization.js";
import { createRustModuleInitializationRecords } from "../program/records/program/module-initialization.js";

type RustModuleInitializationPlanInput = Pick<
  RustAnalysisContext,
  "ast" | "source" | "sourceFiles" | "records" | "projectTypes" | "safetyApplications"
>;

export function createRustModuleInitializationPlan(
  input: RustModuleInitializationPlanInput,
  classValues: RustClassValuePlan,
  entry: { readonly outputType: "bin" | "lib"; readonly projectRoot: string; readonly entryPoint: string },
  moduleCycles: readonly import("../../target-model/records/program/module-initialization.js").RustModuleCycleSelection[],
): RustModuleInitializationPlan {
  const entryPath = resolve(entry.projectRoot, entry.entryPoint).split("\\").join("/");
  const entrySourceFile = entry.outputType === "lib" ? undefined : input.sourceFiles.find(sourceFile =>
    resolve(input.ast.getFileName(sourceFile)).split("\\").join("/") === entryPath);
  const unsupported = input.sourceFiles.flatMap(sourceFile => unsupportedTopLevelStatements(input, sourceFile));
  const issues: readonly RustModuleInitializationIssue[] = unsupported.length !== 0 ? Object.freeze(unsupported)
    : entry.outputType === "lib" || entrySourceFile === undefined ? Object.freeze([])
    : validateSourceBinaryEntry(input.source, entrySourceFile);
  const requirements = new Map<SourceFile, RustModuleInitializationRequirement>();
  let minimumFoundation: RustFoundation = "core";
  for (const sourceFile of input.sourceFiles) {
    const requirement = classifyModuleInitialization(input, sourceFile, classValues);
    requirements.set(sourceFile, requirement);
    if (requirement.kind === "required") minimumFoundation = "std";
  }
  return createRustModuleInitializationRecords({ issues, requirements, minimumFoundation, moduleCycles });
}

// The top-level statement kinds the Rust target lowers: declarations that emit items or nothing at runtime, and the
// runtime statements the module initializer executes.
const topLevelStatementKinds: ReadonlySet<string> = new Set([
  KindImportDeclaration, KindExportDeclaration, KindExportAssignment, KindFunctionDeclaration, KindVariableStatement,
  "KindInterfaceDeclaration", "KindTypeAliasDeclaration", "KindEnumDeclaration", "KindClassDeclaration", "KindEndOfFile",
  "KindEmptyStatement", "KindDebuggerStatement", "KindBlock", "KindExpressionStatement", "KindIfStatement",
  "KindWhileStatement", "KindDoStatement", "KindForStatement", "KindForInStatement", "KindForOfStatement",
  "KindLabeledStatement", "KindSwitchStatement", "KindThrowStatement", "KindTryStatement",
]);

function unsupportedTopLevelStatements(input: RustModuleInitializationPlanInput, sourceFile: SourceFile): readonly RustUnsupportedTopLevelStatementIssue[] {
  return input.ast.statements(sourceFile).flatMap(statement => {
    if (statement === undefined || input.records.typeOnlyDeclaration.get(statement) !== undefined ||
      input.records.compileTimeSource.get(statement) !== undefined) return [];
    const kind = input.ast.kindName(statement);
    if (topLevelStatementKinds.has(kind)) return [];
    return [Object.freeze({ code: "RUST_UNSUPPORTED_AST" as const, node: statement,
      message: `The Rust target does not support the top-level statement ${kind}.`,
      evidence: Object.freeze(["target.capability=rust.backend.statement",
        `source.byteSpan=${input.ast.pos(statement)}-${input.ast.end(statement)}`]) })];
  });
}

function classifyModuleInitialization(
  input: RustModuleInitializationPlanInput,
  sourceFile: SourceFile,
  classValues: RustClassValuePlan,
): RustModuleInitializationRequirement {
  let required = false;
  for (const statement of input.ast.statements(sourceFile)) {
    if (statement === undefined) {
      return unresolved(sourceFile, "Source file contains an undefined top-level statement slot.");
    }
    const kind = input.ast.kindName(statement);
    if (input.records.typeOnlyDeclaration.get(statement) !== undefined) continue;
    if (kind === KindImportDeclaration || kind === KindExportDeclaration ||
      kind === KindFunctionDeclaration || kind === "KindInterfaceDeclaration" ||
      kind === "KindTypeAliasDeclaration" || kind === "KindEnumDeclaration" ||
      kind === "KindEndOfFile" || kind === "KindEmptyStatement") {
      continue;
    }
    if (kind === KindVariableStatement) {
      const variables = variableDeclarations(statement, input);
      if (variables.length === 0) {
        return unresolved(statement, "Top-level variable statement has no exact variable declarations.");
      }
      for (const declaration of variables) {
        if (input.records.compileTimeSource.get(declaration)) continue;
        const binding = input.records.moduleBinding.get(declaration);
        if (binding === undefined) {
          return unresolved(
            declaration,
            "Top-level variable declaration has no finalized Rust module-binding fact.",
          );
        }
        const name = input.ast.name(declaration);
        const nameKind = name === undefined ? undefined : input.ast.kindName(name);
        const pattern = nameKind === "KindObjectBindingPattern" || nameKind === "KindArrayBindingPattern";
        if (pattern !== (binding.storage === "module-pattern")) {
          return unresolved(declaration,
            "Top-level binding pattern requires its finalized ordered root and leaf module-binding evidence.");
        }
        if (binding.storage === "native-callable" && binding.value !== undefined) {
          const storage = input.records.moduleCallableStorage.get(declaration);
          if (storage === undefined) return unresolved(declaration,
            "Module callable values require their finalized native storage selection.");
          if (storage.kind === "stored") required = true;
        }
        if (binding.storage === "module-cell" || binding.storage === "module-pattern") {
          required = true;
        }
      }
      continue;
    }
    if (kind === "KindClassDeclaration") {
      const environment = classValues.forDeclaration(statement)?.environment;
      if (environment !== undefined && (environment.evaluatedConstructorValue || environment.staticFields.length > 0)) required = true;
      for (const member of input.ast.members(statement)) {
        if (member === undefined) {
          return unresolved(statement, "Class declaration contains an undefined member slot.");
        }
        if (input.ast.kindName(member) === "KindClassStaticBlockDeclaration" ||
          rustProjectStaticFieldStorage(
            member,
            input.ast,
            input.projectTypes.memberSlotName(member, "static"),
          ) !== undefined) {
          required = true;
        }
      }
      continue;
    }
    if (kind === KindExportAssignment) {
      required = true;
      continue;
    }
    if (kind === "KindExpressionStatement") {
      const expression = Node_Expression(input.ast, statement);
      if (expression === undefined) {
        return unresolved(
          statement,
          "Top-level expression statement has no exact expression.",
        );
      }
      const operation = input.safetyApplications.operationForExpression(expression);
      if (input.records.compileTimeSource.get(expression)) continue;
      if (operation?.kind === "safety-builder" ||
        (operation?.kind === "unsafe-context" && operation.fact.kind === "remaining-block")) {
        continue;
      }
    }
    required = true;
  }
  return { kind: required ? "required" : "not-required" };
}

function variableDeclarations(
  statement: Node,
  input: RustModuleInitializationPlanInput,
): readonly Node[] {
  const result: Node[] = [];
  const visit = (node: Node): void => {
    if (input.ast.kindName(node) === "KindVariableDeclaration") {
      result.push(node);
      return;
    }
    input.ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(statement);
  return result;
}

function unresolved(node: Node, reason: string): RustModuleInitializationRequirement {
  return { kind: "unresolved", node, reason };
}
