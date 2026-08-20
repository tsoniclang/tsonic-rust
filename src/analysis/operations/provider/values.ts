import { acceptRustPolicy } from "../../../policy/operations/contracts.js";
import { asNode, resolveSelectedProviderDeclaration } from "../../../policy/evidence/selected-source.js";
import { mapProviderCheckedOperation } from "./conversions.js";
import { rejectSelectedOperation } from "./result.js";
import { rustSelectedOperationKey } from "../../../policy/model/selections.js";
import { rustStringTargetType } from "../../../policy/types/target-types.js";
import { rustTargetOperationFactKey } from "../../facts/keys.js";
import { selectedCallArgumentNodes, selectedCallCalleeDeclaration, selectedCallCalleeSymbol } from "./operators.js";
import { selectRustProviderExport } from "../../../policy/operations/provider-selection.js";
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
  const [patternNode, flagsNode] = selectedCallArgumentNodes(request).map((argument) => asNode(argument, context));
  const ast = context.ast;
  const pattern = patternNode !== undefined && ast.kindName(patternNode) === "KindStringLiteral"
    ? ast.text(patternNode)
    : undefined;
  const flags = flagsNode === undefined
    ? ""
    : ast.kindName(flagsNode) === "KindStringLiteral" ? ast.text(flagsNode) : undefined;
  if (pattern === undefined || flags === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_REGEXP_DYNAMIC_UNSUPPORTED", "Rust RegExp construction requires TSTS-selected RegExp constructor evidence and compile-time string pattern/flags.");
  }
  const violation = options.regExpSubsetViolation(pattern, flags);
  if (violation !== undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_REGEXP_UNSUPPORTED", violation);
  }
  const resultCarrier: TargetTypeRef = { kind: "target-named", id: "rust.js.JsRegExp" };
  const fact: RustTargetOperationFact = {
    kind: "regexp-create",
    operationId: "tsonic.rust.js.regexp.create",
    pattern,
    flags,
  };
  const evidence = [{ message: "rust selected RegExp constructor" }];
  context.facts.set(request.source.call, rustTargetOperationFactKey, fact, evidence);
  context.facts.set(request.source.call, rustSelectedOperationKey, {
    operationId: fact.operationId,
    operationKind: "constructor",
    targetOperation: "js_abi::JsRegExp::new",
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
        sourceName: "constructor",
        targetName: "JsRegExp::new",
        kind: "constructor",
        parameters: [
          { name: "pattern", type: rustStringTargetType(), passingMode: "by-value" },
          { name: "flags", type: rustStringTargetType(), passingMode: "by-value" },
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
