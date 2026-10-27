import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourceFileEmissionProducer } from "../program/records/program/source-file-emission.js";
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import { rustCarrierSupportsClone } from "../../policy/constraints/native-traits.js";
import { Node_Initializer } from "@tsonic/target-api/source";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import { rustSourceItemIdentity } from "../../target-model/names/source-output-identities.js";

export function analyzeRustSourceFileEmission(program: Omit<RustAnalysisProgram, "reachability">,
  producer: RustSourceFileEmissionProducer): readonly TargetDiagnostic[] {
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push(Object.freeze({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: Object.freeze([`target.capability=${capability}`]) }));
  };
  for (const definition of program.projectTypes.definitions)
    producer.type(definition.declaration, program.projectTypes.isPolymorphic(definition) ? "polymorphic" : "ordinary");
  for (const file of program.sourceFiles) {
    const fileName = ast.getFileName(file);
    const requirement = program.moduleInitialization.requirementFor(file);
    if (requirement.kind === "unresolved") {
      refuse(requirement.node, "rust.backend.module-initialization-facts", requirement.reason);
      continue;
    }
    const region = program.errorRegions.get(file);
    if (region === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted source module requires its exact finalized error region.", file);
    const classes = program.projectTypes.definitions.filter(definition => definition.sourceFile === file && definition.kind === "class");
    producer.file(file, {
      instanceViewOwners: Object.freeze([...new Set(program.classValues.instanceViewImplementations
        .filter(view => view.ownerFileName === fileName).map(view => view.declaration))]),
      constructorViewOwners: Object.freeze([...new Set(program.classValues.constructorViewImplementations
        .filter(view => view.ownerFileName === fileName).map(view => view.declaration))]),
      classes: Object.freeze(classes.map(definition => Object.freeze({ definition,
        local: ast.parent(definition.declaration) !== file,
        polymorphic: producer.records.moduleTypeForm.get(definition.declaration) === "polymorphic" }))),
      initialization: Object.freeze({ required: requirement.kind === "required",
        asynchronous: program.errorRegions.initialization.moduleFor(file)?.asynchronous === true, region }),
    });
    for (const statement of ast.statements(file)) {
      if (statement === undefined) failTargetAnalysisInvariant("tsonic-rust", "A checked module requires its dense top-level statement inventory.", file);
      if (ast.is.IsVariableStatement(statement)) {
        const declarations: Node[] = [];
        const visit = (node: Node): void => {
          if (ast.kindName(node) === "KindVariableDeclaration") { declarations.push(node); return; }
          ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
        };
        visit(statement);
        if (declarations.length === 0) refuse(statement, "rust.backend.module-binding",
          "Top-level variable statements require at least one exact variable declaration.");
        for (const declaration of declarations) admitBinding(declaration, statement);
      }
      if (ast.is.IsExportAssignment(statement)) {
        const assignment = ast.as.AsExportAssignment(statement);
        const binding = program.records.moduleBinding.get(statement);
        const name = program.names.nameForDeclaration(statement);
        if (assignment === undefined || assignment.IsExportEquals === true || assignment.Expression === undefined ||
          binding?.storage !== "module-cell" || name === undefined || !isValidRustIdentifier(name)) {
          refuse(statement, "rust.backend.default-export", "Default exports require one exact expression, binding name, and finalized module-cell snapshot.");
          continue;
        }
        const physical = program.callableValues.nativeStorage.valueFor(assignment.Expression);
        if (physical.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust", physical.reason, statement);
        if (!rustCarrierSupportsClone(physical.carrier, program.typeDefinitions)) {
          refuse(statement, "rust.backend.default-export-carrier", "Default export snapshots require one exact Clone-capable Rust value carrier.");
          continue;
        }
        producer.export(statement, { expression: assignment.Expression, name, carrier: physical.carrier });
      }
      if (!ast.is.IsFunctionDeclaration(statement) || program.records.nativeParticipation.get(statement) === "erased") continue;
      const binding = program.records.moduleBinding.get(statement);
      const storage = program.records.moduleCallableStorage.get(statement);
      if (binding?.storage !== "native-callable" || binding.value === undefined) continue;
      if (storage === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted module callable value requires its finalized native storage.", statement);
      if (storage.kind !== "stored") continue;
      const carrier = program.callableValues.nativeProducers.physicalFor(statement, binding.value.carrier);
      if (carrier === undefined || !rustCarrierSupportsClone(binding.value.carrier, program.typeDefinitions)) {
        refuse(statement, "rust.backend.hoisted-callable-value", "Observed function declarations require one exact renderable Clone-capable callable value.");
        continue;
      }
      producer.hoisted(statement, carrier);
    }
  }
  return Object.freeze(issues);

  function admitBinding(declaration: Node, statement: Node): void {
    // An ambient (declare) binding is type-only: it has no native module binding.
    if (program.records.compileTimeSource.get(declaration) || program.records.typeOnlyDeclaration.get(declaration) !== undefined) return;
    const binding = program.records.moduleBinding.get(declaration);
    const initializer = Node_Initializer(ast, declaration);
    if (binding?.storage === "module-pattern") {
      for (const step of binding.steps) if (step.kind === "binding") admitBinding(step.declaration, statement);
      return;
    }
    const name = program.names.nameForDeclaration(declaration);
    const isPatternLeaf = ast.kindName(declaration) !== "KindVariableDeclaration";
    if (binding === undefined || name === undefined || !isValidRustIdentifier(name) || !isPatternLeaf && (
      initializer === undefined && (binding.storage !== "module-cell" || binding.initialization !== "declaration") ||
      initializer !== undefined && binding.storage === "module-cell" && binding.initialization !== "value")) {
      refuse(declaration, "rust.backend.module-binding",
        "Top-level bindings require a plain Rust identifier and one finalized module-binding fact matching their initialization.");
      return;
    }
    if (binding.storage === "native-callable" && binding.value !== undefined) {
      const storage = program.records.moduleCallableStorage.get(declaration);
      if (storage === undefined) failTargetAnalysisInvariant("tsonic-rust", "Module callable values require their finalized native storage selection.", declaration);
      if (storage.kind === "stored") {
        const carrier = program.callableValues.nativeProducers.physicalFor(binding.callableDeclaration, binding.value.carrier);
        if (carrier === undefined || !rustCarrierSupportsClone(binding.value.carrier, program.typeDefinitions)) {
          refuse(declaration, "rust.backend.module-callable-value", "Observed module callable values require one exact renderable Clone-capable carrier.");
          return;
        }
        producer.hoisted(declaration, carrier);
      }
    }
    let physical: TargetTypeRef | undefined;
    if (binding.storage !== "native-callable") {
      if (isPatternLeaf) physical = program.records.bindingProjectionEmission.get(declaration)?.fact.bindingCarrier;
      else {
        const selected = program.records.localBinding.get(declaration);
        if (selected?.kind === "value") physical = selected.nativeCarrier;
      }
      if (physical === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted module binding requires its completed physical native storage.", declaration);
    }
    if (binding.storage === "module-cell" && !rustCarrierSupportsClone(physical, program.typeDefinitions)) {
      refuse(declaration, "rust.backend.module-binding-carrier", "Runtime module bindings require one exact Clone-capable Rust value carrier.");
      return;
    }
    const literal = initializer === undefined ? undefined : program.records.literalValue.get(initializer);
    const stringConstant = binding.storage === "native-const" && isRustStringCarrier(binding.valueCarrier);
    if (stringConstant && literal?.form !== "string" && literal?.form !== "template")
      failTargetAnalysisInvariant("tsonic-rust", "A native string constant requires its exact checked source literal.", declaration);
    const file = ast.getSourceFile(declaration);
    const fileName = file === undefined ? undefined : ast.getFileName(file);
    const component = fileName === undefined ? undefined : program.records.sourcePackageComponents.get()?.find(
      selected => selected.sourceFileNames.has(fileName));
    if (component === undefined || fileName === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted module binding requires its exact source component.", declaration);
    producer.binding(declaration, { name,
      visibility: ast.hasModifierKind(statement, "export") || component.publishesImplementationAbi ||
        component.publicImplementationItemIdentities.has(rustSourceItemIdentity(fileName, name)) ? "public" : "crate",
      initializer, staticString: stringConstant ? literal?.text : undefined });
  }
}
