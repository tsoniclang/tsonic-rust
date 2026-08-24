import { acceptRustPolicy } from "../../../policy/operations/contracts.js";
import { resolveSelectedProviderDeclaration } from "../../../policy/evidence/selected-source.js";
import { mapProviderCheckedOperation } from "./conversions.js";
import { rejectSelectedOperation } from "./result.js";
import { selectRustProviderExport } from "../../../policy/operations/provider-selection.js";
import type {
  RustCheckedValueSelectionInput,
  RustCheckedValueSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";

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
