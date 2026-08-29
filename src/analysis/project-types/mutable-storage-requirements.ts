import { flowStateFactKey } from "@tsonic/tsts";
import {
  KindCallExpression,
  KindElementAccessExpression,
  KindNewExpression,
  KindPropertyAccessExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import {
  resolveSelectedProviderDeclaration,
} from "../../policy/evidence/selected-source.js";
import {
  rustProviderOperationSourceArgumentMayMutate,
  rustProviderOperationSourceReceiverMayMutate,
} from "../../policy/operations/forms.js";
import {
  selectRustProviderOperation,
} from "../../policy/operations/provider-selection.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustProjectTypePolicy } from "./type-policy.js";
import type { RustProviderOperationRow } from "../../providers/packages/model.js";

export function collectRustMutableProjectStorageRequirements(
  context: RustAnalysisContext,
  projectTypes: RustProjectTypePolicy,
  sourceFiles: readonly SourceFile[],
  providerRows: readonly RustProviderOperationRow[],
): ReadonlySet<Node> {
  const mutableDeclarations = new Set<Node>();
  const collectStoragePath = (node: Node | undefined): void => {
    if (node === undefined) {
      return;
    }
    const { ast } = context;
    const kind = ast.kindName(node);
    const flow = context.facts.get(node, flowStateFactKey);
    if (flow?.state === "borrowed-mut" && kind === KindCallExpression) {
      const arguments_ = ast.arguments(node);
      if (arguments_.length === 1) {
        collectStoragePath(arguments_[0]);
      }
      return;
    }
    if (kind === KindPropertyAccessExpression) {
      const declaration = context.source.navigation.sourceReferenceFor(node)?.declaration;
      if (declaration !== undefined &&
        projectTypes.definitionContainingDeclaration(declaration) !== undefined) {
        mutableDeclarations.add(declaration);
      }
      collectStoragePath(Node_Expression(ast, node));
      return;
    }
    if (kind === KindElementAccessExpression) {
      collectStoragePath(Node_Expression(ast, node));
      return;
    }
    if (ast.is.IsParenthesizedExpression(node) ||
      ast.is.IsAsExpression(node) ||
      ast.is.IsSatisfiesExpression(node) ||
      ast.is.IsNonNullExpression(node) ||
      ast.is.IsTypeAssertion(node)) {
      collectStoragePath(Node_Expression(ast, node));
    }
  };
  const visit = (sourceFile: SourceFile, node: Node): void => {
    const { ast } = context;
    const kind = ast.kindName(node);
    if (kind === KindCallExpression || kind === KindNewExpression) {
      const semantics = context.semantics(sourceFile);
      const source = semantics.operations.call(node);
      if (source !== undefined) {
        const selectedDeclaration = semantics.declarations.signatureDeclaration(
          source.selectedSignature,
        );
        const selectedProvider = resolveSelectedProviderDeclaration(
          context,
          selectedDeclaration,
          [
            { subject: source.selectedSignature, precision: "exact" },
            {
              subject: source.sourceCallee.selectedDeclaration ??
                source.sourceCallee.declaration,
              precision: "declaration",
            },
            {
              subject: source.sourceCallee.selectedSymbol ?? source.sourceCallee.symbol,
              precision: "declaration",
            },
          ],
        );
        if (selectedProvider.kind === "selected") {
          const operationKind = kind === KindNewExpression ? "constructor" : "method";
          const selection = selectRustProviderOperation(
            providerRows,
            selectedProvider.identity,
            operationKind,
          );
          if (selection.kind === "selected") {
            if (rustProviderOperationSourceReceiverMayMutate(
              selection.row.target,
              operationKind,
            )) {
              collectStoragePath(source.sourceReceiver?.expression);
            }
            for (const [sourceIndex, argument] of source.sourceArguments.entries()) {
              if (rustProviderOperationSourceArgumentMayMutate(
                selection.row.target,
                sourceIndex,
              )) {
                collectStoragePath(argument.expression);
              }
            }
          }
        }
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(sourceFile, child);
      }
    });
  };
  for (const sourceFile of sourceFiles) {
    visit(sourceFile, sourceFile);
  }
  return mutableDeclarations;
}
