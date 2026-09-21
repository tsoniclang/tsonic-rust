import type { Node, SourceFile } from "@tsonic/tsts";
import { rustTypeOnlyDeclarationFactKey } from "../../target-model/facts/type-only.js";
import {
  KindExportAssignment,
  KindExportDeclaration,
  KindFunctionDeclaration,
  KindImportDeclaration,
  KindVariableStatement,
  Node_Expression,
} from "@tsonic/target-api/source";
import { rustModuleBindingFactKey } from "../facts/keys.js";
import { rustCompileTimeSourceKey } from "../../target-model/facts/source-declarations.js";
import { rustProjectStaticFieldStorage } from "../project-types/object-layout.js";
import type { RustAnalysisContext } from "./context.js";
import type { RustFoundation } from "../../target-model/foundation/model.js";
import { stronglyConnectedSourceFiles } from "./module-graph.js";
import { rustModuleInitializationIsStateIndependent } from "./independent-module-initialization.js";
import type { RustClassValuePlan } from "../objects/class-values.js";

export type RustModuleInitializationRequirement =
  | { readonly kind: "required" }
  | { readonly kind: "not-required" }
  | { readonly kind: "unresolved"; readonly node: Node; readonly reason: string };

export interface RustModuleInitializationPlan {
  requirementFor(sourceFile: SourceFile): RustModuleInitializationRequirement;
  minimumFoundation(): RustFoundation;
  hasStateIndependentCycle(sourceFile: SourceFile): boolean;
}

type RustModuleInitializationPlanInput = Pick<
  RustAnalysisContext,
  "ast" | "source" | "sourceFiles" | "facts" | "projectTypes" | "safetyApplications"
>;

export function createRustModuleInitializationPlan(
  input: RustModuleInitializationPlanInput,
  classValues: RustClassValuePlan,
): RustModuleInitializationPlan {
  const requirements = new Map<SourceFile, RustModuleInitializationRequirement>();
  let minimumFoundation: RustFoundation = "core";
  for (const sourceFile of input.sourceFiles) {
    const requirement = classifyModuleInitialization(input, sourceFile, classValues);
    requirements.set(sourceFile, requirement);
    if (requirement.kind === "required") minimumFoundation = "std";
  }
  const stateIndependentCycles = new Set<SourceFile>();
  for (const component of stronglyConnectedSourceFiles(input.source.navigation, new Set(input.sourceFiles))) {
    const first = component[0];
    if (first === undefined || component.length === 1 && !input.source.navigation.moduleDependencies(first)
      .some(dependency => dependency.sourceFile === first)) continue;
    const members = new Set(component);
    if (component.every(sourceFile => rustModuleInitializationIsStateIndependent(input, sourceFile, members))) {
      for (const sourceFile of component) stateIndependentCycles.add(sourceFile);
    }
  }
  return Object.freeze({
    requirementFor(sourceFile: SourceFile) {
      return requirements.get(sourceFile) ?? unresolved(
        sourceFile,
        "Source file has no finalized Rust module-initialization requirement.",
      );
    },
    minimumFoundation() {
      return minimumFoundation;
    },
    hasStateIndependentCycle(sourceFile: SourceFile) {
      return stateIndependentCycles.has(sourceFile);
    },
  });
}

function classifyModuleInitialization(
  input: RustModuleInitializationPlanInput,
  sourceFile: SourceFile,
  classValues: RustClassValuePlan,
): RustModuleInitializationRequirement {
  for (const statement of input.ast.statements(sourceFile)) {
    if (statement === undefined) {
      return unresolved(sourceFile, "Source file contains an undefined top-level statement slot.");
    }
    const kind = input.ast.kindName(statement);
    if (input.facts.getFact(statement, rustTypeOnlyDeclarationFactKey) !== undefined) continue;
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
        if (input.facts.getFact(declaration, rustCompileTimeSourceKey)) continue;
        const binding = input.facts.getFact(declaration, rustModuleBindingFactKey);
        if (binding === undefined) {
          return unresolved(
            declaration,
            "Top-level variable declaration has no finalized Rust module-binding fact.",
          );
        }
        if (binding.storage === "module-cell" ||
          (binding.storage === "native-callable" && binding.value !== undefined)) {
          return { kind: "required" };
        }
      }
      continue;
    }
    if (kind === "KindClassDeclaration") {
      if (classValues.forDeclaration(statement) !== undefined) return { kind: "required" };
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
          return { kind: "required" };
        }
      }
      continue;
    }
    if (kind === KindExportAssignment) {
      return { kind: "required" };
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
      if (input.facts.getFact(expression, rustCompileTimeSourceKey)) continue;
      if (operation?.kind === "safety-builder" ||
        (operation?.kind === "unsafe-context" && operation.fact.kind === "remaining-block")) {
        continue;
      }
    }
    return { kind: "required" };
  }
  return { kind: "not-required" };
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
