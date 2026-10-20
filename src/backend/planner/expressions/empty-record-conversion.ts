import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustEmptyRecordConversion } from "../../../target-model/conversions/empty-record.js";
import { createRustStructuralObjectFromCarrier } from "../objects/project-storage.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../../invariants.js";

export function planRustEmptyRecordConversion(
  conversion: RustEmptyRecordConversion,
  expression: RustExpr,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.typeEmission.get(conversion.target)?.emptyRecord;
  if (selected === undefined) failRustPlannerInvariant("An admitted empty-record conversion requires its selected native construction.", node);
  const value: RustExpr | undefined = selected === "native-empty"
    ? { kind: "call", path: "tsonic_rust_runtime::EmptyObject::new", args: [] }
    : createRustStructuralObjectFromCarrier(conversion.target, [], context);
  if (value === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted empty record requires its native value and hygienic binding.", node);
  const name = allocateRustSyntheticName(context.syntheticNames, "_empty_record_source");
  return rustValueBlock([{ name, value: expression }], value);
}
