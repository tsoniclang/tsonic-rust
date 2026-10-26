import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { requireRustReadOwnership } from "./typed-locations.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustFlowReadProjectionFact } from "../../../target-model/records/value-projections.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustProjectProjection } from "../objects/project-downcasts.js";
import { planRustClosedNativeProjection } from "../objects/closed-native-values.js";
import { planRustProgramErrorFlowRead } from "./error-operations.js";
import { rustCarrierHasCloneContract, rustCarrierHasCopyContract } from "../types/generic-requirements.js";
import { planRustOptionalStorageOperation } from "./optional-storage.js";
import { planRustUnionMapping, planRustUnionProjection } from "./union-mappings.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";

export function planRustFlowReadProjection(node: Node, expression: RustExpr, fact: RustFlowReadProjectionFact,
  context: RustPlanContext, borrowedResult = false): RustExpr {
  const override = context.flowReadOverrides?.get(node);
  if (override !== undefined) {
    if (!rustTargetTypeRefEquals(override.sourceCarrier, fact.sourceCarrier) || !rustTargetTypeRefEquals(override.selectedCarrier, fact.selectedCarrier))
      failRustPlannerInvariant("An admitted branch-local flow read requires its exact source and selected carrier correspondence.", node);
    return override.expression;
  }
  const ownership = borrowedResult ? "borrow" : requireRustReadOwnership(node, context).value.kind;
  return planRustValueProjection(node, expression, fact, context,
    ownership === "move" || ownership === "borrow" ? ownership : "clone");
}

