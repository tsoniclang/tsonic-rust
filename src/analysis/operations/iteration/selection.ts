import { selectRustPropertyKeyIterationLowering } from "../../../policy/operations/iteration/property-keys.js";
import { rustIterableTargetPolicy, selectRustIterationLowering } from "../../../policy/operations/iteration/index.js";
import type { RustOperationAnalysisContext } from "../../program/operation-context.js";

import { isRustStringCarrier } from "../../../target-model/types/index.js";
import { KindArrayLiteralExpression, KindCallExpression, KindNewExpression, KindNonNullExpression, KindParenthesizedExpression, KindSatisfiesExpression, Node_Expression } from "@tsonic/target-api/source";

import { rejectSelectedOperation } from "../members/result.js";
import { acceptRustOperation } from "../../program/records/operations/selected-operation-values.js";

import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";

import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";

import type { RustCheckedIterationSelectionInput, RustCheckedOperationSelectionResult, RustPolicySelection } from "../../../policy/model/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "../members/model.js";

import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { selectedRustForInKeys } from "./for-in-keys.js";

export function selectRustCheckedIteration(
  request: RustCheckedIterationSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const source = request.source;
  if (source.iterationKind === "for-in") {
    const iterable = rustEffectiveValueCarrier(context.records, request.expression) ??
      resolveRustTargetTypeRef(request.expression, context, options);
    const elementCarrier = resolveRustTargetTypeRef(source.sourceElementType, context, options);
    if (elementCarrier === undefined || !isRustStringCarrier(elementCarrier)) {
      return rejectSelectedOperation(
        request.statement,
        context,
        "RUST_ITERATION_KEY_CARRIER_UNSUPPORTED",
        "Rust property-key iteration requires the exact checked source key to map to String.",
      );
    }
    const lowering = rustPropertyKeyIterationLowering(iterable, request.expression, context, options);
    if (iterable === undefined || lowering === undefined) {
      return rejectSelectedOperation(
        request.statement,
        context,
        "RUST_ITERATION_CARRIER_UNSUPPORTED",
        "The selected Rust receiver carrier has no closed property-key iteration policy.",
      );
    }
    const fact: RustTargetOperationFact = {
      kind: "iteration",
      operationId: `tsonic.rust.iteration.for-in.${lowering.kind}`,
      iterationKind: "for-in",
      iterableCarrier: iterable,
      elementCarrier,
      lowering,
    };
    return acceptRustOperation(fact, {
      sourceExpression: request.expression,
      sourceResultType: source.sourceElementType,
    }, elementCarrier);
  }
  const iterable = rustEffectiveValueCarrier(context.records, request.expression) ??
    resolveRustTargetTypeRef(request.expression, context, options);
  const targetIteration = rustIterableTargetPolicy(iterable, context.typeDefinitions);
  if (targetIteration === undefined) {
    return rejectSelectedOperation(
      request.statement,
      context,
      "RUST_ITERATION_CARRIER_UNSUPPORTED",
      `Selected ${source.iterationKind} iteration receiver is not a finalized supported Rust iterable carrier.`,
    );
  }
  const lowering = selectRustIterationLowering(
    source,
    targetIteration,
    isFreshRustIterationValue(request.expression, context.ast),
  );
  if (lowering === undefined) {
    return rejectSelectedOperation(
      request.statement,
      context,
      "RUST_ITERATION_MECHANISM_UNSUPPORTED",
      `Selected ${source.iterationKind} mechanism is incompatible with the finalized Rust iterable carrier.`,
    );
  }
  const fact: RustTargetOperationFact = {
    kind: "iteration",
    operationId: `tsonic.rust.iteration.${source.iterationKind}.${lowering.kind}${lowering.kind === "receiver-method" ? `.${lowering.name}` : ""}`,
    iterationKind: source.iterationKind,
    elementCarrier: targetIteration.elementCarrier,
    lowering,
  };
  return acceptRustOperation(fact, {
    sourceExpression: request.expression,
    sourceResultType: source.sourceElementType,
  }, targetIteration.elementCarrier);
}

type RustPropertyKeyIterationLowering = Extract<
  RustTargetOperationFact,
  { readonly kind: "iteration"; readonly iterationKind: "for-in" }
>["lowering"];

function rustPropertyKeyIterationLowering(
  iterable: TargetTypeRef | undefined,
  expression: Node,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPropertyKeyIterationLowering | undefined {
  const selected = selectRustPropertyKeyIterationLowering(iterable);
  if (selected !== undefined) return selected;
  const keys = iterable === undefined
    ? undefined
    : selectedRustForInKeys(expression, iterable, context, options);
  return keys === undefined ? undefined : { kind: "static-keys", keys };
}

function isFreshRustIterationValue(
  expression: Node,
  ast: import("@tsonic/tsts").AstReader,
): boolean {
  const kind = ast.kindName(expression);
  if (kind === KindCallExpression || kind === KindNewExpression || kind === KindArrayLiteralExpression) {
    return true;
  }
  if (kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
    kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
    kind !== "KindTypeAssertionExpression" && kind !== "KindAwaitExpression") {
    return false;
  }
  const inner = Node_Expression(ast, expression);
  return inner !== undefined && isFreshRustIterationValue(inner, ast);
}
