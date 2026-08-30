import type { Node, SourceFile } from "@tsonic/tsts";
import {
  KindExportAssignment,
  KindExportDeclaration,
  KindFunctionDeclaration,
  KindImportDeclaration,
  KindVariableStatement,
  Node_Expression,
} from "@tsonic/target-api/source";
import { rustModuleBindingFactKey } from "../facts/keys.js";
import { rustProjectStaticFieldStorage } from "../project-types/object-layout.js";
import type { RustAnalysisContext } from "./context.js";
import type { RustFoundation } from "../../target-model/foundation/model.js";

export type RustModuleInitializationRequirement =
  | { readonly kind: "required" }
  | { readonly kind: "not-required" }
  | { readonly kind: "unresolved"; readonly node: Node; readonly reason: string };

export interface RustModuleInitializationPlan {
  requirementFor(sourceFile: SourceFile): RustModuleInitializationRequirement;
  minimumFoundation(): RustFoundation;
}

type RustModuleInitializationPlanInput = Pick<
  RustAnalysisContext,
  "ast" | "sourceFiles" | "facts" | "projectTypes" | "safetyApplications"
>;

export function createRustModuleInitializationPlan(
  input: RustModuleInitializationPlanInput,
): RustModuleInitializationPlan {
  const requirements = new Map<SourceFile, RustModuleInitializationRequirement>();
  let minimumFoundation: RustFoundation = "core";
  for (const sourceFile of input.sourceFiles) {
    const requirement = classifyModuleInitialization(input, sourceFile);
    requirements.set(sourceFile, requirement);
    if (requirement.kind === "required") minimumFoundation = "std";
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
  });
}

function classifyModuleInitialization(
  input: RustModuleInitializationPlanInput,
  sourceFile: SourceFile,
): RustModuleInitializationRequirement {
  for (const statement of input.ast.statements(sourceFile)) {
    if (statement === undefined) {
      return unresolved(sourceFile, "Source file contains an undefined top-level statement slot.");
    }
    const kind = input.ast.kindName(statement);
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
