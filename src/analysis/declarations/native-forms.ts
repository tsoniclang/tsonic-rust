import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeDeclarationForm, RustNativeDeclarationForms } from "../../target-model/records/native/native-declaration-forms.js";
import { admitRustNativeValueDeclaration, type RustNativeValueDeclarationInput } from "./native-value-declarations.js";
import { admitRustNativeInterfaceDeclaration, type RustNativeInterfaceDeclarationInput } from "./native-value-declarations.js";
import type { RustNativeDeclarationProducer } from "../program/records/native/native-declarations.js";
import type { RustDeclarationGenericRequirementIndex } from "./generic-requirements.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import type { RustStructuralShapePlan } from "../objects/shapes/structural-shape-plan.js";

export type AnalyzeRustNativeDeclarationFormsResult =
  | { readonly kind: "resolved"; readonly forms: RustNativeDeclarationForms }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

export function admitRustNativeInterfaceForms(
  input: RustNativeInterfaceDeclarationInput & { readonly sourceFiles: readonly SourceFile[] },
  producer: Pick<RustNativeDeclarationProducer, "interface">,
): readonly TargetDiagnostic[] {
  const diagnostics: TargetDiagnostic[] = [];
  for (const sourceFile of input.sourceFiles) for (const declaration of input.ast.statements(sourceFile)) {
    if (declaration === undefined || !input.ast.is.IsInterfaceDeclaration(declaration)) continue;
    const admitted = admitRustNativeInterfaceDeclaration(declaration, input);
    if (admitted.kind === "rejected") diagnostics.push(...admitted.diagnostics);
    else if (admitted.kind === "accepted") {
      if (admitted.form.kind !== "interface") failTargetAnalysisInvariant("tsonic-rust",
        "Native interface admission publishes only its original interface form.", declaration);
      producer.interface(declaration, admitted.form);
    }
  }
  return Object.freeze(diagnostics);
}

export function analyzeRustNativeDeclarationForms(
  input: RustNativeValueDeclarationInput & { readonly sourceFiles: readonly SourceFile[];
    readonly genericRequirements: RustDeclarationGenericRequirementIndex;
    readonly structuralShapes: RustStructuralShapePlan },
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
    if ((projectDefinition === undefined || implementation.family.kind === "indexed") &&
      (references.lifetimes.length !== 0 || references.constIdentities.length !== 0)) {
      diagnostics.push({ code: "RUST_TYPE_FAMILY_IMPLEMENTATION_NOT_CLOSED", category: "error",
        source: "tsonic-rust", message: "A checked type family implementation requires its exact native generic declaration contract.",
        ...(implementation.family.kind === "conditional" ? { sourceNode: implementation.family.declaration } : {}),
        evidence: ["target.capability=rust.declaration.native-form"] });
      continue;
    }
    const structural = rustStructuralObjectCarrierValue(implementation.owner);
    const shape = structural === undefined ? undefined : input.structuralShapes.definitionForCarrier(implementation.owner);
    if (structural !== undefined && shape === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An indexed native owner requires its completed structural storage definition.");
    const storage: RustNativeDeclarationForms["implementations"][number]["storage"] =
      structural?.representation === "reference" && shape !== undefined && shape.dispatchName === undefined
        ? Object.freeze({ kind: "structural-state", ownerFileName: shape.ownerFileName,
          targetName: shape.targetName, arguments: shape.genericArguments })
        : Object.freeze({ kind: "owner" });
    implementations.push(Object.freeze({ implementation, genericContract: contract, storage,
      ...(projectDefinition === undefined ? {} : { projectDefinition }) }));
  }
  return diagnostics.length > 0 ? { kind: "rejected", diagnostics: Object.freeze(diagnostics) }
    : { kind: "resolved", forms: Object.freeze({ implementations: Object.freeze(implementations),
      get(declaration: Node) { return forms.get(declaration); } }) };
}
