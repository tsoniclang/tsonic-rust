import type { Node, SourceFile } from "@tsonic/tsts";
import { ObjectLiteralProperty_Value } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustJsValueTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import { resolveExpressionCarrier } from "./carriers.js";

export function resolveRustClosedRecordLiteral(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef,
  properties: readonly Node[],
): { readonly kind: "not-applicable" } | { readonly kind: "selected"; readonly carrier: TargetTypeRef | undefined } {
  const carrier = rustJsValueTargetType();
  const { ast } = walk.context;
  if (!rustTargetTypeRefEquals(expected, carrier) || properties.length === 0 || properties.some(property =>
    !ast.is.IsPropertyAssignment(property) && !ast.is.IsShorthandPropertyAssignment(property))) {
    return { kind: "not-applicable" };
  }
  const fields: { readonly property: Node; readonly expression: Node; readonly sourceName: string }[] = [];
  const names = new Set<string>();
  for (const property of properties) {
    const name = ast.name(property);
    const sourceName = name === undefined ? "" : ast.text(name);
    const value = ObjectLiteralProperty_Value(ast, property);
    if (name === undefined || ast.is.IsComputedPropertyName(name) || names.has(sourceName) || value === undefined) {
      appendRustDiagnostic(walk, "RUST_CLOSED_RECORD_EVIDENCE_MISSING",
        "A closed record requires exact ordered authored data-property evidence.", property,
        ["target.capability=rust.closed-record.authored-construction"]);
      return { kind: "selected", carrier: undefined };
    }
    if (resolveExpressionCarrier(walk, value, sourceFile, carrier) === undefined) {
      return { kind: "selected", carrier: undefined };
    }
    names.add(sourceName);
    fields.push({ property, expression: value, sourceName });
  }
  setRustOperationFact(walk, expression, {
    kind: "closed-record-literal", operationId: "tsonic.rust.record.closed-literal",
    resultCarrier: carrier, fields,
  });
  return { kind: "selected", carrier: setCarrierFact(walk, expression, carrier) };
}
