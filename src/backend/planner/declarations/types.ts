import { carrierOf } from "./classes.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustProjectTypeHasPublicImplementationAbi,
} from "../program/plan-context.js";
import { isRustIntegerCarrier, isRustStringCarrier, rustCloneTrait } from "../../../target-model/types/index.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { Node_Type } from "@tsonic/target-api/source";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { rustProjectObjectLayout } from "../../../analysis/project-types/object-layout.js";
import { rustProjectObjectStateField, rustProjectObjectType } from "../objects/project-objects.js";
import { rustProjectGenerics, rustProjectStateType, rustProjectStateMarker } from "../objects/polymorphism/names.js";
import { rustTypeAliasDeclarationFactKey } from "../../../analysis/facts/keys.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { PlannedProjectObjectField } from "./classes.js";
import type { RustItem, RustStructField } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustSealedCarrierSupportsTrait } from "../ownership/traits.js";
import { rustProjectImplementationVisibility } from "../objects/project-storage-abi.js";
import { rustDocHiddenAttribute, rustDeriveAttribute } from "../../target-ast/attributes.js";
import { rustGenerics, rustTypeGenericArguments } from "../../target-ast/builders.js";
import type { RustAttribute } from "../../target-ast/attributes.js";
import {
  planRustExplicitTraitImplementations,
  rustExplicitRepresentationAttributes,
} from "./explicit-contracts.js";

export function planEnumDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input.program.source;
  const enumName = context.input.program.names.nameForDeclaration(node) ?? "";
  if (!isValidRustIdentifier(enumName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.enum",
      "Enum names must be valid Rust identifiers.",
    ));
    return undefined;
  }
  const variants: Extract<RustItem, { readonly kind: "enum" }>["variants"][number][] = [];
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
    const memberName = context.input.program.names.nameForDeclaration(member) ?? "";
    if (!isValidRustIdentifier(memberName)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.enum",
        "Enum member names must be valid Rust identifiers.",
      ));
      return undefined;
    }
    const constant = context.input.program.enumMemberConstants.forMember(member);
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
    variants.push({
      name: memberName,
      discriminant: { kind: "integer", value: BigInt(value) },
      fields: { kind: "unit" },
    });
  }
  const enumType = { kind: "named" as const, path: enumName };
  const explicitTraitImplementations = planRustExplicitTraitImplementations(
    node,
    enumType,
    rustGenerics(),
    context,
  );
  if (explicitTraitImplementations === undefined) return undefined;
  return [{
    kind: "enum",
    name: enumName,
    visibility: ast.hasModifierKind(node, "export") ||
        rustProjectTypeHasPublicImplementationAbi(context, enumName)
      ? "public"
      : "crate",
    attrs: [rustDeriveAttribute("Clone", "Copy", "Debug", "PartialEq"),
      ...rustExplicitRepresentationAttributes(node, context),
      ...(rustProjectTypeHasPublicImplementationAbi(context, enumName)
        ? []
        : [rustLintAttributes.deadCode])],
    generics: rustGenerics(),
    variants,
  }, ...explicitTraitImplementations];
}

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
  if (context.input.program.declarationContracts.forDeclaration(node)?.unsafeTrait === true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.unsafe-trait-representation",
      "An explicit unsafe Rust trait requires an interface selected for trait representation, not record representation.",
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
  const generics = rustProjectGenerics(definition, context);
  if (generics === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-generics",
      "Interface declaration has no exact renderable Rust generic contract.",
    ));
    return undefined;
  }
  const stateType = rustProjectStateType(
    context.input.program.projectTypes.openCarrier(definition),
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
      const targetName = context.input.program.projectTypes.fieldStorageName(definition, member);
      if (indexLayout === undefined || keyCarrier === undefined || valueCarrier === undefined ||
        keyType === undefined || valueType === undefined || targetName === undefined ||
        (!isRustStringCarrier(keyCarrier) && !isRustIntegerCarrier(keyCarrier)) ||
        !rustSealedCarrierSupportsTrait(valueCarrier, rustCloneTrait, context)) {
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
          genericArguments: rustTypeGenericArguments([keyType, valueType]),
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
  if (representation === undefined || stateCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.interface-representation",
      "Project interface has no exact shared Rust object representation.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  const interfaceAttributes = [
    ...(structAttributes(interfaceName) ?? []),
    ...(rustProjectTypeHasPublicImplementationAbi(context, interfaceName)
      ? []
      : [rustLintAttributes.deadCode]),
  ];
  const openType = rustTypeFromCarrierInContext(
    context.input.program.projectTypes.openCarrier(definition),
    context,
  );
  if (openType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.interface-open-carrier",
      "Interface declaration has no renderable open Rust carrier.",
    ));
    return undefined;
  }
  const explicitTraitImplementations = planRustExplicitTraitImplementations(
    node,
    openType,
    generics,
    context,
  );
  if (explicitTraitImplementations === undefined) return undefined;
  return [{
    kind: "struct",
    name: definition.stateName,
    visibility: storageVisibility,
    attrs: [
      ...(publiclyReachable ? [rustDocHiddenAttribute] : []),
      rustLintAttributes.deadCode,
    ],
    generics,
    fields: { kind: "named", fields: [
      ...fields.map((field) => ({
        name: field.targetName,
        type: field.type,
        visibility: field.visibility,
      })),
      ...(indexField === undefined ? [] : [indexField]),
      ...(stateMarker === undefined
        ? []
        : [{
            name: stateMarker.name,
            type: stateMarker.type,
            visibility: storageVisibility,
            ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
          }]),
    ] },
  }, {
    kind: "struct",
    name: interfaceName,
    attrs: [
      rustDeriveAttribute("Clone", "Debug", "PartialEq"),
      ...rustExplicitRepresentationAttributes(node, context),
      ...interfaceAttributes,
    ],
    visibility: exported || publiclyReachable ? "public" : "crate",
    generics,
    fields: { kind: "named", fields: [{
      name: rustProjectObjectStateField,
      type: stateCarrier,
      visibility: storageVisibility,
      ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
    }] },
  }, ...explicitTraitImplementations];
}

export function planTypeAliasDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input.program.source;
  const carrier = context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
  const fact = context.input.program.facts.getFact(node, rustTypeAliasDeclarationFactKey);
  const aliasName = context.input.program.names.nameForDeclaration(node) ?? "";
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
    visibility: ast.hasModifierKind(node, "export") ||
        rustProjectTypeHasPublicImplementationAbi(context, aliasName)
      ? "public"
      : "crate",
    attrs: [
      rustDeriveAttribute(...(fact.kind === "string-literal"
        ? ["Clone", "Copy", "Debug", "PartialEq"]
        : ["Clone", "Debug", "PartialEq"])),
      ...(rustProjectTypeHasPublicImplementationAbi(context, aliasName)
        ? []
        : [rustLintAttributes.deadCode]),
    ],
    generics: rustGenerics(),
    variants: fact.variants.map((variant, index) => ({
      name: variant.name,
      fields: fact.kind === "runtime"
        ? { kind: "tuple" as const, fields: [{ type: runtimeVariantTypes[index]!, visibility: "private" as const }] }
        : { kind: "unit" as const },
    })),
  }];
}

export function structAttributes(typeName: string): readonly RustAttribute[] | undefined {
  const attrs: RustAttribute[] = [];
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(typeName)) {
    attrs.push(rustLintAttributes.nonCamelCaseType);
  }
  return attrs.length === 0 ? undefined : attrs;
}
