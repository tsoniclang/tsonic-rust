import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustEmptyObjectTargetId } from "../../../target-model/types/index.js";
import { rustEmptyRecordConversionMatches, type RustEmptyRecordConversion } from "../../../target-model/conversions/empty-record.js";
import { createRustStructuralObjectFromCarrier } from "../objects/project-storage.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";

export function planRustEmptyRecordConversion(
  conversion: RustEmptyRecordConversion,
  expression: RustExpr,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!rustEmptyRecordConversionMatches(conversion, conversion.source, conversion.target)) return undefined;
  const value: RustExpr | undefined = conversion.target.kind === "target-named" &&
      conversion.target.id === rustEmptyObjectTargetId
    ? { kind: "call", path: "tsonic_rust_runtime::EmptyObject::new", args: [] }
    : createRustStructuralObjectFromCarrier(conversion.target, [], context);
  if (value === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames ??
    createRustSyntheticNameState(context.input.program.source.ast, node, []), "_empty_record_source");
  return { kind: "block", bindings: [{ name, value: expression }], value };
}
