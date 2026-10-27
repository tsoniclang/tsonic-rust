import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import { getRustGeneratorProtocol } from "../../target-model/types/carriers/callables.js";
import { rustUninhabitedError } from "../../policy/conversions/callable-physical.js";
import { rustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import type { RustDeclarationEmissionProducer } from "../program/records/program/declaration-emission.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function analyzeRustDeclarationEmission(input: {
  readonly program: Pick<RustAnalysisProgram, "source" | "sourceFiles" | "records" | "projectTypes" | "classValues" | "callableValues" | "names" | "projectConstructions" | "safetyApplications" | "errorRegions">;
  readonly nodes: readonly Node[];
  readonly producer: RustDeclarationEmissionProducer;
  readonly required: RustRequiredRecord[];
}): readonly TargetDiagnostic[] {
  const { program } = input;
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  for (const sourceFile of program.sourceFiles) {
    const scopes = program.projectTypes.definitions.filter(definition => definition.sourceFile === sourceFile)
      .flatMap(definition => {
        const scope = program.names.scopeForDeclaration(definition.declaration);
        return scope === undefined ? [] : [scope];
      });
    input.producer.sourceFile(sourceFile, scopes);
  }
  for (const node of input.nodes) {
    if ((!ast.is.IsClassDeclaration(node) && !ast.is.IsClassExpression(node)) || program.records.nativeUnreachable.get(node) === true ||
      program.records.compileTimeSource.get(node) !== undefined || program.records.nativeParticipation.get(node) === "erased") continue;
    const definition = program.projectTypes.definitionForDeclaration(node);
    if (definition === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class requires its native source definition.", node);
    const name = program.names.nameForDeclaration(node);
    if (name === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class requires its native declaration name.", node);
    const environment = program.classValues.forDeclaration(node)?.environment;
    const construction = program.projectConstructions.forDefinition(definition);
    const layer = construction?.layers[construction.layers.length - 1];
    const constructor = layer?.constructor;
    const applications = [...program.safetyApplications.forDeclaration(node),
      ...(constructor === undefined ? [] : program.safetyApplications.forDeclaration(constructor))]
      .filter(application => application.applicationPlacement === "constructor");
    const unsafe = applications.length !== 0 && applications.every(application => application.contract === "requires-unsafe");
    const publiclyConstructible = constructor === undefined || !ast.hasModifierKind(constructor, "private") && !ast.hasModifierKind(constructor, "protected");
    const defaultConstructor = layer?.signature.targetName === "new" && layer.signature.parameters.length === 0 &&
      !environment?.instancesUseEnvironment && !environment?.initializationUsesEnvironment && publiclyConstructible && !unsafe &&
      program.records.fallible.get(constructor ?? node) === undefined ? layer.signature.targetName : undefined;
    input.producer.classDeclaration(node, { environmentBindingName: environment?.bindingName,
      nonCamelCaseName: !/^[A-Z][A-Za-z0-9]*$/u.test(name), defaultConstructor, scope: program.names.scopeForDeclaration(node) });
    requireRustRecord(input.required, "classDeclaration", node, "native class declaration", "analyzeRustDeclarationEmission");
  }
  const declarations = new Set(program.callableValues.nativeProducers.producers.map(producer => producer.declaration));
  for (const node of input.nodes) if (ast.body(node) !== undefined && !rustProgramNodeIsOutsideNativeCode(program, node) &&
    program.records.sourceCallableReturn.get(node) !== undefined) declarations.add(node);
  for (const declaration of declarations) {
    const destination = program.callableValues.nativeStorage.returnFor(declaration);
    if (destination.kind === "unresolved") {
      issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: declaration,
        message: `${destination.reason} Node kind: ${ast.kindName(declaration)}.`, evidence: ["target.capability=rust.backend.value-destination"] });
      continue;
    }
    const outward = program.callableValues.nativeProducers.outwardReturnFor(declaration);
    const generator = outward === undefined ? undefined : getRustGeneratorProtocol(outward)?.physical;
    if (program.records.generator.get(declaration) !== undefined && generator === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted generator requires its selected physical error protocol.", declaration);
    const generatorError = generator === undefined ? undefined : mapRustTargetTypes(generator.errorCarrier, carrier => {
      const reference = rustProducerErrorReference(carrier);
      if (reference === undefined) return carrier;
      const selected = program.errorRegions.producerError(reference);
      if (selected === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted generator requires its completed physical producer error carrier.", declaration);
      return selected;
    });
    input.producer.callable(declaration, { invocation: program.callableValues.nativeProducers.invocationResultFor(declaration), outward,
      generatorError: generatorError === undefined ? undefined : Object.freeze({ carrier: generatorError,
        uninhabited: rustUninhabitedError(generatorError) }),
      destination: destination.kind === "identity" ? Object.freeze({ kind: "identity" })
        : Object.freeze({ kind: "selected", carrier: destination.carrier }) });
    requireRustRecord(input.required, "callableReturn", declaration, "native callable result", "analyzeRustDeclarationEmission");
  }
  return Object.freeze(issues);
}
