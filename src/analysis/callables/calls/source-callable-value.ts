import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustSourceCallableEmissionProducer } from "../../program/records/callables/source-callable-emission.js";
import type { RustSourceCallableValueFact } from "../../../target-model/records/operations/operation-selections.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCallableProtocol, rustUnitTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { isValidRustIdentifier } from "../../../target-model/names/identifiers.js";
import { rustNodeIsOutsideNativeCode } from "../../control-flow/compile-time-statements.js";

export function analyzeRustSourceCallableEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustSourceCallableEmissionProducer) {
  const issues: TargetDiagnostic[] = [];
  const types: TargetTypeRef[] = [];
  const values: RustSourceCallableValueFact[] = [];
  const requests = new Map<Node, Map<string, RustSourceCallableValueFact>>();
  const add = (value: RustSourceCallableValueFact | undefined): void => {
    if (value === undefined) return;
    const rows = requests.get(value.sourceDeclaration) ?? new Map<string, RustSourceCallableValueFact>();
    rows.set(closedMetadataKey(value.carrier), value);
    requests.set(value.sourceDeclaration, rows);
  };
  for (const node of nodes) {
    // A callable referenced from compile-time source (a safety builder target) is selected there, never constructed.
    if (rustNodeIsOutsideNativeCode(program.source.ast, program.records,
      expression => program.safetyApplications.operationForExpression(expression), node)) continue;
    add(program.records.sourceCallableValue.get(node));
    add(program.records.directCallableReference.get(node));
    const binding = program.records.moduleBinding.get(node);
    if (binding?.storage === "native-callable" && binding.value !== undefined) {
      const file = program.source.ast.getSourceFile(binding.callableDeclaration);
      if (file !== undefined) add({ form: "function", sourceDeclaration: binding.callableDeclaration,
        fileName: program.source.ast.getFileName(file), ...binding.value });
    }
    for (const value of program.records.lexicalValues.get(node) ?? []) add(value.value);
  }
  const refuse = (value: RustSourceCallableValueFact, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: value.sourceDeclaration,
      message: `${message} Node kind: ${program.source.ast.kindName(value.sourceDeclaration)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const rows of requests.values()) for (const value of rows.values()) {
    const lexical = program.lexicalFunctions.forDeclaration(value.sourceDeclaration);
    if (lexical?.kind === "unresolved") {
      refuse(value, "rust.backend.lexical-function-value", lexical.reason);
      continue;
    }
    const binding = lexical !== undefined && lexical.inlineValueReference === undefined
      ? program.names.callableValueNameForDeclaration(value.sourceDeclaration) : undefined;
    if (lexical !== undefined && lexical.inlineValueReference === undefined && (binding === undefined || !lexical.valueObserved)) {
      refuse(value, "rust.backend.lexical-function-value", "A lexical function value lost its exact activation-owned binding.");
      continue;
    }
    if (!isValidRustIdentifier(value.name)) {
      refuse(value, "rust.backend.callable-value-name", "Project-source callable values require a finalized hygienic-name scope.");
      continue;
    }
    values.push(value);
    if (rustGenericCallableValue(value.carrier) !== undefined) {
      producer.publish(value.sourceDeclaration, value.carrier, { binding, construction: Object.freeze({ kind: "generic" }) });
      continue;
    }
    if (value.carrier.kind === "function-pointer") {
      if (lexical !== undefined && lexical.captures.length !== 0) {
        refuse(value, "rust.backend.function-pointer-capture", "A native Rust function pointer cannot retain a lexical environment.");
        continue;
      }
      producer.publish(value.sourceDeclaration, value.carrier, { binding,
        construction: Object.freeze({ kind: "pointer", lexical: lexical !== undefined }) });
      continue;
    }
    const physical = program.callableValues.nativeProducers.physicalFor(value.sourceDeclaration, value.carrier);
    const error = program.callableValues.nativeProducers.errorFor(value.sourceDeclaration, "invoke");
    const captures = lexical === undefined ? [] : program.records.closureCapture.get(value.sourceDeclaration)?.captures;
    if (physical === undefined || error === undefined || captures === undefined) {
      refuse(value, "rust.backend.callable-value-error-boundary", "Project-source callable value has no exact error boundary.");
      continue;
    }
    const argumentsCarrier: TargetTypeRef = Object.freeze({ kind: "tuple", elements: value.parameterCarriers });
    types.push(physical, argumentsCarrier, error);
    producer.publish(value.sourceDeclaration, value.carrier, { binding, construction: Object.freeze({ kind: "callable",
      lexical: lexical !== undefined, physical, arguments: argumentsCarrier, captures,
      staticStorage: rustCallableProtocol(value.carrier)?.lifetime?.kind === "static",
      fallible: program.records.asyncFunction.get(value.sourceDeclaration) === undefined &&
        program.records.generator.get(value.sourceDeclaration) === undefined && program.records.fallible.get(value.sourceDeclaration) !== undefined,
      unit: rustTargetTypeRefEquals(value.resultCarrier, rustUnitTargetType()), error }) });
  }
  return { issues, types, values };
}
