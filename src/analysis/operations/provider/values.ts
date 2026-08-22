import { acceptRustPolicy } from "../../../policy/operations/contracts.js";
import { resolveSelectedProviderDeclaration } from "../../../policy/evidence/selected-source.js";
import { mapProviderCheckedOperation } from "./conversions.js";
import { rejectSelectedOperation } from "./result.js";
import {
  rustSelectedCallKey,
  rustSelectedOperationKey,
} from "../../../target-model/facts/selections.js";
import {
  isRustUndefinedCarrier,
  rustJsRegExpTargetId,
  rustJsStringTargetType,
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
import type {
  RustSelectedTargetSignature,
  TargetTypeRef,
} from "../../../target-model/types/model.js";

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
  if (sourceArguments.length > 2) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_SELECTED_ARITY_INVALID",
      "Selected RegExp construction must provide at most one pattern and one flags argument.",
    );
  }
  const [patternCarrier, flagsCarrier] = selectedCallArgumentCarriers(
    request,
    context,
    options,
  );
  if (sourceArguments.length > 0 && patternCarrier === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_PATTERN_CARRIER_NOT_PROVEN",
      "Selected RegExp construction has no finalized pattern argument carrier.",
    );
  }
  const stringCarrier = rustJsStringTargetType();
  const patternKind = sourceArguments.length === 0
    ? "omitted"
    : patternCarrier !== undefined && rustTargetTypeRefEquals(patternCarrier, stringCarrier)
      ? "string"
      : patternCarrier?.kind === "target-named" &&
        patternCarrier.id === rustJsRegExpTargetId
        ? "regexp"
        : isRustUndefinedCarrier(patternCarrier)
          ? "undefined"
          : undefined;
  if (patternKind === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_REGEXP_PATTERN_CARRIER_UNSUPPORTED",
      "Selected RegExp pattern argument is neither the exact JS string carrier nor the exact RegExp carrier.",
    );
  }
  const flagsKind = sourceArguments.length < 2
    ? "omitted"
    : flagsCarrier !== undefined && rustTargetTypeRefEquals(flagsCarrier, stringCarrier)
      ? "string"
      : isRustUndefinedCarrier(flagsCarrier)
        ? "undefined"
        : undefined;
  if (flagsKind === undefined) {
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
  const operationId = `tsonic.rust.js.regexp.create.${invocation}.${patternKind}.${flagsKind}-flags`;
  const targetOperation = selectedRegExpTargetOperation(invocation, patternKind, flagsKind);
  const fact: RustTargetOperationFact = {
    kind: "regexp-create",
    operationId,
    targetOperation,
    input: {
      kind: "selected-call",
      invocation,
      sourceArgumentCount: sourceArguments.length as 0 | 1 | 2,
      patternKind,
      ...(patternCarrier === undefined ? {} : { patternCarrier }),
      flagsKind,
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
  const selectedSignature: RustSelectedTargetSignature = {
      member: {
        id: fact.operationId,
        sourceName: invocation === "construct" ? "constructor" : "call",
        targetName: targetOperation,
        kind: invocation === "construct" ? "constructor" : "method",
        ...(invocation === "call" ? { static: true } : {}),
        parameters: [
          {
            name: "pattern",
            type: patternCarrier ?? stringCarrier,
            passingMode: "by-value",
            optional: true,
          },
          {
            name: "flags",
            type: flagsCarrier ?? stringCarrier,
            passingMode: "by-value",
            optional: true,
          },
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
  };
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature, evidence);
  return acceptRustPolicy({ selectedSignature }, evidence);
}

function selectedRegExpTargetOperation(
  invocation: "call" | "construct",
  patternKind: "omitted" | "string" | "regexp" | "undefined",
  flagsKind: "omitted" | "string" | "undefined",
): Extract<RustTargetOperationFact, { readonly kind: "regexp-create" }>[
  "targetOperation"
] {
  if (patternKind === "omitted") {
    return "js_abi::JsRegExp::empty";
  }
  if (patternKind === "string") {
    return flagsKind === "omitted"
      ? "js_abi::JsRegExp::from_string"
      : flagsKind === "string"
        ? "js_abi::JsRegExp::from_string_with_flags"
        : "js_abi::JsRegExp::from_string_with_undefined_flags";
  }
  if (patternKind === "undefined") {
    return flagsKind === "omitted"
      ? "js_abi::JsRegExp::from_undefined"
      : flagsKind === "string"
        ? "js_abi::JsRegExp::from_undefined_with_flags"
        : "js_abi::JsRegExp::from_undefined_with_undefined_flags";
  }
  if (invocation === "call") {
    return flagsKind === "omitted"
      ? "js_abi::JsRegExp::call_from_regexp"
      : flagsKind === "string"
        ? "js_abi::JsRegExp::call_from_regexp_with_flags"
        : "js_abi::JsRegExp::call_from_regexp_with_undefined_flags";
  }
  return flagsKind === "omitted"
    ? "js_abi::JsRegExp::construct_from_regexp"
    : flagsKind === "string"
      ? "js_abi::JsRegExp::construct_from_regexp_with_flags"
      : "js_abi::JsRegExp::construct_from_regexp_with_undefined_flags";
}
