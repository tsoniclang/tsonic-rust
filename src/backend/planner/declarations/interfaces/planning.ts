import { rustDeriveAttributes, rustHiddenAttribute } from "../../../target-ast/attributes.js";
import { carrierOf } from "../classes/planning.js";
import { diagnosticInput, isValidRustIdentifier, rustProjectTypeHasPublicImplementationAbi } from "../../program/plan-context.js";
import { rustAuthoredFieldDeadCodeDisposition, rustGeneratedProjectInterfaceFieldDeadCodeDisposition, rustProjectInterfaceDeadCodeDisposition } from "../../liveness/directives.js";
import { isRustIntegerCarrier, isRustStringCarrier, rustCarrierSupportsClone } from "../../../../target-model/types/index.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import { Node_Type } from "@tsonic/target-api/source";
import { rustProjectObjectLayout } from "../../../../analysis/project-types/object-layout.js";
import { rustProjectObjectStateField, rustProjectObjectType } from "../../objects/project-objects.js";
import { rustProjectGenerics, rustProjectStateType, rustProjectStateMarker } from "../../objects/polymorphism/names.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { PlannedProjectObjectField } from "../classes/planning.js";
import type { RustItem, RustStructField } from "../../../target-ast/nodes.js";
import { rustProjectWrapperTraits } from "../../objects/project-wrapper-traits.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustProjectImplementationVisibility } from "../../objects/project-storage-abi.js";
import { structAttributes } from "../struct-attributes.js";

export function planInterfaceDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input.program.source;
  const definition = context.input.program.projectTypes.definitionForDeclaration(node);
  const interfaceName = context.input.program.names.nameForDeclaration(node) ?? "";
  if (!isValidRustIdentifier(interfaceName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Interface names must be valid Rust identifiers.",
    ));
    return undefined;
  }
  const exported = ast.hasModifierKind(node, "export");
  const publiclyReachable = rustProjectTypeHasPublicImplementationAbi(context, interfaceName);
  const storageVisibility = rustProjectImplementationVisibility(publiclyReachable);
  const interfaceVisibility = exported || publiclyReachable
    ? "public" as const
    : "crate" as const;
  if (ast.extendsHeritageElements(node).length > 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Interface inheritance is not supported by the Rust target.",
    ));
    return undefined;
  }
  if (definition?.kind !== "interface") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-definition",
      "Interface declaration has no exact project-type definition.",
    ));
    return undefined;
  }
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
  const layout = rustProjectObjectLayout(node, ast);
  if (layout?.kind !== "interface") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-layout",
      "Interface declaration has no deterministic Rust project-object layout.",
    ));
    return undefined;
  }
  if (layout.indexSignatures.length > 1 ||
    (layout.indexSignatures.length === 1 && layout.fields.length > 0)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-index-layout",
      "Rust index-backed interfaces require exactly one index signature and no separately stored property signatures.",
    ));
    return undefined;
  }
  const fields: PlannedProjectObjectField[] = [];
  let indexField: RustStructField | undefined;
  for (const member of ast.members(node)) {
    if (member === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.record-member",
        "Interface declaration contains an undefined member slot.",
      ));
      return undefined;
    }
    if (ast.kindName(member) === "KindIndexSignature") {
      const indexLayout = layout.indexSignatures.find((index) =>
        index.declaration === member);
      const keyCarrier = indexLayout === undefined
        ? undefined
        : carrierOf(context, indexLayout.keyParameter) ??
          carrierOf(context, Node_Type(ast, indexLayout.keyParameter));
      const valueCarrier = carrierOf(context, member) ?? carrierOf(context, Node_Type(ast, member));
      const keyType = rustTypeFromCarrierInContext(keyCarrier, context);
      const valueType = rustTypeFromCarrierInContext(valueCarrier, context);
      const targetName = context.input.program.projectTypes.fieldStorageName(definition, member);
      if (indexLayout === undefined || keyCarrier === undefined || valueCarrier === undefined ||
        keyType === undefined || valueType === undefined || targetName === undefined ||
        (!isRustStringCarrier(keyCarrier) && !isRustIntegerCarrier(keyCarrier)) ||
        !rustCarrierSupportsClone(valueCarrier, context.input.program.typeDefinitions)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, member),
          "rust.backend.record-index-carrier",
          "Rust index-backed interfaces require a closed string/integer key, a cloneable value, and deterministic generated storage.",
        ));
        return undefined;
      }
      indexField = {
        name: targetName,
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
      continue;
    }
    if (ast.kindName(member) !== "KindPropertySignature") {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.record",
        "Record interfaces support only property signatures.",
      ));
      return undefined;
    }
    const fieldName = context.input.program.projectTypes.fieldStorageName(definition, member) ?? "";
    const fieldCarrier = carrierOf(context, member) ?? carrierOf(context, Node_Type(ast, member));
    const fieldType = rustTypeFromCarrierInContext(fieldCarrier, context);
    if (!isValidRustIdentifier(fieldName) || fieldCarrier === undefined || fieldType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.record",
        `Record field '${fieldName}' has no supported Rust carrier fact.`,
      ));
      return undefined;
    }
    const layoutField = layout.fields.find((field) => field.declaration === member);
    if (layoutField === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.record-field-layout",
        `Record field '${fieldName}' has no exact project-object storage slot.`,
      ));
      return undefined;
    }
    fields.push({
      declaration: member,
      sourceName: layoutField.sourceName,
      targetName: fieldName,
      storageIndex: layoutField.storageIndex,
      carrier: fieldCarrier,
      type: fieldType,
      visibility: storageVisibility,
    });
  }
  if (fields.length !== layout.fields.length) {
    return undefined;
  }
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  const stateCarrier = representation === undefined
    ? undefined
    : rustProjectObjectType(stateType, representation);
  if (representation === undefined || representation.kind !== "value" && stateCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.interface-representation",
      "Project interface has no exact Rust object representation.",
    ));
    return undefined;
  }
  if (representation.kind !== "value") context.usedAliases?.add("rt");
  const interfaceAttributes = structAttributes(interfaceName) ?? [];
  const interfaceDeadCode = rustProjectInterfaceDeadCodeDisposition(
    context,
    node,
    interfaceVisibility === "public",
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
                interfaceVisibility === "public",
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
    attrs: [...interfaceAttributes, ...rustDeriveAttributes(representation.kind === "value" ? ["Clone"] : explicitWrapperTraits ? [] : ["Clone", "Debug", "PartialEq"])],
    generics,
    fields: representation.kind === "value" ? valueFields : [{
      name: rustProjectObjectStateField,
      type: stateCarrier!,
      visibility: storageVisibility,
      ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
      ...(explicitWrapperTraits ? {} : (() => {
        const deadCode = rustGeneratedProjectInterfaceFieldDeadCodeDisposition(
          context,
          node,
          "wrapper-state",
          interfaceVisibility === "public",
          storageVisibility === "public",
        );
        return deadCode === undefined ? {} : { deadCode };
      })()),
    }],
  }, ...(explicitWrapperTraits ? rustProjectWrapperTraits(interfaceType, interfaceName, generics) : [])];
}
