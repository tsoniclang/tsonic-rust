import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustOptionalStorageOperation } from "./optional-storage.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustTypeEquals } from "../../target-ast/syntax/type-equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planRustOptionBranch(option: RustExpr, carrier: TargetTypeRef, presentName: string,
  present: RustExpr, absent: RustExpr, context: RustPlanContext): RustExpr {
  const storage = context.input.program.records.typeEmission.get(carrier)?.optionalStorage;
  if (storage?.kind === "option") {
    // The pre-rewrite Option forms: a branch that rebuilds the same Option is the Option itself, and a present
    // value with a constant fallback is unwrap_or_default / unwrap_or (clippy::manual_unwrap_or and friends). The
    // checks read only the two arms this function receives.
    if (present.kind === "call" && present.path === "Some" && (present.genericArguments?.length ?? 0) === 0 &&
      present.args.length === 1 && present.args[0]?.kind === "path" && present.args[0].path === presentName &&
      (absent.kind === "none" || absent.kind === "associated-value" && absent.name === "None" && absent.trait === undefined &&
        rustTypeEquals(absent.owner, rustTypeFromCarrierInContext(carrier, context)))) return option;
    if (present.kind === "path" && present.path === presentName) {
      if (isNativeDefaultLiteral(absent)) return { kind: "method-call", receiver: option, method: "unwrap_or_default", args: [] };
      if (isConstantLiteral(absent)) return { kind: "method-call", receiver: option, method: "unwrap_or", args: [absent] };
    }
    // A statement-bearing subject is bound first: a block as match scrutinee is clippy::blocks_in_conditions.
    const inputName = option.kind === "block" && context.syntheticNames !== undefined
      ? allocateRustSyntheticName(context.syntheticNames, "optional_input") : undefined;
    const branch: RustExpr = { kind: "match", expression: inputName === undefined ? option : { kind: "path", path: inputName }, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: presentName }] }, expression: present },
      { pattern: { kind: "path", path: "None" }, expression: absent },
    ] };
    return inputName === undefined ? branch : rustValueBlock([{ name: inputName, value: option }], branch);
  }
  if (storage?.kind !== "custom" || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted optional branch requires its native storage and name scope.", context.callableDeclaration ?? context.sourceFile);
  const storedName = allocateRustSyntheticName(context.syntheticNames, "optional_storage");
  const stored: RustExpr = { kind: "path", path: storedName };
  return rustValueBlock([{ name: storedName, value: option }], {
    kind: "conditional",
    condition: planRustOptionalStorageOperation(carrier, "is_absent", [{ kind: "reference", expr: stored }], context),
    whenTrue: absent,
    whenFalse: rustValueBlock([{ name: presentName, value: planRustOptionalStorageOperation(carrier, "into_present", [stored], context) }], present),
  });
}

// The pre-rewrite literal rules (target-ast/inspection/literal-defaults.ts): a literal equal to its type's Default
// value, and a literal whose eager evaluation has no effect or allocation.
function isNativeDefaultLiteral(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "string-literal":
    case "str-literal": return expression.value === "";
    case "int-literal": return expression.text === "0";
    case "float-literal": return expression.text === "0" || expression.text === "0.0";
    case "bool-literal": return expression.value === false;
    case "char-literal": return expression.value === "\0";
    case "tuple-literal": return expression.elements.length === 0;
    case "none": return true;
    default: return false;
  }
}

function isConstantLiteral(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "char-literal":
    case "str-literal":
    case "none": return true;
    case "unary": return isConstantLiteral(expression.operand);
    case "numeric-cast": return isConstantLiteral(expression.expression);
    case "tuple-literal": return expression.elements.every(isConstantLiteral);
    default: return false;
  }
}
