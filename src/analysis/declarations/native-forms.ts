import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeDeclarationForm, RustNativeDeclarationForms } from "../../target-model/records/native-declaration-forms.js";
import { admitRustNativeValueDeclaration, type RustNativeValueDeclarationInput } from "./native-value-declarations.js";
import type { RustDeclarationGenericRequirementIndex } from "./generic-requirements.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustGeneratedTypeParameterNames } from "../../target-model/names/type-parameters.js";
import { selectRustNativeTypeCarrier } from "../../policy/types/model/native-type-selection.js";

export type AnalyzeRustNativeDeclarationFormsResult =
  | { readonly kind: "resolved"; readonly forms: RustNativeDeclarationForms }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

export function analyzeRustNativeDeclarationForms(
  input: RustNativeValueDeclarationInput & { readonly sourceFiles: readonly SourceFile[];
    readonly genericRequirements: RustDeclarationGenericRequirementIndex },
): AnalyzeRustNativeDeclarationFormsResult {
  const forms = new WeakMap<Node, RustNativeDeclarationForm>();
  const diagnostics: TargetDiagnostic[] = [];
  for (const sourceFile of input.sourceFiles) {
    for (const declaration of input.ast.statements(sourceFile)) {
      if (declaration === undefined) continue;
      const kind = input.ast.kindName(declaration);
      if (kind !== "KindEnumDeclaration" && kind !== "KindInterfaceDeclaration" && kind !== "KindTypeAliasDeclaration") continue;
      const admitted = admitRustNativeValueDeclaration(declaration, input);
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
