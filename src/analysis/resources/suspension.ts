import {
  KindIdentifier,
  KindParenthesizedExpression,
  KindVariableDeclaration,
  Node_Expression,
  Node_Initializer,
} from "@tsonic/target-api/source";

import { appendRustDiagnostic, rustOperationContext } from "../program/walk.js";
import { collectDescendantsOfKind } from "../operations/inputs.js";
import { isRustProgramErrorCarrier } from "../../target-model/types/index.js";
import { selectRustProgramErrorConversion } from "../../target-model/conversions/program-error.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { rustFutureValueForOperation, rustFutureValueForSourceStorage, rustFutureValueMatchesCarrier, transportRustFutureValue } from "../callables/future-values.js";

import { selectRustResourceManagement } from "./management.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustFutureValueFact } from "../../target-model/records/object-methods.js";
import { finalizeRustAwaitValueFact } from "../callables/await-values.js";

import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { rustFutureValueForStoredBranch } from "./future-storage.js";

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
          const selfMode = walk.context.records.selfMode.get(method);
          if (selfMode === undefined) {
            return undefined;
          }
          return {
            selfMode,
            async: walk.context.records.asyncFunction.get(method) !== undefined,
            fallible: walk.context.records.fallible.get(method) !== undefined,
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
      walk.context.records.resourceManagement.set(declaration, selected.fact, [{ message: "rust finalized exact resource-management operation" }]);
      walk.context.generatedDeclarationUses.record(
        declaration,
        selected.projectDisposerDeclarations,
      );
    }
  }
}

export function recordFutureValueFacts(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  const resolving = new Set<Node>();
  const resolve = (node: Node): RustFutureValueFact | undefined => {
    const existing = walk.context.records.futureValue.get(node);
    if (existing !== undefined || resolving.has(node)) {
      return existing;
    }
    resolving.add(node);
    try {
      const transport = (operand: Node | undefined): RustFutureValueFact | undefined => {
        if (operand === undefined) return undefined;
        const fact = resolve(operand);
        const source = walk.context.records.runtimeCarrier.get(operand)?.carrier;
        let target = walk.context.records.runtimeCarrier.get(node)?.carrier;
        if (fact === undefined) return undefined;
        if (target === undefined && source !== undefined && walk.context.ast.kindName(node) === KindIdentifier) {
          target = setCarrierFact(walk, node, source);
        }
        const selected = transportRustFutureValue(fact, source, target, walk.context.typeDefinitions);
        if (selected === undefined) {
          appendRustDiagnostic(walk, "RUST_FUTURE_VALUE_CARRIER_CONFLICT",
            "Future-value transport requires an exact native representation relationship.", node,
            ["target.capability=rust.async.future-value"]);
        }
        return selected;
      };
      const operation = walk.context.records.targetOperation.get(node);
      const effects = operation?.kind === "source-call"
        ? walk.context.records.sourceCallEffects.get(node)
        : undefined;
      let fact = operation?.kind === "source-call"
        ? rustFutureValueForStoredBranch(walk, node, operation.resultCarrier)
        : rustFutureValueForOperation(operation, effects, walk.context.typeDefinitions);
      if (fact === undefined) {
        const kind = walk.context.ast.kindName(node);
        if (kind === KindParenthesizedExpression || kind === "KindAsExpression" ||
          kind === "KindTypeAssertionExpression") {
          const operand = Node_Expression(walk.context.ast, node);
          fact = transport(operand);
        } else if (kind === KindVariableDeclaration) {
          const initializer = Node_Initializer(walk.context.ast, node);
          fact = walk.context.records.mutatedBinding.get(node) !== undefined || initializer === undefined
            ? rustFutureValueForSourceStorage(walk.context.records.runtimeCarrier.get(node)?.carrier)
            : transport(initializer);
        } else if (kind === KindIdentifier) {
          const declaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
          fact = transport(declaration);
        } else if (kind === "KindParameter" || kind === "KindPropertyDeclaration" || kind === "KindPropertySignature" ||
          kind === "KindPropertyAccessExpression" || kind === "KindElementAccessExpression") {
          fact = rustFutureValueForSourceStorage(walk.context.records.runtimeCarrier.get(node)?.carrier);
        }
      }
      if (fact === undefined) {
        return undefined;
      }
      const carrier = walk.context.records.runtimeCarrier.get(node)?.carrier ??
        walk.context.records.runtimeCarrier.get(node)?.carrier;
      if (!rustFutureValueMatchesCarrier(fact, carrier, walk.context.typeDefinitions)) {
        appendRustDiagnostic(
          walk,
          "RUST_FUTURE_VALUE_CARRIER_CONFLICT",
          "First-class future evidence conflicts with the exact runtime carrier of this value.",
          node,
          ["target.capability=rust.async.future-value"],
        );
        return undefined;
      }
      walk.context.records.futureValue.set(node, fact, [
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
      if (walk.context.ast.kindName(node) !== "KindAwaitExpression") return;
      const operand = Node_Expression(walk.context.ast, node);
      const operation = walk.context.records.targetOperation.get(node);
      const carrier = rustEffectiveValueCarrier(walk.context.records, operand);
      if (operand === undefined || operation?.kind !== "await-op" || carrier === undefined) return;
      const knownFuture = resolve(operand);
      const awaiting = finalizeRustAwaitValueFact(carrier, operation.resultCarrier, leaf =>
        knownFuture !== undefined && rustFutureValueMatchesCarrier(knownFuture, leaf, walk.context.typeDefinitions)
          ? knownFuture : rustFutureValueForStoredBranch(walk, operand, leaf) ?? rustFutureValueForSourceStorage(leaf),
      (source, target) => selectRustSourceValueConversion(source, target, walk.context.typeDefinitions),
      walk.context.typeDefinitions);
      if (awaiting === undefined) {
        appendRustDiagnostic(walk, "RUST_AWAIT_VALUE_CONTRACT_NOT_PROVEN",
          "Await requires a closed native branch selection with exact future effects and result conversions.", node,
          ["target.capability=rust.async.await-value"]);
        return;
      }
      walk.context.records.awaitValue.set(node, awaiting, [{ message: "rust finalized native await branches" }]);
    };
    visit(sourceFile);
  }
}

export function recordThrowFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  const expression = Node_Expression(walk.context.ast, statement);
  if (expression === undefined) {
    return;
  }
  const carrier = resolveExpressionCarrier(walk, expression, sourceFile, undefined);
  const conversion = carrier === undefined ? undefined : selectRustProgramErrorConversion(carrier,
    undefined, walk.context.typeDefinitions);
  if (conversion !== undefined) {
    setRustOperationFact(walk, statement, Object.freeze({
      kind: "throw-op",
      operationId: "tsonic.rust.error.throw",
      error: Object.freeze({ kind: "conversion", expression, conversion }),
    }));
    return;
  }
  if (carrier !== undefined && isRustProgramErrorCarrier(carrier)) {
    setRustOperationFact(walk, statement, {
      kind: "throw-op",
      operationId: "tsonic.rust.error.rethrow",
      error: { kind: "program", expression, carrier },
    });
  }
}

// Callable expressions lower to Rust closures only when the selected target
// callback supplies one finalized function-pointer carrier.
