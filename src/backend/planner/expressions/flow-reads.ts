import { rustValueBlock } from "../../target-ast/value-block.js";
import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustFlowReadProjectionMatches } from "../../../analysis/facts/flow-read-projections.js";
import { rustUnionProjectionContract } from "../../../target-model/types/union-relations.js";
import {
  isRustCopyCarrier,
  isRustProgramErrorCarrier,
  rustJsErrorTargetType,
  rustCarrierSupportsClone,
  rustOptionElementCarrier,
} from "../../../target-model/types/index.js";
import type { RustFlowReadProjectionFact } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, rustCurrentErrorBoundary } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustProjectProjection } from "../objects/project-downcasts.js";
import { planRustClosedNativeProjection } from "../objects/closed-native-values.js";
import { planRustProgramErrorFlowRead } from "./error-operations.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import { planRustOptionalStorageOperation } from "./optional-storage.js";
import { planRustUnionMapping, planRustUnionProjection } from "./union-mappings.js";
import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustWritableSourceErrorCarrier,
  isRustRetainedErrorCarrier, isRustWritableRetainedErrorCarrier } from "../../../target-model/types/carriers/source-error.js";
import { isRustClosedValueCarrier } from "../../../target-model/types/carriers/closed-value-kind.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";

export function planRustFlowReadProjection(
  node: Node,
  expression: RustExpr,
  fact: RustFlowReadProjectionFact,
  context: RustPlanContext,
  borrowedResult = false,
): RustExpr | undefined {
  const sourceCarrier = context.expressionOverrides?.get(node)?.carrier ??
    context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
  if (sourceCarrier === undefined ||
    !rustTargetTypeRefEquals(sourceCarrier, fact.sourceCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.flow-read-source",
      "The finalized flow-read projection conflicts with the expression's raw Rust carrier.",
    ));
    return undefined;
  }
  const override = context.flowReadOverrides?.get(node);
  if (override !== undefined) {
    if (!rustTargetTypeRefEquals(override.sourceCarrier, fact.sourceCarrier) ||
      !rustTargetTypeRefEquals(override.selectedCarrier, fact.selectedCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.flow-read-override",
        "The exact branch-local flow-read selection conflicts with finalized source evidence.",
      ));
      return undefined;
    }
    return override.expression;
  }
  return planRustValueProjection(node, expression, fact, context,
    borrowedResult ? "borrow" : context.input.program.valueLifetimes.canMove(node) ? "move" : "clone");
}

