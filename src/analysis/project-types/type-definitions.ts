import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustNativeEnumDeclaration } from "../../target-model/records/native/native-value-declarations.js";
import { rustTsValueTargetType } from "../../target-model/types/carriers/native.js";
import { isRustClosedValueCarrier } from "../../target-model/types/carriers/closed-value-kind.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustSourceUnionTargetType } from "../../target-model/types/carriers/source-types.js";
import { closedMetadataKey, hasExactObjectKeys, isClosedMetadata, isDenseDataArray, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { instantiateRustSourceUnionVariants, rustSourceUnionDefinitionIdentity, type RustTypeDefinitions, type RustSourceUnionDefinition, type RustSourceUnionPayloadTemplate, type RustProgramErrorOrigin } from "../../target-model/types/source-union-definitions.js";
import { createRustSourceUnionPayloadTemplate } from "./source-union-payloads.js";

export interface RustTypeDefinitionRegistry extends RustTypeDefinitions {
  registerSourceEnum(carrier: TargetTypeRef, definition: RustNativeEnumDeclaration): boolean;
  registerSourceUnion(definition: RustSourceUnionDefinition, template: boolean): boolean;
  registerProgramErrorOrigin(carrier: TargetTypeRef, origin: RustProgramErrorOrigin): boolean;
  definitionCarriers(): readonly TargetTypeRef[];
  generatedUnions(): readonly RustSourceUnionDefinition[];
  seal(): RustTypeDefinitions;
}

export function createRustTypeDefinitionRegistry(
  selectedClosedValueCarrier: TargetTypeRef = rustTsValueTargetType(),
): RustTypeDefinitionRegistry {
  if (!isRustClosedValueCarrier(selectedClosedValueCarrier)) {
    failTargetAnalysisInvariant("tsonic-rust", "Rust type definitions require an exact closed value carrier.");
  }
  const closedValueCarrier = snapshotClosedMetadata(selectedClosedValueCarrier);
  const definitions = new Map<string, RustSourceUnionDefinition>();
  const enums = new Map<string, RustNativeEnumDeclaration>();
  const templates = new Map<string, RustSourceUnionDefinition>();
  const payloadTemplates = new Map<string, RustSourceUnionPayloadTemplate>();
  const errorOrigins = new Map<string, RustProgramErrorOrigin>();
  let sealed = false;
  const sourceEnumDefinition: RustTypeDefinitions["sourceEnumDefinition"] = carrier =>
    enums.get(closedMetadataKey(carrier));
  const sourceVariants: RustTypeDefinitions["sourceUnionVariants"] = carrier => {
    if (!isRustTargetTypeRef(carrier)) return undefined;
    const value = rustSourceUnionCarrierValue(carrier);
    if (value === undefined) return undefined;
    const logical = value.origin === "authored"
      ? rustSourceUnionTargetType(value.fileName, value.typeName, value.genericArguments) : carrier;
    const exact = definitions.get(closedMetadataKey(logical));
    if (exact !== undefined) return exact.variants;
    const identity = rustSourceUnionDefinitionIdentity(carrier);
    const template = identity === undefined ? undefined : templates.get(identity);
    return template === undefined ? undefined : instantiateRustSourceUnionVariants(template, carrier);
  };
  const sourceUnionPayloadTemplate: RustTypeDefinitions["sourceUnionPayloadTemplate"] = carrier => {
    const identity = rustSourceUnionDefinitionIdentity(carrier);
    if (identity === undefined || sourceVariants(carrier) === undefined) return undefined;
    const existing = payloadTemplates.get(identity);
    if (existing !== undefined || sealed) return existing;
    const definition = templates.get(identity);
    const template = definition === undefined ? undefined : createRustSourceUnionPayloadTemplate(definition, sourceVariants);
    if (template !== undefined) payloadTemplates.set(identity, template);
    return template;
  };
  const sourceUnionVariants: RustTypeDefinitions["sourceUnionVariants"] = carrier => {
    const variants = sourceVariants(carrier);
    const value = rustSourceUnionCarrierValue(carrier);
    if (variants === undefined || value === undefined || value.payloads.kind === "source" || value.origin === "generated") return variants;
    const template = sourceUnionPayloadTemplate(carrier);
    const payloads = value.payloads.types;
    if (template === undefined || payloads.length !== variants.length) return undefined;
    const indexes = new Set(template.payloadParameters.map(parameter => parameter.variantIndex));
    if (variants.some((variant, index) => !indexes.has(index) && !rustTargetTypeRefEquals(variant.carrier, payloads[index]))) return undefined;
    return snapshotClosedMetadata(variants.map((variant, index) => ({ name: variant.name, carrier: payloads[index]! })));
  };
  return Object.freeze({
    closedValueCarrier,
    sourceEnumDefinition,
    sourceUnionVariants,
    sourceUnionPayloadTemplate,
    programErrorOrigin: (carrier: TargetTypeRef) => isRustTargetTypeRef(carrier) ? errorOrigins.get(closedMetadataKey(carrier)) : undefined,
    registerSourceEnum(carrier: TargetTypeRef, definition: RustNativeEnumDeclaration) {
      if (sealed) failTargetAnalysisInvariant("tsonic-rust", "Rust type definitions are sealed.");
      const source = rustSourceTypeCarrierValue(carrier);
      if (source?.shape !== "enum" || source.genericArguments.length !== 0 ||
        definition.kind !== "enum" || !Object.isFrozen(definition) || !Object.isFrozen(definition.variants) ||
        definition.integerWidth !== 32 && definition.integerWidth !== 64 ||
        definition.representation !== "enum" && definition.representation !== "constants" ||
        definition.variants.some(variant => !Object.isFrozen(variant))) return false;
      const identity = closedMetadataKey(carrier);
      if (enums.has(identity)) return false;
      enums.set(identity, definition);
      return true;
    },
    registerProgramErrorOrigin(carrier: TargetTypeRef, origin: RustProgramErrorOrigin) {
      if (sealed) failTargetAnalysisInvariant("tsonic-rust", "Rust type definitions are sealed.");
      if (!isRustTargetTypeRef(carrier) || !isClosedMetadata(origin) || origin === null || typeof origin !== "object" ||
        !(origin.kind === "provider" && hasExactObjectKeys(origin, ["kind"]) || origin.kind === "project" &&
          hasExactObjectKeys(origin, ["kind", "variant", "sourceError"]) && typeof origin.variant === "string" &&
          origin.variant.length > 0 && typeof origin.sourceError === "boolean" &&
          rustSourceTypeCarrierValue(carrier)?.shape === "object")) return false;
      const identity = closedMetadataKey(carrier);
      const previous = errorOrigins.get(identity);
      if (previous !== undefined && closedMetadataKey(previous) !== closedMetadataKey(origin)) return false;
      errorOrigins.set(identity, previous ?? snapshotClosedMetadata(origin));
      return true;
    },
    definitionCarriers: () => Object.freeze([...definitions.values()].flatMap(definition => definition.variants.map(variant => variant.carrier))),
    generatedUnions: () => Object.freeze([...definitions.values()].filter(definition =>
      rustSourceUnionCarrierValue(definition.carrier)?.origin === "generated")),
    registerSourceUnion(definition: RustSourceUnionDefinition, template: boolean) {
      if (sealed) failTargetAnalysisInvariant("tsonic-rust", "Rust type definitions are sealed.");
      if (typeof template !== "boolean" || definition === null || typeof definition !== "object" || !isClosedMetadata(definition) ||
        !hasExactObjectKeys(definition, ["carrier", "variants"]) || !isRustTargetTypeRef(definition.carrier)) return false;
      const value = rustSourceUnionCarrierValue(definition.carrier);
      const identity = rustSourceUnionDefinitionIdentity(definition.carrier);
      if (identity === undefined || value === undefined || value.origin === "authored" && value.payloads.kind !== "source" ||
        !isDenseDataArray(definition.variants) ||
        definition.variants.length < 1 ||
        definition.variants.some(variant => variant === null || typeof variant !== "object" ||
          !hasExactObjectKeys(variant, ["name", "carrier"]) || typeof variant.name !== "string" || variant.name.length === 0 ||
          !isRustTargetTypeRef(variant.carrier)) ||
        new Set(definition.variants.map(variant => variant.name)).size !== definition.variants.length ||
        value.origin === "generated" && (value.payloads.kind !== "physical" || definition.variants.length !== value.payloads.types.length ||
          definition.variants.some((variant, index) => {
            return variant.name !== `Variant${index}` || value.payloads.kind !== "physical" ||
              !rustTargetTypeRefEquals(variant.carrier, value.payloads.types[index]);
          }))) return false;
      const key = closedMetadataKey(definition.carrier);
      const existing = definitions.get(key);
      const expected = sourceUnionVariants(definition.carrier);
      if (expected !== undefined && (expected.length !== definition.variants.length ||
        expected.some((variant, index) => variant.name !== definition.variants[index]!.name ||
          !rustTargetTypeRefEquals(variant.carrier, definition.variants[index]!.carrier)))) return false;
      if (template && value.origin !== "generated" && templates.has(identity) && templates.get(identity) !== existing) return false;
      const normalized = existing ?? snapshotClosedMetadata(definition);
      definitions.set(key, normalized);
      if (value.origin === "generated" && !templates.has(identity) || template) templates.set(identity, normalized);
      payloadTemplates.clear();
      return true;
    },
    seal() {
      const visited = new Set<string>();
      const visit = (carrier: TargetTypeRef): void => {
        const key = closedMetadataKey(carrier);
        if (visited.has(key)) return;
        visited.add(key);
        if (rustSourceUnionCarrierValue(carrier) !== undefined && sourceUnionVariants(carrier) === undefined) {
          failTargetAnalysisInvariant("tsonic-rust", "A Rust source union references an undefined or incompatible variant contract.");
        }
        for (const child of rustTargetTypeChildren(carrier)) visit(child);
      };
      for (const definition of definitions.values()) for (const variant of definition.variants) visit(variant.carrier);
      for (const definition of templates.values()) sourceUnionPayloadTemplate(definition.carrier);
      sealed = true;
      return Object.freeze({closedValueCarrier, sourceEnumDefinition, sourceUnionVariants, sourceUnionPayloadTemplate,
        programErrorOrigin: (carrier: TargetTypeRef) => isRustTargetTypeRef(carrier) ? errorOrigins.get(closedMetadataKey(carrier)) : undefined});
    },
  });
}
