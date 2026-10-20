import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustSourceFileEmissionProducer } from "../program/records/source-file-emission.js";
import type { Node } from "@tsonic/tsts";
import { rustCarrierSupportsClone } from "../../target-model/types/index.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";

export function analyzeRustSourceFileEmission(program: Omit<RustTargetProgram, "reachability">,
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
      if (ast.is.IsExportAssignment(statement)) {
        const assignment = ast.as.AsExportAssignment(statement);
        const binding = program.records.moduleBinding.get(statement);
        const name = program.names.nameForDeclaration(statement);
        if (assignment === undefined || assignment.IsExportEquals === true || assignment.Expression === undefined ||
          binding?.storage !== "module-cell" || name === undefined || !isValidRustIdentifier(name)) {
          refuse(statement, "rust.backend.default-export", "Default exports require one exact expression, binding name, and finalized module-cell snapshot.");
          continue;
        }
        if (!rustCarrierSupportsClone(binding.valueCarrier, program.typeDefinitions)) {
          refuse(statement, "rust.backend.default-export-carrier", "Default export snapshots require one exact Clone-capable Rust value carrier.");
          continue;
        }
        producer.export(statement, { expression: assignment.Expression, name, carrier: binding.valueCarrier });
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
}
