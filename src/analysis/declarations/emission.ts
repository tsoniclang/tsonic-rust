import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustDeclarationEmissionProducer } from "../program/records/declaration-emission.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function analyzeRustDeclarationEmission(input: {
  readonly program: Pick<RustTargetProgram, "source" | "records" | "projectTypes" | "classValues" | "callableValues" | "names">;
  readonly nodes: readonly Node[];
  readonly producer: RustDeclarationEmissionProducer;
  readonly required: RustRequiredRecord[];
}): void {
  const { program } = input;
  const { ast } = program.source;
  for (const node of input.nodes) {
    if (!ast.is.IsFunctionDeclaration(node) && !ast.is.IsFunctionExpression(node) && !ast.is.IsArrowFunction(node) &&
      !ast.is.IsMethodDeclaration(node) && !ast.is.IsGetAccessorDeclaration(node) && !ast.is.IsSetAccessorDeclaration(node)) continue;
    const operation = program.records.targetOperation.get(node);
    const leading = operation?.kind === "closure" ? operation.leadingParameters ?? [] : [];
    const selected = program.records.receiverIndependentMethod.get(node) === undefined ? leading : leading.filter(parameter => parameter.kind !== "this");
    const parameters = selected.map(parameter => {
      const reads: Node[] = [];
      const visit = (subject: Node): void => {
        const kind = ast.kindName(subject);
        if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
          if (rustTargetTypeRefEquals(program.records.runtimeCarrier.get(subject)?.carrier, parameter.carrier)) reads.push(subject);
          return;
        }
        if (subject !== node && (ast.is.IsFunctionExpression(subject) || ast.is.IsFunctionDeclaration(subject) ||
          ast.is.IsMethodDeclaration(subject) || ast.is.IsGetAccessorDeclaration(subject) || ast.is.IsSetAccessorDeclaration(subject) ||
          ast.is.IsClassDeclaration(subject) || ast.is.IsClassExpression(subject))) return;
        ast.forEachChild(subject, child => { if (child !== undefined) visit(child); });
      };
      if (parameter.kind === "this") visit(node);
      return Object.freeze({ ...parameter, reads: Object.freeze(reads) });
    });
    input.producer.leading(node, { parameters: Object.freeze(parameters) });
    requireRustRecord(input.required, "callableLeading", node, "native callable leading parameters", "analyzeRustDeclarationEmission");
  }
  for (const node of input.nodes) {
    if (!ast.is.IsClassDeclaration(node) || program.records.nativeUnreachable.get(node) === true ||
      program.records.compileTimeSource.get(node) !== undefined || program.records.nativeParticipation.get(node) === "erased") continue;
    const definition = program.projectTypes.definitionForDeclaration(node);
    if (definition === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class requires its native source definition.", node);
    const name = program.names.nameForDeclaration(node);
    if (name === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class requires its native declaration name.", node);
    input.producer.classDeclaration(node, { environmentBindingName: program.classValues.forDeclaration(node)?.environment?.bindingName,
      nonCamelCaseName: !/^[A-Z][A-Za-z0-9]*$/u.test(name) });
    requireRustRecord(input.required, "classDeclaration", node, "native class declaration", "analyzeRustDeclarationEmission");
  }
  const declarations = new Set(program.callableValues.nativeProducers.producers.map(producer => producer.declaration));
  for (const declaration of declarations) {
    input.producer.callable(declaration, { invocation: program.callableValues.nativeProducers.invocationResultFor(declaration),
      outward: program.callableValues.nativeProducers.outwardReturnFor(declaration) });
    requireRustRecord(input.required, "callableReturn", declaration, "native callable result", "analyzeRustDeclarationEmission");
  }
}
