import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { Node_Type, type SourceFileSemantics } from "@tsonic/target-api/source";
import { rustNativePropertyNameIssue } from "../objects/computed-field-names.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNativeDeclarationForm } from "../../target-model/records/native/native-declaration-forms.js";
import type { RustNativeInterfaceField } from "../../target-model/records/native/native-value-declarations.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustSourceTypeFamilyPlan } from "../../target-model/types/type-families.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { isRustIntegerCarrier, isRustStringCarrier, rustOptionElementCarrier, rustSourceUnionCarrierValue } from "../../target-model/types/index.js";
import { rustCarrierSupportsClone } from "../../policy/constraints/native-traits.js";
import { closeRustRetainedCallableCarrier } from "../../policy/ownership/retained-storage.js";

export interface RustNativeValueDeclarationInput {
  readonly ast: AstReader;
  readonly semanticsFor: (node: Node) => SourceFileSemantics;
  readonly records: RustProgramRecords;
  readonly names: RustNamePlan;
  readonly projectTypes: RustProjectTypePolicy;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly typeFamilies: RustSourceTypeFamilyPlan;
}

export type RustNativeDeclarationAdmission =
  | { readonly kind: "accepted"; readonly form: RustNativeDeclarationForm }
  | { readonly kind: "erased" }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

