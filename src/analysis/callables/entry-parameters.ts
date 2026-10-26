import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustNativeCallableProducerPlan } from "../../target-model/records/native-producers.js";
import type { RustNativeCallableGenericHeader } from "../../target-model/records/native-generics.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustDeclarationEmissionProducer } from "../program/records/declaration-emission.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";
import type { RustNativeStorageConstruction } from "./native-storage.js";
import { selectRustCallableEntryGenerics } from "./entry-generics.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closeRustRetainedCallableCarrier } from "../../policy/ownership/retained-storage.js";
import { rustStaticLifetime } from "../../target-model/lifetimes/index.js";

export function analyzeRustCallableEntryParameters(input: {
  readonly source: TargetSourceProgram;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly lifetimes: RustLifetimeIndex;
  readonly nativeStorage: RustNativeStorageConstruction;
  readonly native: Pick<RustNativeCallableInputPlan, "inputsFor" | "isNativeRetainedParameter">;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly producer: RustDeclarationEmissionProducer;
  readonly required: RustRequiredRecord[];
}): readonly TargetDiagnostic[] {
  const { ast } = input.source;
  const issues: TargetDiagnostic[] = [];
  const headers = new Map<Node, RustNativeCallableGenericHeader>();
  const declarations = new Set(input.nodes.filter(node => ast.is.IsFunctionDeclaration(node) ||
    ast.is.IsFunctionExpression(node) || ast.is.IsArrowFunction(node) || ast.is.IsMethodDeclaration(node) ||
    ast.is.IsGetAccessorDeclaration(node) || ast.is.IsSetAccessorDeclaration(node)));
  const sourceParameters = new Map<Node, Map<Node, TargetTypeRef>>();
  for (const parameter of input.nodes) {
    if (!ast.is.IsParameterDeclaration(parameter)) continue;
    const abi = input.records.sourceParameterAbi.get(parameter);
    if (abi === undefined) continue;
    const owner = ast.parent(parameter);
    if (owner === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native parameter requires its checked callable owner.", parameter);
    const requiresImplementation = input.native.inputsFor(owner).some(selected => selected.subject.node === parameter);
    const physical = requiresImplementation ? input.nativeStorage.parameterFor(parameter) : undefined;
    if (physical?.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust",
      "An admitted native parameter requires its finalized physical callable storage.", parameter);
    const carrier = physical?.carrier ?? (input.native.isNativeRetainedParameter(parameter)
      ? closeRustRetainedCallableCarrier(abi.parameterCarrier, rustStaticLifetime) : abi.parameterCarrier);
    const parameters = sourceParameters.get(owner) ?? new Map<Node, TargetTypeRef>();
    parameters.set(parameter, carrier);
    sourceParameters.set(owner, parameters);
    declarations.add(owner);
  }
  for (const { declaration } of input.nativeProducers.producers) {
    declarations.add(declaration);
    const selected = selectRustCallableEntryGenerics({ ...input, ast }, declaration);
    if (selected.kind === "rejected") issues.push(...selected.diagnostics);
    else headers.set(declaration, selected.value);
  }
  if (issues.length !== 0) return Object.freeze(issues);
  for (const node of declarations) {
    const operation = input.records.targetOperation.get(node);
    const leading = operation?.kind === "closure" ? operation.leadingParameters ?? [] : [];
    const selected = input.records.receiverIndependentMethod.get(node) === undefined ? leading : leading.filter(parameter => parameter.kind !== "this");
    const parameters = selected.map(parameter => {
      const reads: Node[] = [];
      const visit = (subject: Node): void => {
        const kind = ast.kindName(subject);
        if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
          if (rustTargetTypeRefEquals(input.records.runtimeCarrier.get(subject)?.carrier, parameter.carrier)) reads.push(subject);
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
    input.producer.leading(node, { parameters: Object.freeze(parameters), genericHeader: headers.get(node),
      sourceParameters: sourceParameters.get(node) ?? new Map<Node, TargetTypeRef>() });
    requireRustRecord(input.required, "callableLeading", node, "native callable entry parameters", "analyzeRustCallableEntryParameters");
  }
  return Object.freeze(issues);
}
