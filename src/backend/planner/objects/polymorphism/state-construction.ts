import type { RustItem, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import { rustHiddenAttribute, rustListAttribute, rustWordAttribute } from "../../../target-ast/syntax/attributes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { ProjectClassStateLayer } from "./model.js";
import { rustProjectGenerics, rustProjectStateMarker, rustProjectStateType } from "./names.js";

export function planRustStateConstruction(
  layer: ProjectClassStateLayer,
  baseType: RustType | undefined,
  context: RustPlanContext,
): RustItem | undefined {
  const type = rustProjectStateType(layer.carrier, context);
  if (type?.kind !== "named") failRustPlannerInvariant("An admitted project state constructor requires its native state carrier.", layer.definition.declaration);
  const selected = context.input.program.records.projectStateConstruction.get(layer.definition);
  if (selected === undefined) failRustPlannerInvariant("An admitted project state constructor requires its sealed ABI and base-field identity.", layer.definition.declaration);
  const baseName = selected.baseName;
  const marker = rustProjectStateMarker(layer.definition, context);
  const parameters = [
    ...(baseType === undefined ? [] : [{ name: baseName, type: baseType, mutable: false }]),
    ...layer.fields.map(field => ({ name: field.targetName, type: field.storageType, mutable: false })),
  ];
  return { kind: "impl", target: type, generics: rustProjectGenerics(layer.definition, context),
    members: [{ kind: "function", name: "new", generics: emptyRustGenerics,
      visibility: selected.visibility, params: parameters, returnType: type,
      attrs: [rustHiddenAttribute, rustListAttribute("inline", [rustWordAttribute("always")])],
      body: { statements: [{ kind: "tail", expr: { kind: "struct-literal", path: type.path, fields: [
        ...parameters.map(parameter => ({ name: parameter.name, value: { kind: "path" as const, path: parameter.name } })),
        ...layer.methodProperties.map(property => ({ name: property.targetName, value: { kind: "none" as const } })),
        ...(marker === undefined ? [] : [{ name: marker.name, value: marker.value }]),
      ] } }] },
    }],
  };
}