export function planRustValueProjection(
  node: Node,
  expression: RustExpr,
  fact: RustFlowReadProjectionFact,
  context: RustPlanContext,
  ownership: "move" | "clone" | "borrow",
): RustExpr | undefined {
  if (!rustFlowReadProjectionMatches(fact, context.input.program.projectTypes,
    context.input.program.typeDefinitions)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.value-projection", "Value projection conflicts with its exact sealed native carrier relation."));
    return undefined;
  }
  const ownsValue = ownership === "move";
  const borrowedResult = ownership === "borrow";
  if (fact.kind === "builtin-error") {
    const exactSource = ownsValue ? expression : planRustNonConsumingValue(node, expression, context);
    if (isRustClosedValueCarrier(fact.sourceCarrier)) {
      const native: RustExpr = ownsValue ? { kind: "method-call", receiver: {
        kind: "method-call", receiver: exactSource, method: "into_error", args: [],
      }, method: "expect", args: [{ kind: "str-literal", value: "exact checked flow selected a non-Error payload" }] }
        : { kind: "method-call", receiver: exactSource, method: "error_value", args: [] };
      const writable = isRustWritableSourceErrorCarrier(fact.selectedCarrier) || isRustWritableRetainedErrorCarrier(fact.selectedCarrier);
      const admitted: RustExpr = writable ? { kind: "method-call", receiver: {
        kind: "call", path: "rt::WritableRetainedError::try_from", args: [native],
      }, method: "expect", args: [{ kind: "str-literal", value: "exact writable Error origin has no retained setter owner" }] } : native;
      if (isRustSourceErrorCarrier(fact.selectedCarrier)) {
        return { kind: "call", path: writable ? "rt::WritableSourceError::from" : "rt::SourceError::from", args: [admitted] };
      }
      if (isRustRetainedErrorCarrier(fact.selectedCarrier)) return admitted;
      return undefined;
    }
    if (isRustProgramErrorCarrier(fact.sourceCarrier) && rustCurrentErrorBoundary(context)?.errorDomain === "runtime") {
      if (!rustTargetTypeRefEquals(fact.selectedCarrier, rustJsErrorTargetType())) {
        context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
          "rust.backend.runtime-error-projection", "Runtime Error projection requires its exact native readonly Error carrier."));
        return undefined;
      }
      return { kind: "method-call", receiver: exactSource, method: "error_value", args: [] };
    }
    if (isRustSourceErrorCarrier(fact.selectedCarrier)) {
      const writable = isRustWritableSourceErrorCarrier(fact.selectedCarrier);
      const transport: RustExpr = ownsValue && isRustSourceErrorCarrier(fact.sourceCarrier)
        ? { kind: "method-call", receiver: exactSource, method: "into_transport", args: [] } : exactSource;
      const selected: RustExpr = ownsValue && writable && isRustRetainedErrorCarrier(fact.sourceCarrier)
        ? { kind: "method-call", receiver: { kind: "call", path: "rt::WritableRetainedError::try_from", args: [transport] },
          method: "map", args: [{ kind: "path", path: "rt::WritableSourceError::from" }] }
        : ownsValue
        ? { kind: "call", path: writable ? "rt::WritableSourceError::try_from" : "rt::SourceError::try_from", args: [transport] }
        : { kind: "method-call", receiver: exactSource, method: writable ? "writable_source_error_value" : "source_error_value", args: [] };
      const recovered: RustExpr = { kind: "method-call", receiver: selected, method: "expect",
        args: [{ kind: "str-literal", value: "exact checked flow selected an Error outside its sealed admitted variants" }] };
      return isRustRetainedErrorCarrier(fact.sourceCarrier) && !ownsValue ? {
        kind: "call", path: writable ? "rt::WritableSourceError::from" : "rt::SourceError::from", args: [recovered],
      } : recovered;
    }
    return { kind: "method-call", receiver: { kind: "method-call", receiver: exactSource,
      method: isRustMutableJsErrorCarrier(fact.selectedCarrier) ? "mutable_error_value" : "native_error_value", args: [] }, method: "expect",
      args: [{ kind: "str-literal", value: "exact checked flow selected a nonnative Error" }] };
  }
  if (fact.kind === "union-map") {
    const sourceElement = rustOptionElementCarrier(fact.sourceCarrier);
    const targetElement = rustOptionElementCarrier(fact.selectedCarrier);
    const result = !rustTargetTypeRefEquals(sourceElement ?? fact.sourceCarrier, fact.dispatchCarrier) ? undefined
      : planRustUnionMapping(node, expression, fact.dispatchCarrier, targetElement ?? fact.selectedCarrier,
        fact.arms, "target", ownsValue, sourceElement !== undefined, targetElement !== undefined, context);
    if (result?.kind === "match") return bindRustFlowMatchSubject(result, node, context);
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.union-map", "Union flow projection requires exact sealed arm and absence correspondence."));
    return undefined;
  }
  if (fact.kind === "source-union" || fact.kind === "runtime-union") {
    const definitions = context.input.program.typeDefinitions;
    const payloadCarrier = fact.project?.sourceCarrier ?? fact.selectedCarrier;
    const selected = rustUnionProjectionContract(fact.sourceCarrier, payloadCarrier, definitions);
    const kindMatches = (definitions.sourceUnionVariants(fact.dispatchCarrier) !== undefined) === (fact.kind === "source-union");
    const result = selected === undefined || !kindMatches || selected.variant.name !== fact.variant ||
      !rustTargetTypeRefEquals(selected.dispatchCarrier, fact.dispatchCarrier) ? undefined
        : planRustUnionProjection(node, expression, fact.sourceCarrier, payloadCarrier,
          ownsValue ? "move" : fact.project !== undefined || borrowedResult ? "shared-reference" : "clone", context);
    if (result === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.source-union-projection", "The selected union payload has no exact non-consuming projection."));
      return undefined;
    }
    if (fact.project !== undefined) {
      if (!rustTargetTypeRefEquals(fact.project.targetCarrier, fact.selectedCarrier) ||
        !rustTargetTypeRefEquals(fact.project.sourceCarrier, fact.project.dispatchCarrier)) {
        context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
          "rust.backend.source-union-projection", "Union payload refinement conflicts with its exact selected carrier."));
        return undefined;
      }
      const projected = planRustProjectProjection(node, result.arms[0]!.expression, fact.project, context,
        ownsValue ? "owned" : "borrowed");
      if (projected === undefined) return undefined;
      return bindRustFlowMatchSubject({ ...result, arms: [{ ...result.arms[0]!, expression: projected }, ...result.arms.slice(1)] }, node, context);
    }
    return bindRustFlowMatchSubject(result, node, context);
  }
  if (fact.kind === "option-value" || fact.kind === "option-reference") {
    const reborrow = fact.kind === "option-reference";
    if (reborrow && (fact.selectedCarrier.kind !== "reference" || !fact.selectedCarrier.mutable ||
      !rustTargetTypeRefEquals(rustOptionElementCarrier(fact.sourceCarrier), fact.selectedCarrier))) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.flow-read-reference", "An optional exclusive-reference projection requires the exact native reference payload."));
      return undefined;
    }
    if (rustOptionalStorageValue(fact.sourceCarrier) !== undefined) {
      return planRustOptionalStorageOperation(fact.sourceCarrier, ownsValue ? "into_present" : "clone_present",
        [ownsValue ? expression : { kind: "reference", expr: expression }], context);
    }
    if (!ownsValue && !reborrow && !borrowedResult && !rustCarrierSupportsClone(fact.selectedCarrier, context.input.program.typeDefinitions) &&
      (context.callableDeclaration === undefined ||
        !requireRustCarrierRequirements(fact.selectedCarrier, ["clone"], node, context))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.flow-read-projection-clone",
        "A narrowed optional Rust value requires a selected carrier with a proven non-consuming clone contract.",
      ));
      return undefined;
    }
    const valueName = allocateRustSyntheticName(
      context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
      "flow_value",
    );
    const readonlyReference = !ownsValue && !reborrow && !borrowedResult &&
      fact.selectedCarrier.kind === "reference" && !fact.selectedCarrier.mutable;
    return bindRustFlowMatchSubject({
      kind: "match",
      expression: ownsValue || readonlyReference ? expression : {
        kind: "method-call",
        receiver: expression,
        method: reborrow ? "as_deref_mut" : "as_ref",
        receiverMode: reborrow ? "mut-ref" : "ref",
        args: [],
      },
      arms: [
        {
          pattern: {
            kind: "tuple-variant",
            path: "Some",
            elements: [{ kind: "binding", name: valueName }],
          },
          expression: ownsValue || reborrow || borrowedResult || readonlyReference
            ? { kind: "path", path: valueName } : isRustCopyCarrier(fact.selectedCarrier)
            ? {
                kind: "dereference",
                pointer: { kind: "path", path: valueName },
              }
            : {
                kind: "method-call",
                receiver: { kind: "path", path: valueName },
                method: "clone",
                args: [],
              },
        },
        {
          pattern: { kind: "path", path: "None" },
          expression: {
            kind: "unreachable",
            message: "checked flow selected a missing optional value",
          },
        },
      ],
    }, node, context);
  }
  if (fact.kind === "closed-native") {
    const selected = planRustClosedNativeProjection(node, expression, fact, context);
    if (selected === undefined) return undefined;
    const name = allocateRustSyntheticName(context.syntheticNames ??
      createRustSyntheticNameState(context.input.program.source.ast, node, []), "native_owner");
    const recovered = selected.recover({ kind: "path", path: name });
    return recovered === undefined ? undefined : rustValueBlock([{ name, value: {
      kind: "method-call", receiver: selected.expression, method: "expect",
      args: [{ kind: "str-literal", value: "checked flow selected a different native nominal owner" }],
    } }], recovered);
  }
  if (fact.kind === "program-error-variant") {
    return planRustProgramErrorFlowRead(node, expression, fact, context, ownsValue);
  }
  return planRustProjectProjection(
    node,
    expression,
    { sourceCarrier: fact.sourceCarrier, dispatchCarrier: fact.dispatchCarrier,
      targetCarrier: fact.selectedCarrier, projection: fact.projection },
    context,
    ownsValue ? "owned" : "borrowed",
  );
}

function bindRustFlowMatchSubject(
  expression: Extract<RustExpr, { readonly kind: "match" }>,
  node: Node,
  context: RustPlanContext,
): RustExpr {
  if (expression.expression.kind !== "evaluate-then" &&
    (expression.expression.kind !== "block" || expression.expression.body.statements.every(statement => statement.kind === "tail"))) {
    return expression;
  }
  if (context.input.program.configuration.edition === "2021") {
    return rustValueBlock([], expression, { value: [rustLintAttributes.matchTemporaryScope] });
  }
  const name = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
    "flow_input",
  );
  return rustValueBlock([{ name, value: expression.expression }], { ...expression, expression: { kind: "path", path: name } });
}