export function admitRustNativeValueDeclaration(
  declaration: Node,
  input: RustNativeValueDeclarationInput,
): RustNativeDeclarationAdmission {
  const kind = input.ast.kindName(declaration);
  if (kind === "KindEnumDeclaration") {
    const carrier = input.records.runtimeCarrier.get(declaration)?.carrier;
    const form = carrier === undefined ? undefined : input.typeDefinitions.sourceEnumDefinition(carrier);
    if (form === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An emitted source enum requires its completed early native type definition.", declaration);
    return { kind: "accepted", form };
  }
  if (kind === "KindInterfaceDeclaration" && input.records.typeOnlyDeclaration.get(declaration) !== undefined) {
    return { kind: "erased" };
  }
  const definition = kind === "KindInterfaceDeclaration"
    ? input.projectTypes.definitionForDeclaration(declaration) : undefined;
  if (definition !== undefined && input.projectTypes.isPolymorphic(definition)) return { kind: "erased" };
  const name = input.names.nameForDeclaration(declaration);
  if (name === undefined || !isValidRustIdentifier(name)) {
    return reject(declaration, "RUST_DECLARATION_NAME_NOT_CLOSED",
      "An emitted native declaration requires its exact preserved Rust identifier.");
  }
  if (kind === "KindInterfaceDeclaration") return admitInterface(declaration, name, input);
  return admitAlias(declaration, name, input);
}

function admitInterface(
  declaration: Node,
  name: string,
  input: RustNativeValueDeclarationInput,
): RustNativeDeclarationAdmission {
  const { ast, records, projectTypes } = input;
  for (const member of ast.members(declaration)) {
    if (member === undefined) continue;
    const name = ast.name(member);
    if (name === undefined) continue;
    const selectedName = input.semanticsFor(member).propertyNames.get(name);
    if (selectedName === undefined) {
      if (ast.is.IsComputedPropertyName(name)) failTargetAnalysisInvariant("tsonic-rust",
        "A native computed field requires its completed checked property-name selection.", name);
      continue;
    }
    const issue = rustNativePropertyNameIssue(name, selectedName);
    if (issue !== undefined) return { kind: "rejected", diagnostics: Object.freeze([issue]) };
  }
  const definition = projectTypes.definitionForDeclaration(declaration);
  const layout = definition === undefined ? undefined : projectTypes.objectLayoutForDefinition(definition);
  if (definition?.kind !== "interface" || layout?.kind !== "interface") {
    return reject(declaration, "RUST_INTERFACE_LAYOUT_NOT_CLOSED",
      "Interface declaration requires one exact project definition and deterministic native object layout.");
  }
  const representation = input.objectRepresentations.representationFor(definition);
  if (representation === undefined || representation.kind !== "value" &&
    representation.kind !== "shared-immutable" && representation.kind !== "shared-mutable") {
    return reject(declaration, "RUST_INTERFACE_REPRESENTATION_NOT_CLOSED",
      "A record interface requires its exact native value or shared-state representation.");
  }
  if (ast.extendsHeritageElements(declaration).length > 0) {
    return reject(declaration, "RUST_INTERFACE_RECORD_HERITAGE_NOT_SUPPORTED",
      "An inherited interface requires the selected native polymorphic representation.");
  }
  if (layout.indexSignatures.length > 1 || layout.indexSignatures.length === 1 && layout.fields.length > 0) {
    return reject(declaration, "RUST_INTERFACE_INDEX_LAYOUT_NOT_SUPPORTED",
      "Rust index-backed interfaces require exactly one index signature and no separately stored property signatures.");
  }
  const members = ast.members(declaration);
  if (!isDenseDataArray(members) || members.some(member => member === undefined)) {
    return reject(declaration, "RUST_SOURCE_AST_INCOMPLETE", "Interface declaration contains an undefined member slot.");
  }
  const fields: RustNativeInterfaceField[] = [];
  let index: Extract<RustNativeDeclarationForm, { readonly kind: "interface" }>["index"];
  for (const member of members as readonly Node[]) {
    const targetName = projectTypes.fieldStorageName(definition, member);
    const carrier = records.runtimeCarrier.get(member)?.carrier ?? records.runtimeCarrier.get(Node_Type(ast, member))?.carrier;
    if (ast.kindName(member) === "KindIndexSignature") {
      const selected = layout.indexSignatures.find(entry => entry.declaration === member);
      const keyCarrier = selected === undefined ? undefined : records.runtimeCarrier.get(selected.keyParameter)?.carrier ??
        records.runtimeCarrier.get(Node_Type(ast, selected.keyParameter))?.carrier;
      if (selected === undefined || keyCarrier === undefined || carrier === undefined || targetName === undefined ||
        !isRustStringCarrier(keyCarrier) && !isRustIntegerCarrier(keyCarrier) ||
        !rustCarrierSupportsClone(carrier, input.typeDefinitions)) {
        return reject(member, "RUST_INTERFACE_INDEX_CARRIER_NOT_SUPPORTED",
          "Rust index-backed interfaces require a closed string/integer key, a cloneable value, and deterministic generated storage.");
      }
      index = Object.freeze({ declaration: member, targetName, keyCarrier, valueCarrier: carrier });
      continue;
    }
    if (ast.kindName(member) !== "KindPropertySignature") {
      return reject(member, "RUST_INTERFACE_RECORD_MEMBER_NOT_SUPPORTED", "Record interfaces support only property signatures.");
    }
    const selected = layout.fields.find(entry => entry.declaration === member);
    if (targetName === undefined || !isValidRustIdentifier(targetName) || carrier === undefined || selected === undefined) {
      return reject(member, "RUST_INTERFACE_FIELD_NOT_CLOSED",
        "A record field requires its exact selected name, native carrier and project-object storage slot.");
    }
    // A record owns its fields: callable storage with an open environment is 'static in the record struct.
    fields.push(Object.freeze({ declaration: member, sourceName: selected.sourceName, targetName,
      storageIndex: selected.storageIndex, carrier: closeRustRetainedCallableCarrier(carrier, { kind: "static" }) }));
  }
  if (fields.length !== layout.fields.length) {
    return reject(declaration, "RUST_INTERFACE_FIELD_COVERAGE_NOT_CLOSED",
      "Record field selections do not cover its exact project-object storage layout.");
  }
  return { kind: "accepted", form: Object.freeze({ kind: "interface", name, definition,
    carrier: projectTypes.openCarrier(definition), representation, nonCamelCaseName: !/^[A-Z][A-Za-z0-9]*$/u.test(name),
    fields: Object.freeze(fields), ...(index === undefined ? {} : { index }) }) };
}

function admitAlias(
  declaration: Node,
  name: string,
  input: RustNativeValueDeclarationInput,
): RustNativeDeclarationAdmission {
  const carrier = input.records.runtimeCarrier.get(declaration)?.carrier;
  const fact = input.records.typeAliasDeclaration.get(declaration);
  if (carrier === undefined || fact === undefined) {
    return reject(declaration, "RUST_TYPE_ALIAS_REPRESENTATION_NOT_CLOSED",
      "Type aliases require one finalized Rust alias representation.");
  }
  if (fact.kind === "family") {
    const family = input.typeFamilies.families.find(candidate =>
      candidate.kind === "conditional" && candidate.declaration === declaration);
    if (family?.kind !== "conditional") return reject(declaration, "RUST_TYPE_FAMILY_DECLARATION_NOT_CLOSED",
      "A type-family declaration requires its exact selected native family identity.");
    return { kind: "accepted", form: Object.freeze({ kind: "alias", name, carrier, fact, family }) };
  }
  if (fact.kind === "erased") {
    return { kind: "accepted", form: Object.freeze({ kind: "alias", name, carrier, fact }) };
  }
  const genericContract = input.sourceLifetimes.contractFor(declaration);
  if (fact.kind === "native-alias" && genericContract === undefined || genericContract !== undefined &&
    (genericContract.lifetimeBinder !== undefined || genericContract.parameters.some(parameter =>
      parameter.kind === "lifetime" ? parameter.lifetime.kind !== "parameter" : !isValidRustIdentifier(parameter.targetName)))) {
    return reject(declaration, "RUST_TYPE_ALIAS_GENERIC_CONTRACT_NOT_CLOSED",
      "An emitted type alias requires its exact native generic and lifetime contract.");
  }
  const template = fact.kind === "runtime"
    ? input.typeDefinitions.sourceUnionPayloadTemplate(rustOptionElementCarrier(carrier) ?? carrier) : undefined;
  if (fact.kind === "runtime") {
    const source = template === undefined ? undefined : rustSourceUnionCarrierValue(template.carrier);
    const parameters = genericContract?.parameters ?? [];
    if (template === undefined || source === undefined || source.genericArguments.length !== parameters.length ||
      source.genericArguments.some((argument, index) => argument.kind !== parameters[index]?.kind) ||
      template.sourceArgumentIndexes.some(index => parameters[index] === undefined) ||
      template.variants.length !== fact.variants.length ||
      template.variants.some((variant, index) => variant.name !== fact.variants[index]?.name)) {
      return reject(declaration, "RUST_TYPE_ALIAS_PAYLOAD_NOT_CLOSED",
        "Runtime union variants require one exact physical payload template and native generic correspondence.");
    }
  }
  return { kind: "accepted", form: Object.freeze({ kind: "alias", name, carrier, fact,
    ...(genericContract === undefined ? {} : { genericContract }),
    ...(template === undefined ? {} : { payloadTemplate: template }) }) };
}

function reject(sourceNode: Node, code: string, message: string): RustNativeDeclarationAdmission {
  return { kind: "rejected", diagnostics: Object.freeze([Object.freeze({ code, message, sourceNode,
    category: "error" as const, source: "tsonic-rust", evidence: ["target.capability=rust.declaration.native-form"] })]) };
}
