import {
  KindIdentifier,
  KindNewExpression,
  KindParenthesizedExpression,
  KindVariableDeclaration,
  Node_Expression,
  Node_Initializer,
} from "@tsonic/target-api/source";
import {
  rustAsyncFunctionFactKey,
  rustFallibleFactKey,
  rustFutureValueFactKey,
  rustMutatedBindingFactKey,
  rustResourceManagementFactKey,
  rustSelfModeFactKey,
  rustSourceCallEffectsFactKey,
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import { appendRustDiagnostic, rustOperationContext } from "../program/walk.js";
import { collectDescendantsOfKind } from "../operations/inputs.js";
import { isRustProgramErrorCarrier, rustStringTargetType } from "../../target-model/types/index.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { rustFutureValueForOperation, rustFutureValueMatchesCarrier } from "../facts/future-values.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { selectRustResourceManagement } from "./management.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustFutureValueFact } from "../facts/keys.js";

export function recordResourceManagementFacts(
  walk: RustFactWalk,
  sourceFiles: readonly SourceFile[],
): void {
  const { ast } = walk.context;
  for (const sourceFile of sourceFiles) {
    for (const declaration of collectDescendantsOfKind(walk, sourceFile, KindVariableDeclaration)) {
      const declarationKind = ast.variableDeclarationKind(declaration);
      if (declarationKind !== "using" && declarationKind !== "await using") {
        continue;
      }
      const selected = selectRustResourceManagement(
        declaration,
        rustOperationContext(walk, declaration),
        walk.operationOptions,
        (method) => {
          const selfMode = walk.context.facts.get(method, rustSelfModeFactKey);
          if (selfMode === undefined) {
            return undefined;
          }
          return {
            selfMode,
            async: walk.context.facts.get(method, rustAsyncFunctionFactKey) !== undefined,
            fallible: walk.context.facts.get(method, rustFallibleFactKey) !== undefined,
          };
        },
      );
      if (selected.kind === "rejected") {
        appendRustDiagnostic(
          walk,
          "RUST_RESOURCE_MANAGEMENT_NOT_PROVEN",
          selected.reason,
          declaration,
          ["target.capability=rust.resource-management.selected-disposer"],
        );
        continue;
      }
      walk.context.facts.set(
        declaration,
        rustResourceManagementFactKey,
        selected.fact,
        [{ message: "rust finalized exact resource-management operation" }],
      );
    }
  }
}

export function recordFutureValueFacts(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  const resolving = new Set<Node>();
  const resolve = (node: Node): RustFutureValueFact | undefined => {
    const existing = walk.context.facts.get(node, rustFutureValueFactKey) ??
      walk.context.facts.resolve(node, rustFutureValueFactKey);
    if (existing !== undefined || resolving.has(node)) {
      return existing;
    }
    resolving.add(node);
    try {
      const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(node, rustTargetOperationFactKey);
      const effects = operation?.kind === "source-call"
        ? walk.context.facts.get(node, rustSourceCallEffectsFactKey) ??
          walk.context.facts.resolve(node, rustSourceCallEffectsFactKey)
        : undefined;
      let fact = rustFutureValueForOperation(operation, effects);
      if (fact === undefined) {
        const kind = walk.context.ast.kindName(node);
        if (kind === KindParenthesizedExpression || kind === "KindAsExpression" ||
          kind === "KindTypeAssertionExpression") {
          const operand = Node_Expression(walk.context.ast, node);
          fact = operand === undefined ? undefined : resolve(operand);
        } else if (kind === KindVariableDeclaration) {
          const initializer = Node_Initializer(walk.context.ast, node);
          fact = walk.context.facts.get(node, rustMutatedBindingFactKey) !== undefined || initializer === undefined
            ? undefined
            : resolve(initializer);
        } else if (kind === KindIdentifier) {
          const declaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
          fact = declaration === undefined ? undefined : resolve(declaration);
        }
      }
      if (fact === undefined) {
        return undefined;
      }
      let carrier = walk.context.facts.get(node, rustRuntimeCarrierKey)?.carrier ??
        walk.context.facts.resolve(node, rustRuntimeCarrierKey)?.carrier;
      if (carrier === undefined && walk.context.ast.kindName(node) === KindIdentifier) {
        const declaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
        const declarationCarrier = declaration === undefined
          ? undefined
          : walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
            walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier;
        if (declarationCarrier !== undefined) {
          carrier = setCarrierFact(walk, node, declarationCarrier);
        }
      }
      if (!rustFutureValueMatchesCarrier(fact, carrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_FUTURE_VALUE_CARRIER_CONFLICT",
          "First-class future evidence conflicts with the exact runtime carrier of this value.",
          node,
          ["target.capability=rust.async.future-value"],
        );
        return undefined;
      }
      walk.context.facts.set(node, rustFutureValueFactKey, fact, [
        { message: "rust exact future value" },
      ]);
      return fact;
    } finally {
      resolving.delete(node);
    }
  };
  for (const sourceFile of sourceFiles) {
    const visit = (node: Node): void => {
      resolve(node);
      walk.context.ast.forEachChild(node, (child) => {
        if (child !== undefined) {
          visit(child);
        }
      });
    };
    visit(sourceFile);
  }
}

export function recordThrowFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const expression = Node_Expression(walk.context.ast, statement);
  if (expression === undefined) {
    return;
  }
  const carrier = resolveExpressionCarrier(walk, expression, sourceFile, undefined);
  const constructor = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(expression, rustTargetOperationFactKey);
  if (ast.kindName(expression) === KindNewExpression &&
    constructor?.kind === "provider-operation" &&
    constructor.operationId === "tsonic.rust.error.constructor") {
    const [message] = ast.arguments(expression);
    if (message !== undefined) {
      resolveExpressionCarrier(walk, message, sourceFile, rustStringTargetType());
    }
    setRustOperationFact(walk, statement, {
      kind: "throw-op",
      operationId: "tsonic.rust.error.throw.runtime",
      error: { kind: "runtime", constructorOperationId: constructor.operationId },
    });
    return;
  }
  const definition = walk.context.projectTypes.definitionForCarrier(carrier);
  const variant = definition === undefined
    ? undefined
    : walk.context.projectTypes.programErrorVariant(definition);
  if (carrier !== undefined && definition !== undefined && variant !== undefined) {
    setRustOperationFact(walk, statement, {
      kind: "throw-op",
      operationId: `tsonic.rust.error.throw.${variant}`,
      error: { kind: "project", carrier, variant },
    });
    return;
  }
  if (isRustProgramErrorCarrier(carrier)) {
    setRustOperationFact(walk, statement, {
      kind: "throw-op",
      operationId: "tsonic.rust.error.rethrow",
      error: { kind: "program" },
    });
  }
}

// Callable expressions lower to Rust closures only when the selected target
// callback supplies one finalized function-pointer carrier.
