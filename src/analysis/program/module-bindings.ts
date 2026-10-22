import { selectRustModuleValueStorage } from "../../policy/types/storage/module-bindings.js";
import type { AstReader, Node } from "@tsonic/tsts";
import { flowStateFactKey } from "@tsonic/tsts";

import { KindFalseKeyword, KindArrayBindingPattern, KindFunctionExpression, KindNonNullExpression, KindNumericLiteral, KindObjectBindingPattern, KindParenthesizedExpression, KindSatisfiesExpression, KindTrueKeyword, KindVariableDeclaration, KindVariableStatement, Node_Expression, Node_Initializer, Node_Name, VariableDeclarationList_Declarations, VariableStatement_DeclarationList } from "@tsonic/target-api/source";
import { cyclicSourceFiles } from "./module-graph.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustAnalysisContext } from "./context.js";
import type { RustModuleBindingFact } from "../../target-model/records/operation-selections.js";
import { selectRustModuleBindingPattern } from "../module-initialization/binding-patterns.js";

export interface RustModuleBindingAnalysis {
  nativeCallable(declaration: Node): RustNativeModuleCallable | undefined;
  isNativeCallableExpression(expression: Node): boolean;
  classifyValue(
    declaration: Node,
    declarationKind: "const" | "let" | "var",
    valueCarrier: TargetTypeRef,
  ): Exclude<RustModuleBindingFact, { readonly storage: "native-callable" }> | undefined;
}

export interface RustNativeModuleCallable {
  readonly callableDeclaration: Node;
  readonly name: string;
  readonly valueObserved: boolean;
}

export function createRustModuleBindingAnalysis(
  context: RustAnalysisContext,
  addressTakenDeclarations: ReadonlySet<Node>,
): RustModuleBindingAnalysis {
  const callableByDeclaration = collectNativeCallableCandidates(context);
  const cyclic = cyclicSourceFiles(context.source.navigation, context.sourceFiles);
  if (cyclic.kind === "unresolved") context.diagnostics.push({
    code: "RUST_SOURCE_MODULE_GRAPH_NOT_PROVEN", category: "error", source: "tsonic-rust", message: cyclic.reason,
  });
  const nativeCallables = new Map<Node, RustNativeModuleCallable>();
  const nativeExpressions = new WeakSet<Node>();
  for (const [declaration, callableDeclaration] of callableByDeclaration) {
    const sourceFile = context.ast.getSourceFile(declaration);
    const name = context.names.functionNameForDeclaration(declaration);
    if (cyclic.kind === "resolved" && sourceFile !== undefined && name !== undefined && !cyclic.sourceFiles.has(sourceFile) &&
      !context.runtimeValueUses.hasSameFileRuntimeUseBeforeDeclaration(declaration)) {
      const valueObserved = context.runtimeValueUses.hasFirstClassUse(declaration);
      nativeCallables.set(declaration, Object.freeze({
        callableDeclaration,
        name,
        valueObserved,
      }));
      nativeExpressions.add(callableDeclaration);
    }
  }
  return Object.freeze({
    nativeCallable(declaration: Node) {
      return nativeCallables.get(declaration);
    },
    isNativeCallableExpression(expression: Node) {
      return nativeExpressions.has(expression);
    },
    classifyValue(
      declaration: Node,
      declarationKind: "const" | "let" | "var",
      valueCarrier: TargetTypeRef,
    ): Exclude<RustModuleBindingFact, { readonly storage: "native-callable" }> | undefined {
      if (cyclic.kind === "unresolved") return undefined;
      const name = Node_Name(context.ast, declaration);
      const nameKind = name === undefined ? undefined : context.ast.kindName(name);
      if (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) {
        return selectRustModuleBindingPattern(declaration, declarationKind, valueCarrier, context);
      }
      const initializer = Node_Initializer(context.ast, declaration);
      const initializerKind = initializer === undefined
        ? undefined
        : context.ast.kindName(initializer);
      return selectRustModuleValueStorage(declarationKind, valueCarrier, {
        addressTaken: addressTakenDeclarations.has(declaration),
        scalarLiteral: initializerKind === KindNumericLiteral || initializerKind === KindTrueKeyword || initializerKind === KindFalseKeyword,
        stringLiteral: initializerKind === "KindStringLiteral" || initializerKind === "KindNoSubstitutionTemplateLiteral",
        stringStable: moduleStringCanUseStaticStorage(declaration, context) &&
          !cyclic.sourceFiles.has(context.ast.getSourceFile(declaration)!) &&
          !context.runtimeValueUses.hasSameFileRuntimeUseBeforeDeclaration(declaration),
        initialized: initializer !== undefined,
      });
    },
  });
}

function moduleStringCanUseStaticStorage(declaration: Node, context: RustAnalysisContext): boolean {
  const summary = context.source.navigation.declarationUseSummary(declaration);
  if (summary.exported || summary.bindingWritten) return false;
  return summary.uses.every(use =>
    context.source.sourceFacts.getFact(use.reference, flowStateFactKey) === undefined);
}

function collectNativeCallableCandidates(
  context: RustAnalysisContext,
): ReadonlyMap<Node, Node> {
  const candidates = new Map<Node, Node>();
  for (const sourceFile of context.sourceFiles) {
    for (const statement of context.ast.statements(sourceFile)) {
      if (statement === undefined || context.ast.kindName(statement) !== KindVariableStatement) {
        continue;
      }
      const declarations = VariableDeclarationList_Declarations(
        context.ast,
        VariableStatement_DeclarationList(context.ast, statement),
      );
      if (declarations === undefined || declarations.length === 0) {
        continue;
      }
      for (const declaration of declarations) {
        const callable = declaration === undefined ||
            context.ast.kindName(declaration) !== KindVariableDeclaration ||
            context.ast.variableDeclarationKind(declaration) !== "const"
          ? undefined
          : exactNativeCallableInitializer(declaration, context);
        if (declaration !== undefined && callable !== undefined) {
          candidates.set(declaration, callable);
        }
      }
    }
  }
  return candidates;
}

function exactNativeCallableInitializer(
  declaration: Node,
  context: RustAnalysisContext,
): Node | undefined {
  const initializer = transparentExpression(
    Node_Initializer(context.ast, declaration),
    context.ast,
  );
  const kind = initializer === undefined ? undefined : context.ast.kindName(initializer);
  if (initializer === undefined ||
    (kind !== "KindArrowFunction" && kind !== KindFunctionExpression) ||
    context.ast.body(initializer) === undefined ||
    kind === KindFunctionExpression && context.ast.name(initializer) !== undefined) {
    return undefined;
  }
  return initializer;
}

function transparentExpression(
  expression: Node | undefined,
  ast: AstReader,
): Node | undefined {
  let current = expression;
  while (current !== undefined) {
    const kind = ast.kindName(current);
    if (kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
      kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
      kind !== "KindTypeAssertionExpression") {
      return current;
    }
    current = Node_Expression(ast, current);
  }
  return undefined;
}
