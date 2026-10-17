import type { Node, SourceFile } from "@tsonic/tsts";
import { Node_Initializer, Node_Type, sourceClassFieldIsTypeOnly, sourceParameterIsProperty } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeDeclarationForm, RustNativeDeclarationForms } from "../../target-model/records/native-declaration-forms.js";
import { admitRustNativeValueDeclaration, admitRustNativeInterfaceFields,
  publishRustNativeInterfaceDeclaration, type RustPreparedNativeInterfaceDeclaration,
  type RustNativeValueDeclarationInput } from "./native-value-declarations.js";
import type { RustDeclarationGenericRequirementIndex } from "./generic-requirements.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustGeneratedTypeParameterNames } from "../../target-model/names/type-parameters.js";
import { selectRustNativeTypeCarrier } from "../../policy/types/model/native-type-selection.js";
import { isRustCopyCarrier, selectRustCloneRequirements } from "../../target-model/types/index.js";
import type { RustNativeClassDeclaration, RustNativeClassField,
  RustNativeObjectPhysicalDeclaration, RustNativeObjectPhysicalField } from "../../target-model/records/native-value-declarations.js";
import type { RustTypeDefinitionRegistry } from "../project-types/type-definitions.js";
import type { RustSourceObjectPhysicalDefinition } from "../../target-model/types/source-union-definitions.js";
import type { RustFrameCallablePlan } from "../callables/frame-values.js";
import type { RustClassValuePlan } from "../objects/class-values.js";
import type { RustProjectMethodPropertyPlan } from "../project-types/method-properties.js";
import type { RustProjectConstructionQueries } from "../project-types/construction-plan.js";
import { rustRetainedFrameCounterName } from "../callables/frame-counter-storage.js";
import { validatedRustCapturedFieldStorageFact } from "../storage/receiver-captures.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import { rustProjectObjectStateField, rustProjectObjectIdentityField,
  rustProjectObjectDispatchField } from "../../target-model/types/field-storage.js";

interface RustNativeObjectDeclarationInput extends Omit<RustNativeValueDeclarationInput,
  "typeFamilies" | "nativeTypeInputFor" | "nativeStateCarrierFor"> {
  readonly typeDefinitions: RustTypeDefinitionRegistry;
  readonly frames: RustFrameCallablePlan;
  readonly classValues: RustClassValuePlan;
  readonly projectMethodProperties: RustProjectMethodPropertyPlan;
  readonly projectConstructions: RustProjectConstructionQueries;
  readonly isNativeNode: (node: Node) => boolean;
}

export interface RustPreparedNativeDeclarationForms {
  get(declaration: Node): RustPreparedNativeClassDeclaration | RustPreparedNativeInterfaceDeclaration | undefined;
  complete(input: RustNativeValueDeclarationInput & { readonly sourceFiles: readonly SourceFile[];
    readonly genericRequirements: RustDeclarationGenericRequirementIndex }): AnalyzeRustNativeDeclarationFormsResult;
}

type RustPreparedNativeClassDeclaration = Omit<RustNativeClassDeclaration, "fields"> & {
  readonly fields: readonly Omit<RustNativeClassField, "nativeCarrier">[];
};

