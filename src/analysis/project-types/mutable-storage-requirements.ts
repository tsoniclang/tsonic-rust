import { flowStateFactKey, pointerOperationFactKey } from "@tsonic/tsts";
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
import { createRustStructuralStorageCollector } from "./structural-storage-requirements.js";

export interface RustMutableProjectStorageRequirements {
  readonly declarations: ReadonlySet<Node>;
  readonly valueWrites: ReadonlySet<Node>;
  readonly referenceDeclarations: ReadonlySet<Node>;
}

export function collectRustMutableProjectStorageRequirements(
  context: RustAnalysisContext,
  projectTypes: RustProjectTypePolicy,
  sourceFiles: readonly SourceFile[],
  providerRows: readonly RustProviderOperationRow[],
  hasValueReceiver: (node: Node) => boolean,
): RustMutableProjectStorageRequirements {
  const mutableDeclarations = new Set<Node>();
  const valueWrites = new Set<Node>();
  const referenceDeclarations = new Set<Node>();
  const collectStructural = createRustStructuralStorageCollector(context, projectTypes, referenceDeclarations, mutableDeclarations);
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
    if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
      const declaration = kind === KindPropertyAccessExpression
        ? context.source.navigation.sourceReferenceFor(node)?.declaration
        : context.semanticsFor(node).operations.elementAccess(node)?.selectedDeclaration;
      if (declaration !== undefined &&
        projectTypes.definitionContainingDeclaration(declaration) !== undefined) {
        mutableDeclarations.add(declaration);
        const owner = projectTypes.definitionContainingDeclaration(declaration)!;
        for (const concrete of projectTypes.concreteClassesFor(owner)) {
          const selected = projectTypes.memberImplementation(concrete, declaration);
          if (selected.kind === "resolved" && ast.is.IsPropertyDeclaration(selected.implementation.declaration)) {
            mutableDeclarations.add(selected.implementation.declaration);
          }
        }
      }
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
    collectStructural(node);
    const { ast } = context;
    const kind = ast.kindName(node);
    const pointer = context.facts.get(node, pointerOperationFactKey);
    if (pointer?.operation === "bind-pointer" && pointer.call === node) {
      const semantics = context.semantics(sourceFile);
      const identityType = semantics.types.expressionType(pointer.identityExpression);
      const symbol = identityType === undefined ? undefined : semantics.declarations.typeSymbol(identityType);
      for (const declaration of symbol === undefined ? [] : semantics.declarations.symbolDeclarations(symbol)) {
        const definition = projectTypes.definitionForDeclaration(declaration);
        if (definition !== undefined) referenceDeclarations.add(definition.declaration);
      }
    }
    if (kind === KindElementAccessExpression) {
      const selected = context.semantics(sourceFile).operations.elementAccess(node);
      if (selected !== undefined && selected.accessMode !== "read") {
        collectStoragePath(Node_Expression(ast, node));
        if ((selected.accessMode === "write" || selected.accessMode === "read-write") &&
          hasValueReceiver(selected.receiver.expression)) {
          valueWrites.add(node);
        }
      }
    }
    if (kind === KindPropertyAccessExpression) {
      const selected = context.semantics(sourceFile).operations.propertyAccess(node);
      if (selected !== undefined && (selected.accessMode === "write" || selected.accessMode === "read-write") &&
        hasValueReceiver(selected.receiver.expression)) {
        collectStoragePath(selected.receiver.expression);
        valueWrites.add(node);
      }
    }
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
  return Object.freeze({ declarations: mutableDeclarations, valueWrites, referenceDeclarations });
}
