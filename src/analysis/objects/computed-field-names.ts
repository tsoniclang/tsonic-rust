import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";
import type { SourcePropertyNameSelection } from "@tsonic/target-api/source";

export function rustNativePropertyNameIssue(
  sourceNode: Node,
  selection: SourcePropertyNameSelection,
): TargetDiagnostic | undefined {
  if (selection.kind !== "rejected" && selection.kind !== "unique-symbol") return undefined;
  return Object.freeze({
    code: selection.kind === "rejected" && selection.failure === "resource"
      ? "RUST_ENUM_CONSTANT_RESOURCE_LIMIT" : "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN",
    category: "error",
    source: "tsonic-rust",
    sourceNode,
    message: selection.kind === "rejected" ? selection.reason
      : "A unique-symbol property can describe an erased type contract but has no static native named-field representation.",
  });
}

import type { RustFactWalk } from "../program/walk.js";

export function rustRecordPropertySourceName(walk: RustFactWalk, name: Node | undefined): string | undefined {
  if (name === undefined) return undefined;
  const { ast } = walk.context;
  if (!ast.is.IsComputedPropertyName(name) && !ast.is.IsNumericLiteral(name)) return ast.text(name);
  const selected = walk.context.semanticsFor(name).propertyNames.get(name);
  return selected?.kind === "resolved" ? selected.name : undefined;
}
