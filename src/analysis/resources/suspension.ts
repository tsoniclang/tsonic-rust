import {
  KindIdentifier,
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
import { isRustProgramErrorCarrier } from "../../target-model/types/index.js";
import { selectRustProgramErrorConversion } from "../../target-model/conversions/program-error.js";
import { reconcileRequiredCarrier, resolveExpressionCarrier } from "../expressions/carriers.js";
import { rustBroadSourceValueTargetType } from "../../policy/types/resolution/broad-values.js";
import { rustFutureValueForOperation, rustFutureValueForSourceStorage, rustFutureValueMatchesCarrier, transportRustFutureValue } from "../facts/future-values.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { selectRustResourceManagement } from "./management.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustFutureValueFact } from "../facts/keys.js";
import { finalizeRustAwaitValueFact, rustAwaitValueFactKey } from "../facts/await-values.js";
import { rustEffectiveValueCarrier } from "../facts/value-carrier-queries.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";

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
    const existing = walk.context.facts.get(node, rustFutureValueFactKey) ??
      walk.context.facts.resolve(node, rustFutureValueFactKey);
    if (existing !== undefined || resolving.has(node)) {
      return existing;
    }
    resolving.add(node);
    try {
      const transport = (operand: Node | undefined): RustFutureValueFact | undefined => {
        if (operand === undefined) return undefined;
        const fact = resolve(operand);
        const source = walk.context.facts.getRuntimeCarrierFact(operand)?.carrier;
        let target = walk.context.facts.getRuntimeCarrierFact(node)?.carrier;
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
      const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(node, rustTargetOperationFactKey);
      const effects = operation?.kind === "source-call"
        ? walk.context.facts.get(node, rustSourceCallEffectsFactKey) ??
          walk.context.facts.resolve(node, rustSourceCallEffectsFactKey)
        : undefined;
      let fact = rustFutureValueForOperation(operation, effects, walk.context.typeDefinitions);
      if (fact === undefined) {
        const kind = walk.context.ast.kindName(node);
        if (kind === KindParenthesizedExpression || kind === "KindAsExpression" ||
          kind === "KindTypeAssertionExpression") {
          const operand = Node_Expression(walk.context.ast, node);
          fact = transport(operand);
        } else if (kind === KindVariableDeclaration) {
          const initializer = Node_Initializer(walk.context.ast, node);
          fact = walk.context.facts.get(node, rustMutatedBindingFactKey) !== undefined || initializer === undefined
            ? rustFutureValueForSourceStorage(walk.context.facts.getRuntimeCarrierFact(node)?.carrier)
            : transport(initializer);
        } else if (kind === KindIdentifier) {
          const declaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
          fact = transport(declaration);
        } else if (kind === "KindParameter" || kind === "KindPropertyDeclaration" || kind === "KindPropertySignature" ||
          kind === "KindPropertyAccessExpression" || kind === "KindElementAccessExpression") {
          fact = rustFutureValueForSourceStorage(walk.context.facts.getRuntimeCarrierFact(node)?.carrier);
        }
      }
      if (fact === undefined) {
        return undefined;
      }
      const carrier = walk.context.facts.get(node, rustRuntimeCarrierKey)?.carrier ??
        walk.context.facts.resolve(node, rustRuntimeCarrierKey)?.carrier;
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
      if (walk.context.ast.kindName(node) !== "KindAwaitExpression") return;
      const operand = Node_Expression(walk.context.ast, node);
      const operation = walk.context.facts.get(node, rustTargetOperationFactKey);
      const carrier = rustEffectiveValueCarrier(walk.context.facts, operand);
      if (operand === undefined || operation?.kind !== "await-op" || carrier === undefined) return;
      const knownFuture = resolve(operand);
      const awaiting = finalizeRustAwaitValueFact(carrier, operation.resultCarrier, leaf =>
        knownFuture !== undefined && rustFutureValueMatchesCarrier(knownFuture, leaf, walk.context.typeDefinitions)
          ? knownFuture : rustFutureValueForSourceStorage(leaf),
      (source, target) => selectRustSourceValueConversion(source, target, walk.context.typeDefinitions),
      walk.context.typeDefinitions);
      if (awaiting === undefined) {
        appendRustDiagnostic(walk, "RUST_AWAIT_VALUE_CONTRACT_NOT_PROVEN",
          "Await requires a closed native branch selection with exact future effects and result conversions.", node,
          ["target.capability=rust.async.await-value"]);
        return;
      }
      walk.context.facts.set(node, rustAwaitValueFactKey, awaiting, [{ message: "rust finalized native await branches" }]);
    };
    visit(sourceFile);
  }
}

export function recordThrowFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  const expression = Node_Expression(walk.context.ast, statement);
  if (expression === undefined) {
    return;
  }
  let carrier = resolveExpressionCarrier(walk, expression, sourceFile, undefined);
  let conversion = carrier === undefined ? undefined : selectRustProgramErrorConversion(carrier,
    undefined, walk.context.typeDefinitions);
  if (carrier !== undefined && conversion === undefined && !isRustProgramErrorCarrier(carrier)) {
    const closed = rustBroadSourceValueTargetType(walk.operationOptions.jsEnabled);
    if (selectRustSourceValueConversion(carrier, closed, walk.context.typeDefinitions) !== undefined &&
      reconcileRequiredCarrier(walk, expression, carrier, closed)) {
      carrier = closed;
      conversion = selectRustProgramErrorConversion(carrier, undefined, walk.context.typeDefinitions);
    }
  }
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
