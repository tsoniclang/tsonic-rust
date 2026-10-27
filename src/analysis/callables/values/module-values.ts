import { requireRustRecord } from "../../program/records/required-records.js";
import type { Node } from "@tsonic/tsts";
import type { SourceDeclarationUse } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

import { rustCallableConversionMatches } from "../../../policy/conversions/callable.js";
import { rustCallableInputMatches } from "../../../policy/conversions/callable-input.js";

import type { RustFactWalk } from "../../program/walk.js";
import type { RustSourceCallableValueFact } from "../../../target-model/records/operation-selections.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { rustSourceCallableValueEquals } from "../../../target-model/records/equality.js";
import { selectRustInlineModuleCallableAliases } from "./module-aliases.js";

import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";

export function recordRustModuleCallableStorage(walk: RustFactWalk): void {
  walk.context.records.moduleCallableStoragePlans.finalize(walk);
}

export interface RustModuleCallableStorageSelection {
  readonly stored: boolean;
  readonly declarationValue: boolean;
  readonly uses: readonly SourceDeclarationUse[];
  readonly aliases: readonly {
    readonly declarations: readonly Node[];
    readonly references: readonly Node[];
    readonly producer: RustSourceCallableValueFact;
  }[];
}

export function selectRustModuleCallableStorage(
  walk: RustFactWalk, node: Node,
): RustModuleCallableStorageSelection | undefined {
  const { ast, records, source } = walk.context;
  const binding = records.moduleBinding.get(node);
  if (binding?.storage !== "native-callable" || binding.value === undefined) return undefined;
  const aliases: { readonly declarations: readonly Node[]; readonly references: readonly Node[];
    readonly producer: RustSourceCallableValueFact }[] = [];
  const summary = source.navigation.declarationUseSummary(node);
  const declarationValue = ast.is.IsFunctionDeclaration(node) && !summary.bindingWritten &&
    rustGenericCallableValue(binding.value.carrier) !== undefined;
  const stored = !declarationValue && (summary.exported || summary.bindingWritten || source.navigation.declarationUses(node).some(use => {
    if (use.kind !== "first-class") return false;
    // A reference with its own source callable value is planned as that value at the use (planner dispatch), never
    // as a read of the module cell.
    if (records.sourceCallableValue.get(use.reference) !== undefined) return false;
    const reference = records.directCallableReference.get(use.reference);
    const selected = records.contextualValueConversion.get(use.reference);
    if (reference === undefined) return true;
    if (selected === undefined) {
      const alias = selectRustInlineModuleCallableAliases(walk, use.reference, reference);
      if (alias === undefined) return true;
      aliases.push({ ...alias, producer: reference });
      return false;
    }
    return selected.conversion.kind === "callable-input"
      ? !rustCallableInputMatches(reference.carrier, selected.targetCarrier)
      : selected.conversion.kind !== "callable-adapter" ||
        !rustCallableConversionMatches(selected.conversion, reference.carrier, selected.targetCarrier, walk.context.typeDefinitions);
  }));
  return { stored, declarationValue, uses: summary.uses, aliases };
}

export function recordRustInlineModuleCallableUses(
  walk: RustFactWalk, selection: RustModuleCallableStorageSelection,
): void {
  const { records } = walk.context;
  records.assertOpen();
  const values = new Map<Node, RustSourceCallableValueFact>();
  const references = new Map<Node, RustSourceCallableValueFact>();
  if (selection.declarationValue) for (const use of selection.uses) {
    if (use.kind !== "first-class") continue;
    const value = records.directCallableReference.get(use.reference);
    if (value !== undefined) collect(use.reference, value, records.sourceCallableValue, values, "sourceCallableValue");
  }
  if (!selection.stored) for (const alias of selection.aliases) {
    for (const reference of alias.references) collect(reference, alias.producer,
      records.directCallableReference, references, "directCallableReference");
  }
  for (const [reference, value] of values) records.sourceCallableValues.function(reference, value.sourceDeclaration,
    value.fileName, value.name, value.carrier, value.parameterCarriers, value.resultCarrier);
  if (!selection.stored) for (const alias of selection.aliases) {
    for (const declaration of alias.declarations) {
      requireRustRecord(walk.context.requiredRecords, "compileTimeSource", declaration, "inline-callable-alias", "recordRustInlineModuleCallableUses");
      records.compileTimeSources.erase(declaration);
    }
  }
  for (const [reference, value] of references) records.directCallableReferences.function(reference, value.sourceDeclaration,
    value.fileName, value.name, value.carrier, value.parameterCarriers, value.resultCarrier);

  function collect(reference: Node, value: RustSourceCallableValueFact, family: RustRecordFamily<RustSourceCallableValueFact>,
    pending: Map<Node, RustSourceCallableValueFact>, id: "sourceCallableValue" | "directCallableReference"): void {
    requireRustRecord(walk.context.requiredRecords, id, reference, "inline-callable-use", "recordRustInlineModuleCallableUses");
    const existing = pending.get(reference) ?? family.get(reference);
    if (existing !== undefined && !rustSourceCallableValueEquals(existing, value)) failTargetAnalysisInvariant("tsonic-rust",
      `Conflicting Rust semantic plan 'tsonic.rust.${id}' for one exact source subject.`);
    if (existing === undefined) pending.set(reference, value);
  }
}
