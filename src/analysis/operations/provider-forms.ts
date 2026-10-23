import type { Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProviderFormProducer } from "../program/records/provider-forms.js";
import type { RustProviderFormEmission } from "../../target-model/records/provider-forms.js";
import { isRustFinalizedSourceInput } from "../../target-model/operations/finalized-inputs.js";
import { rustGeneratorSourceInvocationKind } from "../../policy/operations/source-profiles/generator-source-profile.js";

export function analyzeRustProviderForms(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[],
  producer: RustProviderFormProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  // A provider disposer is planned at its resource declaration, outside the source operation occurrences.
  const disposals = nodes.flatMap(node => {
    const target = program.records.resourceManagement.get(node)?.disposal.target;
    return target?.form === "provider" ? [{ node, abi: target.abi, runtimeSet: false }] : [];
  });
  const occurrences = program.physicalEmissionContexts.sourceOccurrences.map(occurrence =>
    ({ node: occurrence.node, abi: occurrence.operation.abi, runtimeSet: occurrence.operation.kind === "runtime-set" }));
  for (const { node, abi, runtimeSet } of [...occurrences, ...disposals]) {
    const form = abi.target;
    const owner = sourceEnclosingCallable(node, ast);
    const native = owner === undefined ? undefined : program.records.callableDeclaration.get(owner)?.nativeBody;
    const bodies: (true | undefined)[] = native === undefined ? [undefined]
      : program.promiseBodies.objects.has(owner!) ? [undefined, true] : [true];
    let worker: RustProviderFormEmission["worker"];
    let nativeResult: RustProviderFormEmission["nativeResult"];
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "provider-operation" && rustGeneratorSourceInvocationKind(operation.operationId) === "sync") {
      const edges = program.records.sourceErrorEffects.get(node)?.edges;
      nativeResult = edges?.length === 1 ? edges[0] : undefined;
      if (nativeResult === undefined || program.records.generator.get(nativeResult.declaration) === undefined) {
        issues.push({ code: "RUST_GENERATOR_BODY_ERRORS_NOT_CLOSED", category: "error", source: "tsonic-rust", sourceNode: node,
          message: "A generator resume result requires its exact admitted body error correspondence before rendering.",
          evidence: ["target.capability=rust.generator.exact-body-errors"] });
        continue;
      }
    }
    if (form.form === "source-module-construction") {
      const construction = program.sourceModuleConstructions.construction(node);
      if (construction === undefined || construction.sourceArgumentIndex !== form.sourceArgumentIndex ||
        construction.targetArgumentIndex !== form.targetArgumentIndex)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted source-module constructor requires its exact source construction.", node);
      const argumentIndex = abi.targetArguments.findIndex(input => input.source.kind === "argument" && input.source.sourceIndex === form.sourceArgumentIndex);
      const input = abi.targetArguments[argumentIndex];
      const fileName = ast.getFileName(construction.targetSourceFile);
      const entry = program.records.workerEntries.get()?.find(entry => entry.fileName === fileName);
      if (input === undefined || !isRustFinalizedSourceInput(input) || input.source.kind !== "argument" ||
        input.mode !== "ref" && input.mode !== "value" || entry === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted source-module constructor requires its worker identity and immutable source argument.", node);
      worker = Object.freeze({ fileName, argumentIndex, mode: input.mode });
    }
    for (const body of bodies) {
      if (producer.records.providerForm.get(node, abi, body) !== undefined) continue;
      let read: RustProviderFormEmission["read"] = "storage";
      if (!runtimeSet && (form.form === "field" || form.form === "index")) {
        const carrier = abi.result.kind === "async" ? abi.result.futureCarrier : abi.result.carrier;
        const physical = program.records.carrierRead.get(carrier);
        if (physical === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted provider read requires its exact native carrier guarantees.", node);
        const clone = owner === undefined ? physical.clone : program.records.carrierClone.get(carrier, owner, body);
        if (physical.copy) read = "copy";
        else if (clone === true) read = "clone";
        else if (program.ownership.reads.get(node)?.source.kind !== "borrow") {
          issues.push({ code: "RUST_UNSUPPORTED_AST", source: "tsonic-rust", category: "error", sourceNode: node,
            message: `A provider ${form.form} read requires an exact Copy or Clone result-carrier contract. Node kind: ${ast.kindName(node)}.`,
            evidence: [`target.capability=rust.backend.provider-${form.form}-read-ownership`] });
          continue;
        }
      }
      producer.publish(node, abi, body, { read, worker, nativeResult });
    }
  }
  return Object.freeze(issues);
}
