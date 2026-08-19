import { carrierOf } from "./classes.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustSourceItemIsPubliclyReachable,
} from "../program/plan-context.js";
import { isRustIntegerCarrier, isRustStringCarrier, rustCarrierSupportsClone } from "../../../policy/types/target-types.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { Node_Type } from "@tsonic/target-api/source";
import { rustLintAttributes } from "../../rust-ast/lint-policy.js";
import { rustProjectObjectLayout } from "../../../analysis/project-types/object-layout.js";
import { rustProjectObjectStateField, rustProjectObjectType } from "../objects/project-objects.js";
import { rustProjectStateType, rustProjectStateMarker, rustProjectTypeParameters } from "../objects/polymorphism/names.js";
import { rustTypeAliasDeclarationFactKey } from "../../../analysis/facts/keys.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { PlannedProjectObjectField } from "./classes.js";
import type { RustItem, RustStructField } from "../../rust-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planEnumDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const enumName = context.input.names.nameForDeclaration(node) ?? "";
  if (!isValidRustIdentifier(enumName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.enum",
      "Enum names must be valid Rust identifiers.",
    ));
    return undefined;
  }
  const variants: { name: string; discriminant?: string }[] = [];
  const discriminants = new Map<number, string>();
  for (const member of ast.members(node)) {
    if (member === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.enum-member",
        "Enum declaration contains an undefined member slot.",
      ));
      return undefined;
    }
    const memberName = context.input.names.nameForDeclaration(member) ?? "";
    if (!isValidRustIdentifier(memberName)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.enum",
        "Enum member names must be valid Rust identifiers.",
      ));
      return undefined;
    }
    const constant = context.input.analysis.getEnumMemberConstant(member);
    const value = constant?.value;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.enum",
        "Enum members require integer constants evaluated by TSTS.",
      ));
      return undefined;
    }
    const previousMember = discriminants.get(value);
    if (previousMember !== undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.enum",
        `Enum members '${previousMember}' and '${memberName}' have the same discriminant ${value}, which Rust rejects.`,
      ));
      return undefined;
    }
    discriminants.set(value, memberName);
    variants.push({ name: memberName, discriminant: String(value) });
  }
  return [{
    kind: "enum",
    name: enumName,
    visibility: ast.hasModifierKind(node, "export") ? "public" : "crate",
    ...(rustSourceItemIsPubliclyReachable(context, enumName)
      ? {}
      : { attrs: [rustLintAttributes.deadCode] }),
    derives: ["Clone", "Copy", "Debug", "PartialEq"],
    variants,
  }];
}

export function planInterfaceDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const definition = context.input.projectTypes.definitionForDeclaration(node);
  const interfaceName = context.input.names.nameForDeclaration(node) ?? "";
  if (!isValidRustIdentifier(interfaceName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Interface names must be valid Rust identifiers.",
    ));
    return undefined;
  }
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
  const typeParams = rustProjectTypeParameters(definition);
  const stateType = rustProjectStateType(
    context.input.projectTypes.openCarrier(definition),
    context,
  );
  if (stateType === undefined) {
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
      const targetName = context.input.projectTypes.fieldStorageName(definition, member);
      if (indexLayout === undefined || keyCarrier === undefined || valueCarrier === undefined ||
        keyType === undefined || valueType === undefined || targetName === undefined ||
        (!isRustStringCarrier(keyCarrier) && !isRustIntegerCarrier(keyCarrier)) ||
        !rustCarrierSupportsClone(valueCarrier)) {
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
          typeArguments: [keyType, valueType],
        },
        visibility: "crate",
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
    const fieldName = context.input.projectTypes.fieldStorageName(definition, member) ?? "";
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
    });
  }
  if (fields.length !== layout.fields.length) {
    return undefined;
  }
  const representation = context.input.objectRepresentations.representationFor(definition);
  const stateCarrier = representation === undefined
    ? undefined
    : rustProjectObjectType(stateType, representation);
  if (representation === undefined || stateCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.interface-representation",
      "Project interface has no exact shared Rust object representation.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  const exported = ast.hasModifierKind(node, "export");
  const interfaceAttributes = [
    ...(structAttributes(interfaceName) ?? []),
    ...(rustSourceItemIsPubliclyReachable(context, interfaceName)
      ? []
      : [rustLintAttributes.deadCode]),
  ];
  return [{
    kind: "struct",
    name: definition.stateName,
    visibility: "crate",
    attrs: [rustLintAttributes.deadCode],
    derives: [],
    ...(typeParams.length === 0 ? {} : { typeParams }),
    fields: [
      ...fields.map((field) => ({
        name: field.targetName,
        type: field.type,
        visibility: "crate" as const,
      })),
      ...(indexField === undefined ? [] : [indexField]),
      ...(stateMarker === undefined
        ? []
        : [{ name: stateMarker.name, type: stateMarker.type, visibility: "crate" as const }]),
    ],
  }, {
    kind: "struct",
    name: interfaceName,
    ...(interfaceAttributes.length === 0 ? {} : { attrs: interfaceAttributes }),
    visibility: exported ? "public" : "crate",
    derives: ["Clone", "Debug", "PartialEq"],
    ...(typeParams.length === 0 ? {} : { typeParams }),
    fields: [{
      name: rustProjectObjectStateField,
      type: stateCarrier,
      visibility: "crate",
    }],
  }];
}

export function planTypeAliasDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const carrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  const fact = context.input.facts.getFact(node, rustTypeAliasDeclarationFactKey);
  const aliasName = context.input.names.nameForDeclaration(node) ?? "";
  if (carrier === undefined || fact === undefined || !isValidRustIdentifier(aliasName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.type-alias",
      "Type aliases require one finalized Rust alias representation.",
    ));
    return undefined;
  }
  if (fact.kind === "erased") {
    return [];
  }
  const runtimeVariantTypes = fact.kind === "runtime"
    ? fact.variants.map((variant) =>
        rustTypeFromCarrierInContext(variant.carrier, context))
    : [];
  if (runtimeVariantTypes.some((type) => type === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.union-variant-carrier",
      "Runtime union variants require renderable finalized Rust carriers.",
    ));
    return undefined;
  }
  return [{
    kind: "enum",
    name: aliasName,
    visibility: ast.hasModifierKind(node, "export") ? "public" : "crate",
    ...(rustSourceItemIsPubliclyReachable(context, aliasName)
      ? {}
      : { attrs: [rustLintAttributes.deadCode] }),
    derives: fact.kind === "string-literal"
      ? ["Clone", "Copy", "Debug", "PartialEq"]
      : ["Clone", "Debug", "PartialEq"],
    variants: fact.variants.map((variant, index) => ({
      name: variant.name,
      ...(fact.kind === "runtime"
        ? { fields: [runtimeVariantTypes[index]!] }
        : {}),
    })),
  }];
}

export function structAttributes(typeName: string): readonly string[] | undefined {
  const attrs: string[] = [];
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(typeName)) {
    attrs.push(rustLintAttributes.nonCamelCaseType);
  }
  return attrs.length === 0 ? undefined : attrs;
}