export function prepareRustNativeDeclarationForms(input: RustNativeObjectDeclarationInput):
  | { readonly kind: "resolved"; readonly forms: RustPreparedNativeDeclarationForms }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const forms = new WeakMap<Node, RustPreparedNativeClassDeclaration | RustPreparedNativeInterfaceDeclaration>();
  const objects: { readonly declaration: Node; readonly form: RustPreparedNativeClassDeclaration | RustPreparedNativeInterfaceDeclaration }[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  const { ast, projectTypes } = input;
  for (const definition of projectTypes.definitions) {
    const declaration = definition.declaration;
    if (!input.isNativeNode(declaration) || input.records.typeOnlyDeclaration.get(declaration) !== undefined) continue;
    let form: RustPreparedNativeClassDeclaration | RustPreparedNativeInterfaceDeclaration;
    if (definition.kind === "interface") {
      if (ast.parent(declaration) !== ast.getSourceFile(declaration)) continue;
      if (projectTypes.isPolymorphic(definition)) {
        const selected = physical(definition, [], input);
        if (!input.typeDefinitions.registerSourceObjectPhysicalDefinition(selected.definition)) {
          diagnostics.push(objectIssue(declaration, "A native object requires one complete physical-field definition registered exactly once."));
        }
        continue;
      }
      const admitted = admitRustNativeInterfaceFields(declaration, input);
      if (admitted.kind === "rejected") { diagnostics.push(...admitted.diagnostics); continue; }
      const storageFields: RustNativeObjectPhysicalField[] = admitted.form.fields.map(field => Object.freeze({
        kind: "field", name: field.targetName, declaration: field.declaration, copy: isRustCopyCarrier(field.carrier),
        clone: Object.freeze({ kind: "required", carrier: field.carrier }),
      }));
      if (admitted.form.index !== undefined) storageFields.push(Object.freeze({ kind: "index",
        name: admitted.form.index.targetName, copy: false, clone: Object.freeze({ kind: "required", carrier: {
          kind: "tuple" as const, elements: [admitted.form.index.keyCarrier, admitted.form.index.valueCarrier],
        } }) }));
      if (definition.genericParameters.length !== 0) storageFields.push(marker(definition));
      form = Object.freeze({ ...admitted.form, physical: physical(definition, storageFields, input) });
    } else {
      const name = input.names.nameForDeclaration(declaration);
      const layout = projectTypes.objectLayoutForDefinition(definition);
      if (name === undefined || !isValidRustIdentifier(name) || layout?.kind !== "class") {
        diagnostics.push(objectIssue(declaration, "Class declaration requires its exact native name and physical field layout."));
        continue;
      }
      const fields: Omit<RustNativeClassField, "nativeCarrier">[] = [];
      const frame = input.frames.definitionForOwner(declaration);
      const frameCounterName = frame === undefined ? undefined : rustRetainedFrameCounterName(frame,
        { callableValues: { frames: input.frames }, projectTypes, projectConstructions: input.projectConstructions });
      const storageFields: RustNativeObjectPhysicalField[] = [];
      if (frame !== undefined) {
        if (frame.storage.kind === "standalone") {
          const carrier = frame.entries[0]?.implementations[0]?.carrier;
          if (frame.storage.instanceFieldName === undefined || carrier === undefined) {
            diagnostics.push(objectIssue(declaration, "A native class frame requires its actual retained field name and callable carrier."));
            continue;
          }
          storageFields.push(Object.freeze({ kind: "frame", name: frame.storage.instanceFieldName, carrier,
            copy: false, clone: Object.freeze({ kind: "unconditional" }) }));
        } else {
          if (frameCounterName !== undefined) storageFields.push(Object.freeze({ kind: "frame-counter", name: frameCounterName,
            copy: false, clone: Object.freeze({ kind: "unavailable" }) }));
        }
      }
      const environment = input.classValues.forDeclaration(declaration)?.environment;
      if (environment?.instancesUseEnvironment && input.objectRepresentations.representationFor(definition)?.kind === "value") {
        storageFields.push(Object.freeze({ kind: "environment", name: environment.instanceFieldName,
          carrier: environment.carrier, copy: environment.copy, clone: Object.freeze({ kind: "unconditional" }) }));
      }
      for (const selected of layout.fields) {
        const member = selected.declaration;
        if (sourceClassFieldIsTypeOnly(ast, member) || ast.hasModifierKind(member, "static") ||
          input.objectRepresentations.aliasFor(member) !== undefined) continue;
        const targetName = projectTypes.fieldStorageName(definition, member);
        const carrier = input.records.runtimeCarrier.get(member)?.carrier ?? input.records.runtimeCarrier.get(Node_Type(ast, member))?.carrier;
        const binding = input.frames.bindingFor(member);
        const capture = validatedRustCapturedFieldStorageFact(member, input)?.storage;
        if (targetName === undefined || !isValidRustIdentifier(targetName) || carrier === undefined ||
          input.objectRepresentations.receiverCaptures.isCaptured(member) && capture === undefined) {
          diagnostics.push(objectIssue(member, "A native class field requires its exact carrier, selected name and physical storage fact."));
          continue;
        }
        fields.push(Object.freeze({ ...selected, carrier, targetName,
          initializer: sourceParameterIsProperty(ast, member) ? ast.name(member) : Node_Initializer(ast, member),
          storage: binding !== undefined ? Object.freeze({ kind: "frame", declaration: member })
            : capture !== undefined ? Object.freeze({ kind: "capture", selection: capture }) : Object.freeze({ kind: "value" }),
        }));
        if (frame?.storage.kind === "standalone" && frame.bindings.some(entry => entry.declaration === member)) continue;
        const handle = binding === undefined ? capture !== undefined && capture.kind !== "copy" : binding.storage === "location";
        storageFields.push(Object.freeze({ kind: "field", name: targetName, declaration: member,
          copy: !handle && (binding === undefined || binding.storage === "value" && binding.initialization === "ready") &&
            (binding?.entry?.copy ?? isRustCopyCarrier(carrier)),
          clone: handle ? Object.freeze({ kind: "unconditional" }) : Object.freeze({ kind: "required", carrier }),
        }));
      }
      const methodProperties: RustNativeClassDeclaration["methodProperties"][number][] = [];
      for (const usage of input.projectMethodProperties.usages) {
        const storage = usage.storage;
        if (storage === undefined || storage.owner !== declaration || storage.declaration !== usage.declaration) continue;
        methodProperties.push(Object.freeze({ declaration: storage.declaration, targetName: storage.targetName }));
        storageFields.push(Object.freeze({ kind: "method", declaration: storage.declaration, name: storage.targetName,
          copy: false, clone: Object.freeze({ kind: "unconditional" }) }));
      }
      if (definition.genericParameters.length !== 0) storageFields.push(marker(definition));
      form = Object.freeze({ kind: "class", name, definition, fields: Object.freeze(fields),
        methodProperties: Object.freeze(methodProperties), frameCounterName, physical: physical(definition, storageFields, input) });
    }
    if (!input.typeDefinitions.registerSourceObjectPhysicalDefinition(form.physical.definition)) {
      diagnostics.push(objectIssue(declaration, "A native object requires one complete physical-field definition registered exactly once."));
      continue;
    }
    objects.push({ declaration, form });
  }
  if (diagnostics.length !== 0) return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  for (const { declaration, form } of objects) {
    const requirements = form.physical.fields.flatMap(field => field.clone.kind === "required" ? [field.clone.carrier] : []);
    const clone = form.physical.fields.some(field => field.clone.kind === "unavailable") || requirements.some(carrier =>
      selectRustCloneRequirements(carrier, input.typeDefinitions, () => true, () => true).kind !== "available")
      ? Object.freeze({ kind: "unavailable" as const })
      : Object.freeze({ kind: "conditional" as const, requirements: Object.freeze(requirements) });
    forms.set(declaration, Object.freeze({ ...form, physical: Object.freeze({ ...form.physical, clone }) }));
  }
  const get = (declaration: Node) => forms.get(declaration);
  let completed = false;
  return { kind: "resolved", forms: Object.freeze({ get, complete(finalInput: Parameters<RustPreparedNativeDeclarationForms["complete"]>[0]) {
    if (completed) failTargetAnalysisInvariant("tsonic-rust", "Native declaration forms may be completed only once.");
    completed = true;
    const published = new WeakMap<Node, RustNativeDeclarationForm>();
    const diagnostics: TargetDiagnostic[] = [];
    for (const { declaration } of objects) {
      const prepared = forms.get(declaration);
      if (prepared === undefined) failTargetAnalysisInvariant("tsonic-rust", "A prepared native object lost its original field selection.", declaration);
      if (prepared.kind === "interface") {
        const selected = publishRustNativeInterfaceDeclaration(prepared, finalInput);
        if (selected.kind === "rejected") diagnostics.push(...selected.diagnostics);
        else if (selected.kind === "accepted") published.set(declaration, selected.form);
        continue;
      }
      const nativeInput = finalInput.nativeTypeInputFor(prepared.definition.fileName, undefined);
      const fields: RustNativeClassField[] = [];
      for (const field of prepared.fields) {
        const native = selectRustNativeTypeCarrier(field.carrier, nativeInput, "general");
        if (native.kind === "rejected") diagnostics.push({ code: "RUST_CLASS_FIELD_TYPE_NOT_REPRESENTABLE", category: "error",
          source: "tsonic-rust", sourceNode: field.declaration, message: native.reason });
        else fields.push(Object.freeze({ ...field, nativeCarrier: native.carrier }));
      }
      published.set(declaration, Object.freeze({ ...prepared, fields: Object.freeze(fields) }));
    }
    return diagnostics.length === 0 ? analyzeRustNativeDeclarationForms(finalInput, published)
      : { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  } }) };

  function marker(definition: RustNativeClassDeclaration["definition"]): RustNativeObjectPhysicalField {
    return Object.freeze({ kind: "marker", name: projectTypes.stateMarkerFieldName(definition), copy: true,
      clone: Object.freeze({ kind: "unconditional" }) });
  }
}

function physical(definition: RustNativeClassDeclaration["definition"], storageFields: readonly RustNativeObjectPhysicalField[],
  input: RustNativeObjectDeclarationInput): RustNativeObjectPhysicalDeclaration {
  const representation = input.objectRepresentations.representationFor(definition);
  if (representation === undefined) failTargetAnalysisInvariant("tsonic-rust",
    "A physical native object requires its selected representation.", definition.declaration);
  const fields: readonly RustNativeObjectPhysicalField[] = Object.freeze(representation.kind === "value" ? [...storageFields]
    : representation.kind === "shared-immutable" || representation.kind === "shared-mutable" ? [{
      kind: "state" as const, name: rustProjectObjectStateField, copy: false, clone: Object.freeze({ kind: "unconditional" as const }),
    }] : [{
      kind: "identity" as const, name: rustProjectObjectIdentityField, copy: false, clone: Object.freeze({ kind: "unconditional" as const }),
    }, {
      kind: "dispatch" as const, name: rustProjectObjectDispatchField, copy: false, clone: Object.freeze({ kind: "unconditional" as const }),
    }]);
  const raw: RustSourceObjectPhysicalDefinition = Object.freeze({ carrier: input.projectTypes.openCarrier(definition),
    fields: Object.freeze(fields.map(field => Object.freeze({ name: field.name, clone: field.clone }))) });
  return Object.freeze({ definition: raw, storageFields: Object.freeze([...storageFields]), fields,
    clone: Object.freeze({ kind: "unavailable" }) });
}

function objectIssue(sourceNode: Node, message: string): TargetDiagnostic {
  return Object.freeze({ code: "RUST_NATIVE_OBJECT_FIELDS_NOT_CLOSED", source: "tsonic-rust", category: "error", message,
    sourceNode, evidence: ["target.capability=rust.declaration.native-form"] });
}

export type AnalyzeRustNativeDeclarationFormsResult =
  | { readonly kind: "resolved"; readonly forms: RustNativeDeclarationForms }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

export function analyzeRustNativeDeclarationForms(
  input: RustNativeValueDeclarationInput & { readonly sourceFiles: readonly SourceFile[];
    readonly genericRequirements: RustDeclarationGenericRequirementIndex },
  forms: WeakMap<Node, RustNativeDeclarationForm>,
): AnalyzeRustNativeDeclarationFormsResult {
  const diagnostics: TargetDiagnostic[] = [];
  for (const sourceFile of input.sourceFiles) {
    for (const declaration of input.ast.statements(sourceFile)) {
      if (declaration === undefined) continue;
      const kind = input.ast.kindName(declaration);
      if (kind !== "KindEnumDeclaration" && kind !== "KindInterfaceDeclaration" && kind !== "KindTypeAliasDeclaration") continue;
      const admitted = admitRustNativeValueDeclaration(declaration, input, { get: declaration => forms.get(declaration) });
      if (admitted.kind === "accepted") forms.set(declaration, admitted.form);
      else if (admitted.kind === "rejected") diagnostics.push(...admitted.diagnostics);
    }
  }
  const implementations: RustNativeDeclarationForms["implementations"][number][] = [];
  for (const implementation of input.typeFamilies.implementations) {
    const contract = input.genericRequirements.contractForCarrier({ kind: "tuple",
      elements: [implementation.owner, implementation.output] });
    if (contract === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "A sealed type-family implementation has no completed native generic requirement contract.",
      implementation.family.kind === "conditional" ? implementation.family.declaration : undefined);
    const projectDefinition = input.projectTypes.definitionForCarrier(implementation.owner);
    const references = rustTargetGenericReferences(implementation.owner);
    if (projectDefinition === undefined &&
      (references.lifetimes.length !== 0 || references.constIdentities.length !== 0)) {
      diagnostics.push({ code: "RUST_TYPE_FAMILY_IMPLEMENTATION_NOT_CLOSED", category: "error",
        source: "tsonic-rust", message: "A checked type family implementation requires its exact native generic declaration contract.",
        ...(implementation.family.kind === "conditional" ? { sourceNode: implementation.family.declaration } : {}),
        evidence: ["target.capability=rust.declaration.native-form"] });
      continue;
    }
    let nativeTypes: RustNativeDeclarationForms["implementations"][number]["nativeTypes"] = null;
    if (implementation.family.kind === "conditional") {
      const nativeInput = input.nativeTypeInputFor(implementation.sourceFileName,
        rustGeneratedTypeParameterNames(contract.typeParameters, []));
      const owner = selectRustNativeTypeCarrier(implementation.owner, nativeInput, "general");
      const trait = selectRustNativeTypeCarrier({ ...implementation.family.trait,
        genericArguments: implementation.arguments }, nativeInput, "general");
      const output = selectRustNativeTypeCarrier(implementation.output, nativeInput, "general");
      const rejected = owner.kind === "rejected" ? owner : trait.kind === "rejected" ? trait
        : output.kind === "rejected" ? output : undefined;
      if (rejected !== undefined) {
        diagnostics.push({ code: "RUST_TYPE_FAMILY_NATIVE_TYPE_NOT_REPRESENTABLE", category: "error",
          source: "tsonic-rust", message: rejected.reason, sourceNode: implementation.family.declaration,
          evidence: ["target.capability=rust.declaration.native-form"] });
        continue;
      }
      if (owner.kind !== "resolved" || trait.kind !== "resolved" || output.kind !== "resolved") {
        return failTargetAnalysisInvariant("tsonic-rust",
          "A selected conditional implementation lost its admitted native type data.", implementation.family.declaration);
      }
      nativeTypes = Object.freeze({ owner: owner.carrier, trait: trait.carrier, output: output.carrier });
    }
    implementations.push(Object.freeze({ implementation, nativeTypes,
      ...(projectDefinition === undefined ? {} : { projectDefinition }) }));
  }
  return diagnostics.length > 0 ? { kind: "rejected", diagnostics: Object.freeze(diagnostics) }
    : { kind: "resolved", forms: Object.freeze({ implementations: Object.freeze(implementations),
      get(declaration: Node) { return forms.get(declaration); } }) };
}
