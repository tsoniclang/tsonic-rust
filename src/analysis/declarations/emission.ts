import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustDeclarationEmissionProducer } from "../program/records/declaration-emission.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";

export function analyzeRustDeclarationEmission(input: {
  readonly program: Pick<RustTargetProgram, "source" | "records" | "projectTypes" | "classValues" | "callableValues">;
  readonly nodes: readonly Node[];
  readonly producer: RustDeclarationEmissionProducer;
  readonly required: RustRequiredRecord[];
}): void {
  const { program } = input;
  for (const node of input.nodes) {
    if (!program.source.ast.is.IsClassDeclaration(node) || program.records.nativeUnreachable.get(node) === true ||
      program.records.compileTimeSource.get(node) !== undefined || program.records.nativeParticipation.get(node) === "erased") continue;
    const definition = program.projectTypes.definitionForDeclaration(node);
    if (definition === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class requires its native source definition.", node);
    input.producer.classDeclaration(node, { environmentBindingName: program.classValues.forDeclaration(node)?.environment?.bindingName });
    requireRustRecord(input.required, "classDeclaration", node, "native class declaration", "analyzeRustDeclarationEmission");
  }
  const declarations = new Set(program.callableValues.nativeProducers.producers.map(producer => producer.declaration));
  for (const declaration of declarations) {
    input.producer.callable(declaration, { invocation: program.callableValues.nativeProducers.invocationResultFor(declaration),
      outward: program.callableValues.nativeProducers.outwardReturnFor(declaration) });
    requireRustRecord(input.required, "callableReturn", declaration, "native callable result", "analyzeRustDeclarationEmission");
  }
}
