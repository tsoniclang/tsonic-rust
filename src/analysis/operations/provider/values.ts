import { acceptRustPolicy } from "../../../policy/operations/contracts.js";
import { resolveSelectedProviderDeclaration } from "../../../policy/evidence/selected-source.js";
import { mapProviderCheckedOperation } from "./conversions.js";
import { rejectSelectedOperation } from "./result.js";
import { rustSelectedOperationKey } from "../../../target-model/facts/selections.js";
import {
  rustJsRegExpTargetId,
  rustStringTargetType,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTargetOperationFactKey } from "../../facts/keys.js";
import {
  selectedCallArgumentCarriers,
  selectedCallCalleeDeclaration,
  selectedCallCalleeSymbol,
} from "./operators.js";
import { selectRustProviderExport } from "../../../policy/operations/provider-selection.js";
import { checkedCallIsConstruction } from "./calls/instantiation.js";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedCallSelectionResult,
  RustCheckedValueSelectionInput,
  RustCheckedValueSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { RustTargetOperationFact } from "../../facts/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function selectRustCheckedValue(
  request: RustCheckedValueSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedValueSelectionResult> {
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
      { subject: request.sourceSelectedSymbol, precision: "exact" },
      { subject: request.expression, precision: "exact" },
    ],
  );
  if (providerEvidence.kind === "missing") {
    return acceptRustPolicy({ kind: "source" }, [
      { message: "rust source value has no selected provider declaration" },
    ]);
  }
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT",
      "Checked value carries conflicting selected provider declaration identities.",
    );
  }
  const providerExport = selectRustProviderExport(
    options.providerExports,
    providerEvidence.identity,
  );
  if (providerExport.kind === "missing") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_SELECTED_PROVIDER_EXPORT_MISSING",
      "Checked provider value evidence has no matching Rust provider export declaration.",
    );
  }
  if (providerExport.kind === "ambiguous") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_SELECTED_PROVIDER_EXPORT_AMBIGUOUS",
      "Checked provider value evidence matches more than one Rust provider export declaration.",
    );
  }
  if (providerExport.row.declarationKind !== "value") {
    return acceptRustPolicy({ kind: "source" }, [
      { message: `rust selected provider export is ${providerExport.row.declarationKind}, not a direct value` },
    ]);
  }
  return mapProviderCheckedOperation(
    request.expression,
    providerEvidence.identity,
    "property",
    context,
    options,
    undefined,
    [],
  );
}

export function mapSelectedRegExpConstruction(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const sourceArguments = request.source.sourceArguments;
  if (sourceArguments.length < 1 || sourceArguments.length > 2) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_SELECTED_ARITY_INVALID",
      "Selected RegExp construction must provide one pattern argument and at most one flags argument.",
    );
  }
  const [patternCarrier, flagsCarrier] = selectedCallArgumentCarriers(
    request,
    context,
    options,
  );
  if (patternCarrier === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_PATTERN_CARRIER_NOT_PROVEN",
      "Selected RegExp construction has no finalized pattern argument carrier.",
    );
  }
  const stringCarrier = rustStringTargetType();
  const patternKind = rustTargetTypeRefEquals(patternCarrier, stringCarrier)
    ? "string"
    : patternCarrier.kind === "target-named" &&
        patternCarrier.id === rustJsRegExpTargetId
      ? "regexp"
      : undefined;
  if (patternKind === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_PATTERN_CARRIER_UNSUPPORTED",
      "Selected RegExp pattern argument is neither the exact JS string carrier nor the exact RegExp carrier.",
    );
  }
  if (sourceArguments.length === 2 &&
    (flagsCarrier === undefined ||
      !rustTargetTypeRefEquals(flagsCarrier, stringCarrier))) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_FLAGS_CARRIER_NOT_PROVEN",
      "Selected RegExp flags argument has no finalized JS string carrier.",
    );
  }
  const invocation = checkedCallIsConstruction(request, context)
    ? "construct"
    : "call";
  const resultCarrier: TargetTypeRef = { kind: "target-named", id: "rust.js.JsRegExp" };
  const operationId = `tsonic.rust.js.regexp.create.${invocation}.${patternKind}.${flagsCarrier === undefined ? "default-flags" : "explicit-flags"}`;
  const targetOperation = patternKind === "string"
    ? "js_abi::JsRegExp::new"
    : invocation === "construct"
      ? "js_abi::JsRegExp::construct_from_regexp"
      : "js_abi::JsRegExp::call_from_regexp";
  const targetName = patternKind === "string"
    ? "new"
    : invocation === "construct"
      ? "construct_from_regexp"
      : "call_from_regexp";
  const fact: RustTargetOperationFact = {
    kind: "regexp-create",
    operationId,
    targetOperation,
    input: {
      kind: "selected-call",
      invocation,
      patternKind,
      patternCarrier,
      ...(flagsCarrier === undefined ? {} : { flagsCarrier }),
    },
    resultCarrier,
  };
  const evidence = [{ message: "rust selected RegExp constructor" }];
  context.facts.set(request.source.call, rustTargetOperationFactKey, fact, evidence);
  context.facts.set(request.source.call, rustSelectedOperationKey, {
    operationId: fact.operationId,
    operationKind: invocation === "construct" ? "constructor" : "method",
    targetOperation,
    resultType: resultCarrier,
    provenance: {
      sourceExpression: request.source.call,
      sourceCallee: request.source.sourceCallee.expression,
      sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: selectedCallCalleeSymbol(request),
      sourceResultType: request.source.sourceResultType,
    },
  }, evidence);
  return acceptRustPolicy({
    selectedSignature: {
      member: {
        id: fact.operationId,
        sourceName: invocation === "construct" ? "constructor" : "call",
        targetName,
        kind: invocation === "construct" ? "constructor" : "method",
        ...(invocation === "call" ? { static: true } : {}),
        parameters: [
          { name: "pattern", type: patternCarrier, passingMode: "by-value" },
          { name: "flags", type: stringCarrier, passingMode: "by-value", optional: true },
        ],
        returnType: resultCarrier,
      },
      ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(selectedCallCalleeSymbol(request) === undefined ? {} : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
      ...(selectedCallCalleeDeclaration(request) === undefined ? {} : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
      ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
      sourceArgumentBindings: request.source.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    },
  }, evidence);
}
