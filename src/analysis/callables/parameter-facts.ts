import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { KindArrayBindingPattern, KindObjectBindingPattern, Node_Initializer, Node_Name, sourceCallableValueParameters } from "@tsonic/target-api/source";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { requireRustRecord } from "../program/records/required-records.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { resolveRustContextualParameterAbi } from "./source-callable-abi.js";
import type { RustSourceParameterAbiFact } from "../../target-model/records/callables-and-resources.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { recordBindingPatternFacts } from "../control-flow/binding-patterns.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { requireDenseSourceNodes } from "../source-evidence/dense-nodes.js";

export function resolveParameterAbi(walk: RustFactWalk, parameter: Node) {
  return walk.sourceCallableAbi.resolveParameterAbi(
    parameter,
    rustResolutionContext(walk, parameter),
    walk.operationOptions,
  );
}

export function recordParameterAbiFacts(walk: RustFactWalk, parameter: Node, selectedCarrier?: TargetTypeRef): void {
  const parameterAbi = selectedCarrier === undefined ? resolveParameterAbi(walk, parameter)
    : resolveRustContextualParameterAbi(parameter, selectedCarrier, rustResolutionContext(walk, parameter), walk.operationOptions);
  if (parameterAbi === undefined) {
    refuseRustParameterCarrier(walk, parameter);
    return;
  }
  recordRustParameterAbiSelection(walk, parameter, parameterAbi);
}

function refuseRustParameterCarrier(walk: RustFactWalk, parameter: Node): void {
  appendRustDiagnostic(
    walk,
    "RUST_PARAMETER_CARRIER_UNSUPPORTED",
    "Parameter type has no closed Rust runtime carrier under the selected source-profile and surface policy.",
    parameter,
    ["target.capability=rust.callable.parameter-carrier"],
  );
}

/** A callable whose signature cannot be finalized is refused at each parameter that has no closed native carrier. */
export function refuseRustUnresolvedParameterCarriers(walk: RustFactWalk, declaration: Node): void {
  const parameters = sourceCallableValueParameters(walk.context.ast, declaration, walk.context.semanticsFor(declaration));
  if (parameters === undefined) return;
  for (const parameter of parameters) {
    if (parameter === undefined || walk.context.records.sourceParameterAbi.get(parameter) !== undefined) continue;
    if (resolveParameterAbi(walk, parameter) === undefined) refuseRustParameterCarrier(walk, parameter);
  }
}

export function recordRustParameterAbiSelection(
  walk: RustFactWalk,
  parameter: Node,
  parameterAbi: RustSourceParameterAbiFact,
): boolean {
  const { records } = walk.context;
  records.assertOpen();
  const finalized = records.sourceParameterAbi.get(parameter);
  if (finalized !== undefined && !closedMetadataEquals(finalized, parameterAbi)) {
    failTargetAnalysisInvariant("tsonic-rust",
      "Conflicting Rust semantic plan 'tsonic.rust.sourceParameterAbi' for one exact source subject.", parameter);
  }
  if (walk.finalizedParameters.has(parameter)) return true;
  requireRustRecord(walk.context.requiredRecords, "sourceParameterAbi", parameter,
    parameterAbi.form, "recordRustParameterAbiSelection");
  if (setCarrierFact(walk, parameter, parameterAbi.valueCarrier) === undefined) return false;
  if (finalized === undefined) records.sourceParameterAbis.parameter(parameter, parameterAbi);
  const name = Node_Name(walk.context.ast, parameter);
  const nameKind = name === undefined ? "" : walk.context.ast.kindName(name);
  if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
    !recordBindingPatternFacts(walk, name, parameterAbi.valueCarrier)) {
    appendRustDiagnostic(
      walk,
      "RUST_BINDING_PATTERN_NOT_CLOSED",
      "Parameter binding pattern has no total Rust projection from its exact finalized source carrier.",
      name,
      ["target.capability=rust.binding-pattern.parameter"],
    );
    return false;
  }
  walk.finalizedParameters.add(parameter);
  return true;
}

export function recordCallableDefaultParameterFacts(walk: RustFactWalk, declaration: Node): boolean {
  const { ast, records } = walk.context;
  const parameters = requireDenseSourceNodes(walk,
    sourceCallableValueParameters(ast, declaration, walk.context.semanticsFor(declaration)),
    "Default parameter analysis requires exact callable parameter nodes.");
  if (parameters === undefined) return false;
  for (const parameter of parameters) {
    if (Node_Initializer(ast, parameter) === undefined) continue;
    const abi = records.sourceParameterAbi.get(parameter);
    if (abi === undefined) {
      appendRustDiagnostic(walk, "RUST_DEFAULT_PARAMETER_ABI_MISSING",
        "A default parameter body requires its exact finalized signature ABI.", parameter,
        ["target.capability=rust.callable.default-parameter"]);
      return false;
    }
    if (!recordDefaultParameterInitializerFacts(walk, parameter, abi)) return false;
  }
  return true;
}

function recordDefaultParameterInitializerFacts(
  walk: RustFactWalk,
  parameter: Node,
  abi: RustSourceParameterAbiFact,
): boolean {
  if (abi.form !== "default") {
    return true;
  }
  const initializer = Node_Initializer(walk.context.ast, parameter);
  const resolved = initializer === undefined
    ? undefined
    : resolveExpressionCarrier(
        walk,
        initializer,
        walk.context.semanticsFor(initializer).sourceFile,
        abi.valueCarrier,
      );
  if (initializer !== undefined && resolved !== undefined &&
    rustTargetTypeRefEquals(resolved, abi.valueCarrier)) {
    return true;
  }
  appendRustDiagnostic(
    walk,
    "RUST_DEFAULT_PARAMETER_INITIALIZER_CARRIER_UNSUPPORTED",
    "Default parameter initializer does not have the exact finalized Rust value carrier.",
    initializer ?? parameter,
    ["target.capability=rust.callable.default-parameter"],
  );
  return false;
}
