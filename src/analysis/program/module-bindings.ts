import type { AstReader, Node } from "@tsonic/tsts";
import {
  KindFalseKeyword,
  KindFunctionExpression,
  KindNonNullExpression,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindSatisfiesExpression,
  KindTrueKeyword,
  KindVariableDeclaration,
  KindVariableStatement,
  Node_Expression,
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import { cyclicSourceFiles } from "./module-graph.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustAnalysisContext } from "./context.js";
import type { RustModuleBindingFact } from "../facts/keys.js";

export interface RustModuleBindingPolicy {
  nativeCallable(declaration: Node): RustNativeModuleCallable | undefined;
  classifyValue(
    declaration: Node,
    declarationKind: "const" | "let" | "var",
    valueCarrier: TargetTypeRef,
  ): Exclude<RustModuleBindingFact, { readonly storage: "native-callable" }>;
}

export interface RustNativeModuleCallable {
  readonly callableDeclaration: Node;
  readonly name: string;
  readonly valueObserved: boolean;
}

export function createRustModuleBindingPolicy(
  context: RustAnalysisContext,
): RustModuleBindingPolicy {
  const callableByDeclaration = collectNativeCallableCandidates(context);
  const cyclic = cyclicSourceFiles(context.source.navigation, context.sourceFiles);
  const nativeCallables = new Map<Node, RustNativeModuleCallable>();
  for (const [declaration, callableDeclaration] of callableByDeclaration) {
    const sourceFile = context.ast.getSourceFile(declaration);
    const name = context.names.functionNameForDeclaration(declaration);
    if (sourceFile !== undefined && name !== undefined && !cyclic.has(sourceFile) &&
      !context.runtimeValueUses.hasSameFileRuntimeUseBeforeDeclaration(declaration)) {
      const valueObserved = context.runtimeValueUses.hasFirstClassUse(declaration);
      nativeCallables.set(declaration, Object.freeze({
        callableDeclaration,
        name,
        valueObserved,
      }));
    }
  }
  return Object.freeze({
    nativeCallable(declaration: Node) {
      return nativeCallables.get(declaration);
    },
    classifyValue(
      declaration: Node,
      declarationKind: "const" | "let" | "var",
      valueCarrier: TargetTypeRef,
    ): Exclude<RustModuleBindingFact, { readonly storage: "native-callable" }> {
      const controls = context.declarationApplications.forDeclaration(declaration)
        .flatMap((occurrence) => occurrence.fact.kind === "application"
          ? [occurrence.fact.application.operation]
          : []);
      if (controls.includes("mutable-static")) {
        return {
          declarationKind: declarationKind === "const" ? "let" : declarationKind,
          storage: "native-static",
          valueCarrier,
        };
      }
      if (controls.includes("thread-local")) {
        return {
          declarationKind,
          storage: "thread-local-cell",
          valueCarrier,
        };
      }
      const initializer = Node_Initializer(context.ast, declaration);
      const initializerKind = initializer === undefined
        ? undefined
        : context.ast.kindName(initializer);
      const nativeConst = declarationKind === "const" && (
        initializerKind === KindNumericLiteral ||
        initializerKind === KindTrueKeyword ||
        initializerKind === KindFalseKeyword
      );
      if (nativeConst) {
        return {
          declarationKind: "const",
          storage: "native-const",
          valueCarrier,
        };
      }
      return {
        declarationKind,
        storage: "module-cell",
        valueCarrier,
      };
    },
  });
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
    context.ast.hasModifierKind(initializer, "async") ||
    context.semanticsFor(initializer).operations.generator(initializer) !== undefined ||
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
