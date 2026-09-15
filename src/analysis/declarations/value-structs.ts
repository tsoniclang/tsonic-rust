import { fieldFactKey, structFactKey } from "@tsonic/tsts";
import type { Node } from "@tsonic/tsts";
import { Node_Initializer } from "@tsonic/target-api/source";
import { rustCompileTimeSourceKey } from "../../target-model/facts/source-declarations.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import type { RustFactWalk } from "../program/walk.js";

export function recordRustValueStructDeclaration(walk: RustFactWalk, node: Node): boolean {
  const { ast, facts } = walk.context;
  if (!ast.is.IsVariableDeclaration(node)) return false;
  const source = facts.get(node, structFactKey);
  if (source === undefined) return false;
  const initializer = Node_Initializer(ast, node);
  const call = initializer === undefined ? undefined : ast.as.AsCallExpression(initializer);
  const arguments_ = call?.Arguments?.Nodes;
  const shape = arguments_?.length === 1 ? ast.as.AsObjectLiteralExpression(arguments_[0]) : undefined;
  const properties = shape?.Properties?.Nodes;
  const selectedFields = properties?.map(property => property === undefined || !ast.is.IsPropertyAssignment(property)
    ? undefined : facts.get(property, fieldFactKey) ?? facts.get(Node_Initializer(ast, property), fieldFactKey));
  if (initializer === undefined || facts.get(initializer, structFactKey) === undefined || source.valueType !== true ||
    source.fields === undefined || selectedFields === undefined || selectedFields.length !== source.fields.length ||
    selectedFields.some((field, index) => field === undefined || field.name !== source.fields![index]!.name ||
      field.type !== source.fields![index]!.type || field.readonly !== source.fields![index]!.readonly)) {
    appendRustDiagnostic(walk, "RUST_VALUE_STRUCT_FIELDS_NOT_CLOSED",
      "A value struct requires its exact selected field-marker assignments; unproved runtime expressions cannot be erased.", node, []);
    return true;
  }
  const carrier = resolveRustTargetTypeRef(node, rustResolutionContext(walk, node), walk.operationOptions);
  if (carrier === undefined || rustStructuralObjectCarrierValue(carrier)?.representation !== "value" ||
    !walk.sourceTypes.registerRepresentationAlias(node, carrier) || setCarrierFact(walk, node, carrier) === undefined ||
    setCarrierFact(walk, initializer, carrier) === undefined) {
    appendRustDiagnostic(walk, "RUST_VALUE_STRUCT_CARRIER_NOT_CLOSED",
      "A value struct requires one exact native record carrier for its selected fields.", node, []);
    return true;
  }
  facts.set(node, rustCompileTimeSourceKey, true);
  facts.set(initializer, rustCompileTimeSourceKey, true);
  return true;
}