export function planRustValueProjection(node: Node, expression: RustExpr, fact: RustFlowReadProjectionFact,
  context: RustPlanContext, ownership: "move" | "clone" | "borrow"): RustExpr {
  const selected = context.input.program.records.flowReadEmission.get(fact)
    ?? failRustPlannerInvariant("An admitted value projection requires its sealed native emission.", node);
  const ownsValue = ownership === "move";
  const borrowedResult = ownership === "borrow";
  if (selected.kind === "identity") return ownsValue || borrowedResult ? expression
    : { kind: "method-call", receiver: expression, method: "clone", args: [] };
  if (selected.kind === "builtin-error") {
    if (selected.source === "closed") {
      const native: RustExpr = ownsValue ? { kind: "method-call", receiver: { kind: "method-call", receiver: expression, method: "into_error", args: [] },
        method: "expect", args: [{ kind: "str-literal", value: "exact checked flow selected a non-Error payload" }] }
        : { kind: "method-call", receiver: expression, method: "error_value", args: [] };
      const admitted: RustExpr = selected.writable ? { kind: "method-call", receiver: { kind: "call", path: "rt::WritableRetainedError::try_from", args: [native] },
        method: "expect", args: [{ kind: "str-literal", value: "exact writable Error origin has no retained setter owner" }] } : native;
      if (selected.target === "source") return { kind: "call", path: selected.writable ? "rt::WritableSourceError::from" : "rt::SourceError::from", args: [admitted] };
      if (selected.target === "retained") return admitted;
      failRustPlannerInvariant("An admitted closed Error projection requires its native retained payload target.", node);
    }
    if (selected.source === "program" && rustCurrentErrorBoundary(context)?.errorDomain === "runtime") {
      if (!selected.runtimeReadonly) failRustPlannerInvariant("An admitted runtime Error projection requires its readonly native Error target.", node);
      return { kind: "method-call", receiver: expression, method: "error_value", args: [] };
    }
    if (selected.target === "source") {
      const transport: RustExpr = ownsValue && selected.source === "source" ? { kind: "method-call", receiver: expression, method: "into_transport", args: [] } : expression;
      const projected: RustExpr = ownsValue && selected.writable && selected.source === "retained"
        ? { kind: "method-call", receiver: { kind: "call", path: "rt::WritableRetainedError::try_from", args: [transport] },
            method: "map", args: [{ kind: "path", path: "rt::WritableSourceError::from" }] }
        : ownsValue ? { kind: "call", path: selected.writable ? "rt::WritableSourceError::try_from" : "rt::SourceError::try_from", args: [transport] }
        : { kind: "method-call", receiver: expression, method: selected.writable ? "writable_source_error_value" : "source_error_value", args: [] };
      const recovered: RustExpr = { kind: "method-call", receiver: projected, method: "expect",
        args: [{ kind: "str-literal", value: "exact checked flow selected an Error outside its sealed admitted variants" }] };
      return selected.source === "retained" && !ownsValue ? { kind: "call", path: selected.writable ? "rt::WritableSourceError::from" : "rt::SourceError::from", args: [recovered] } : recovered;
    }
    return { kind: "method-call", receiver: { kind: "method-call", receiver: expression,
      method: selected.mutable ? "mutable_error_value" : "native_error_value", args: [] }, method: "expect",
      args: [{ kind: "str-literal", value: "exact checked flow selected a nonnative Error" }] };
  }
  if (selected.kind === "union-map") return bindSubject(planRustUnionMapping(node, expression, selected.mapping, ownsValue, context), node, context);
  if (selected.kind === "union") {
    if (fact.kind !== "source-union" && fact.kind !== "runtime-union") failRustPlannerInvariant("An admitted native union projection requires its source projection payload.", node);
    const result = planRustUnionProjection(node, expression, selected.projection,
      ownsValue ? "move" : fact.project !== undefined || borrowedResult ? "shared-reference" : "clone", context);
    if (fact.project === undefined) return bindSubject(result, node, context);
    const projected = planRustProjectProjection(node, result.arms[0]!.expression, fact.project, context, ownsValue ? "owned" : "borrowed")
      ?? failRustPlannerInvariant("An admitted union projection requires its native project payload projection.", node);
    return bindSubject({ ...result, arms: [{ ...result.arms[0]!, expression: projected }, ...result.arms.slice(1)] }, node, context);
  }
  if (selected.kind === "option") {
    if (selected.custom) return planRustOptionalStorageOperation(fact.sourceCarrier, ownsValue ? "into_present" : "clone_present",
      [ownsValue ? expression : { kind: "reference", expr: expression }], context)
      ?? failRustPlannerInvariant("An admitted optional flow read requires its native presence operation.", node);
    if (ownsValue) return { kind: "method-call", receiver: expression, method: "unwrap_or_else", args: [{
      kind: "closure", params: [], body: { kind: "unreachable", message: "checked flow selected a missing optional value" },
    }] };
    if (!selected.reborrow && !borrowedResult && !rustCarrierHasCloneContract(fact.selectedCarrier, context))
      failRustPlannerInvariant("An admitted optional flow read requires its native non-consuming payload contract.", node);
    const name = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []), "flow_value");
    const readonlyReference = !selected.reborrow && !borrowedResult && selected.readonlyReference;
    const value: RustExpr = { kind: "path", path: name };
    return bindSubject({ kind: "match", expression: readonlyReference ? expression : {
      kind: "method-call", receiver: expression, method: selected.reborrow ? "as_deref_mut" : "as_ref",
      receiverMode: selected.reborrow ? "mut-ref" : "ref", args: [] }, arms: [
        { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name }] },
          expression: selected.reborrow || borrowedResult || readonlyReference ? value
            : rustCarrierHasCopyContract(fact.selectedCarrier, context) ? { kind: "dereference", pointer: value }
            : { kind: "method-call", receiver: value, method: "clone", args: [] } },
        { pattern: { kind: "path", path: "None" }, expression: { kind: "unreachable", message: "checked flow selected a missing optional value" } },
      ] }, node, context);
  }
  if (selected.kind === "closed-native") {
    if (fact.kind !== "closed-native") failRustPlannerInvariant("An admitted closed-native projection requires its source payload.", node);
    const projected = planRustClosedNativeProjection(node, expression, fact, context)
      ?? failRustPlannerInvariant("An admitted closed-native projection requires its native owner projection.", node);
    const name = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []), "native_owner");
    const recovered = projected.recover({ kind: "path", path: name })
      ?? failRustPlannerInvariant("An admitted closed-native projection requires its native payload recovery.", node);
    return rustValueBlock([{ name, value: { kind: "method-call", receiver: projected.expression, method: "expect",
      args: [{ kind: "str-literal", value: "checked flow selected a different native nominal owner" }] } }], recovered);
  }
  if (selected.kind === "program-error-variant") {
    if (fact.kind !== "program-error-variant") failRustPlannerInvariant("An admitted Error projection requires its sealed native variant.", node);
    return planRustProgramErrorFlowRead(node, expression, fact, context, ownsValue)
      ?? failRustPlannerInvariant("An admitted Error projection requires its native payload read.", node);
  }
  if (fact.kind !== "project-downcast") failRustPlannerInvariant("An admitted project projection requires its source projection payload.", node);
  return planRustProjectProjection(node, expression, { sourceCarrier: fact.sourceCarrier, dispatchCarrier: fact.dispatchCarrier,
    targetCarrier: fact.selectedCarrier, projection: fact.projection }, context, ownsValue ? "owned" : "borrowed")
    ?? failRustPlannerInvariant("An admitted project projection requires its native payload read.", node);
}

// A match evaluates its subject once, and temporaries in the subject live until the match ends, so a plain subject
// stays in place (a `let` would free a borrowed temporary such as `x.clone().as_ref()` too early, E0716). Only a
// statement-bearing subject this planner built (an evaluate-then or a block with statements) is moved out: under
// Rust 2021 by an expected-lint value block that keeps the match temporary scope, otherwise into a binding.
function bindSubject(expression: RustExpr, node: Node, context: RustPlanContext): RustExpr {
  if (expression.kind !== "match") failRustPlannerInvariant("An admitted native flow dispatch requires its selected match form.", node);
  const subject = expression.expression;
  if (subject.kind !== "evaluate-then" &&
    (subject.kind !== "block" || subject.body.statements.every(statement => statement.kind === "tail"))) return expression;
  if (context.input.program.records.programEmission.get()?.configuration.edition === "2021")
    return rustValueBlock([], expression, { value: [rustLintAttributes.matchTemporaryScope] });
  const name = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []), "flow_input");
  return rustValueBlock([{ name, value: expression.expression }], { ...expression, expression: { kind: "path", path: name } });
}
