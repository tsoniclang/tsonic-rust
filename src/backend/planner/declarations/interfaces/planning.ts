import { rustDeriveAttributes, rustHiddenAttribute } from "../../../target-ast/syntax/attributes.js";
import { diagnosticInput, rustProjectTypeHasPublicImplementationAbi } from "../../program/plan-context.js";
import { rustAuthoredFieldDeadCodeDisposition, rustGeneratedProjectInterfaceFieldDeadCodeDisposition, rustProjectInterfaceDeadCodeDisposition } from "../../program/reachability-directives.js";
import { failRustPlannerInvariant, missingFactDiagnostic } from "../../diagnostics.js";
import { rustProjectObjectStateField } from "../../../../target-model/types/field-storage.js";
import { rustProjectObjectType } from "../../objects/project-objects.js";
import { rustProjectGenerics, rustProjectStateType, rustProjectStateMarker } from "../../objects/polymorphism/names.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { PlannedProjectObjectField } from "../classes/planning.js";
import type { RustItem, RustStructField } from "../../../target-ast/syntax/nodes.js";
import { rustProjectCloneImplementation, rustProjectWrapperTraits } from "../../objects/project-wrapper-traits.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustProjectImplementationVisibility } from "../../objects/project-storage-abi.js";
import { structAttributes } from "../struct-attributes.js";
import { rustProjectStateIdentityImplementation } from "../../objects/project-identity.js";

export function planInterfaceDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input.program.source;
  const admitted = context.input.program.nativeDeclarations.get(node);
  if (admitted?.kind !== "interface") return failRustPlannerInvariant(
    "Record-interface emission requires its sealed native declaration admission.", node);
  const { definition, name: interfaceName } = admitted;
  const exported = ast.hasModifierKind(node, "export");
  const publiclyReachable = rustProjectTypeHasPublicImplementationAbi(context, interfaceName);
  const storageVisibility = rustProjectImplementationVisibility(publiclyReachable);
  const interfaceVisibility = exported || publiclyReachable
    ? "public" as const
    : "crate" as const;
  const generics = rustProjectGenerics(definition, context);
  const interfaceType = rustTypeFromCarrierInContext(context.input.program.projectTypes.openCarrier(definition), context);
  const stateType = rustProjectStateType(
    context.input.program.projectTypes.openCarrier(definition),
    context,
  );
  if (stateType === undefined || interfaceType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-state-carrier",
      "Record declaration has no renderable named Rust state carrier.",
    ));
    return undefined;
  }
  const stateMarker = rustProjectStateMarker(definition, context);
  const fields: PlannedProjectObjectField[] = [];
  let indexField: RustStructField | undefined;
  if (admitted.index !== undefined) {
    const keyType = rustTypeFromCarrierInContext(admitted.index.keyCarrier, context);
    const valueType = rustTypeFromCarrierInContext(admitted.index.valueCarrier, context);
    if (keyType === undefined || valueType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, admitted.index.declaration),
        "rust.backend.record-index-carrier",
        "An admitted record index requires its renderable native key and value carriers.",
      ));
      return undefined;
    }
    indexField = {
      name: admitted.index.targetName,
      type: {
        kind: "named",
        path: "std::collections::HashMap",
        genericArguments: [
          { kind: "type", type: keyType },
          { kind: "type", type: valueType },
        ],
      },
      visibility: storageVisibility,
    };
  }
  for (const field of admitted.fields) {
    const fieldType = rustTypeFromCarrierInContext(field.carrier, context);
    if (fieldType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, field.declaration),
        "rust.backend.record",
        `Record field '${field.targetName}' has no renderable native carrier.`,
      ));
      return undefined;
    }
    fields.push({
      ...field,
      type: fieldType,
      storageType: fieldType,
      visibility: storageVisibility,
    });
  }
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  const stateCarrier = representation === undefined
    ? undefined
    : rustProjectObjectType(stateType, representation);
  if (representation === undefined || representation.kind !== "value" && stateCarrier === undefined) {
    return failRustPlannerInvariant("An admitted record interface lost its native object representation.", node);
  }
  if (representation.kind !== "value") context.usedAliases?.add("rt");
  const interfaceAttributes = structAttributes(interfaceName) ?? [];
  const interfaceDeadCode = rustProjectInterfaceDeadCodeDisposition(
    context,
    node,
    publiclyReachable,
  );
  const explicitWrapperTraits = representation.kind !== "value" &&
    generics.parameters.some(parameter => parameter.kind === "type");
  const valueFields: RustStructField[] = [
      ...fields.map((field): RustStructField => {
        const deadCode = rustAuthoredFieldDeadCodeDisposition(
          context,
          node,
          field.declaration,
          field.visibility === "public",
        );
        return {
          name: field.targetName,
          type: field.type,
          visibility: field.visibility,
          ...(deadCode === undefined ? {} : { deadCode }),
        };
      }),
      ...(indexField === undefined
        ? []
        : [{
            ...indexField,
            ...(() => {
              const deadCode = rustGeneratedProjectInterfaceFieldDeadCodeDisposition(
                context,
                node,
                "index-storage",
                publiclyReachable,
                indexField.visibility === "public",
              );
              return deadCode === undefined ? {} : { deadCode };
            })(),
          }]),
      ...(stateMarker === undefined
        ? []
        : [{
            name: stateMarker.name,
            type: stateMarker.type,
            visibility: storageVisibility,
            ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
          }]),
    ];
  const stateItem: RustItem = {
    kind: "struct",
    name: definition.stateName,
    visibility: storageVisibility,
    ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
    generics,
    fields: valueFields,
  };
  return [...(representation.kind === "value" ? [] : [stateItem]), {
    kind: "struct",
    name: interfaceName,
    ...(interfaceDeadCode === undefined ? {} : { deadCode: interfaceDeadCode }),
    visibility: interfaceVisibility,
    attrs: [...interfaceAttributes, ...rustDeriveAttributes(representation.kind === "value" || explicitWrapperTraits ? [] : ["Clone", "Debug", "PartialEq"])],
    generics,
    fields: representation.kind === "value" ? valueFields : [{
      name: rustProjectObjectStateField,
      type: stateCarrier!,
      visibility: storageVisibility,
      ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
    }],
  }, ...(representation.kind === "value" && admitted.physical.clone.kind === "conditional"
    ? [rustProjectCloneImplementation(interfaceType, generics, admitted.physical.fields.map(selected => {
        const field = valueFields.find(field => field.name === selected.name);
        if (field === undefined) return failRustPlannerInvariant("An admitted native field has no materialized storage type.", node);
        return { name: selected.name, copy: selected.copy,
          ...(selected.clone.kind !== "required" || selected.copy ? {} : { requirement: field.type }) };
      }))] : []),
  ...(explicitWrapperTraits ? rustProjectWrapperTraits(interfaceType, interfaceName, generics) : []),
  ...(representation.kind === "value" ? [] : [rustProjectStateIdentityImplementation(interfaceType, generics)])];
}
