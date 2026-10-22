import { rustDeriveAttributes, rustHiddenAttribute } from "../../../target-ast/syntax/attributes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustProjectObjectStateField, rustProjectObjectType } from "../../objects/project-objects.js";
import { rustProjectGenerics, rustProjectStateType, rustProjectStateMarker } from "../../objects/polymorphism/names.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustGenericCallableValue } from "../../../../target-model/types/carriers/generic-callables.js";
import type { Node } from "@tsonic/tsts";
import type { PlannedProjectObjectField } from "../classes/planning.js";
import type { RustItem, RustStructField } from "../../../target-ast/syntax/nodes.js";
import { rustProjectWrapperTraits } from "../../objects/project-wrapper-traits.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { structAttributes } from "../struct-attributes.js";
import { rustProjectStateIdentityImplementation } from "../../objects/project-identity.js";

export function planInterfaceDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] {
  const admitted = context.input.program.records.nativeDeclaration.get(node);
  if (admitted?.kind !== "interface") return failRustPlannerInvariant(
    "Record-interface emission requires its sealed native declaration admission.", node);
  const { definition, name: interfaceName } = admitted;
  const emission = context.input.program.records.declarationLiveness.get(node);
  if (emission?.interface === undefined) failRustPlannerInvariant("An admitted interface requires its native declaration liveness.", node);
  const selectedLiveness = emission.interface;
  const { publiclyReachable } = selectedLiveness;
  const storageVisibility = publiclyReachable ? "public" as const : "crate" as const;
  const interfaceVisibility = emission.visibility;
  const generics = rustProjectGenerics(definition, context);
  const interfaceType = rustTypeFromCarrierInContext(admitted.carrier, context);
  const stateType = rustProjectStateType(
    admitted.carrier,
    context,
  );
  if (stateType === undefined || interfaceType === undefined) {
    failRustPlannerInvariant("An admitted record interface requires its renderable native interface and state carriers.", node);
  }
  const stateMarker = rustProjectStateMarker(definition, context);
  const fields: PlannedProjectObjectField[] = [];
  let indexField: RustStructField | undefined;
  if (admitted.index !== undefined) {
    const keyType = rustTypeFromCarrierInContext(admitted.index.keyCarrier, context);
    const valueType = rustTypeFromCarrierInContext(admitted.index.valueCarrier, context);
    if (keyType === undefined || valueType === undefined) {
      failRustPlannerInvariant("An admitted record index requires its renderable native key and value carriers.", admitted.index.declaration);
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
    // A generic callable field stores the physical family its record literals write; the logical carrier has no storage type.
    const generic = rustGenericCallableValue(field.carrier);
    const carrier = generic !== undefined && generic.physical === undefined
      ? context.input.program.records.recordFieldStorage.get(field.declaration) : field.carrier;
    const fieldType = carrier === undefined ? undefined : rustTypeFromCarrierInContext(carrier, context);
    if (fieldType === undefined) {
      failRustPlannerInvariant("An admitted record field requires its renderable native carrier.", field.declaration);
    }
    fields.push({
      ...field,
      type: fieldType,
      storageType: fieldType,
      visibility: storageVisibility,
    });
  }
  const representation = admitted.representation;
  const stateCarrier = rustProjectObjectType(stateType, representation);
  if (representation.kind !== "value" && stateCarrier === undefined) {
    return failRustPlannerInvariant("An admitted record interface lost its native object representation.", node);
  }
  if (representation.kind !== "value") context.usedAliases?.add("rt");
  const interfaceAttributes = structAttributes(admitted.nonCamelCaseName) ?? [];
  const interfaceDeadCode = selectedLiveness.deadCode;
  const explicitWrapperTraits = representation.kind !== "value" &&
    generics.parameters.some(parameter => parameter.kind === "type");
  const valueFields: RustStructField[] = [
      ...fields.map((field): RustStructField => {
        const deadCode = selectedLiveness.fields.get(field.declaration);
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
              const deadCode = selectedLiveness.indexDeadCode;
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
    attrs: [...interfaceAttributes, ...rustDeriveAttributes(representation.kind === "value" ? ["Clone"] : explicitWrapperTraits ? [] : ["Clone", "Debug", "PartialEq"])],
    generics,
    fields: representation.kind === "value" ? valueFields : [{
      name: rustProjectObjectStateField,
      type: stateCarrier!,
      visibility: storageVisibility,
      ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
    }],
  }, ...(explicitWrapperTraits ? rustProjectWrapperTraits(interfaceType, interfaceName, generics) : []),
  ...(representation.kind === "value" ? [] : [rustProjectStateIdentityImplementation(interfaceType, generics)])];
}
