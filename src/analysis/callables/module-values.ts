import type { Node } from "@tsonic/tsts";

import { rustCallableConversionMatches } from "../../target-model/conversions/callable.js";
import { rustCallableInputMatches } from "../../target-model/conversions/callable-input.js";


import type { RustFactWalk } from "../program/walk.js";
import type { RustSourceCallableValueFact } from "../../target-model/records/operation-selections.js";
import { selectRustInlineModuleCallableAliases } from "./module-aliases.js";

import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";



export function recordRustModuleCallableStorage(walk: RustFactWalk): void {
  const { ast, records, source } = walk.context;
  const visit = (node: Node): void => {
    const binding = records.moduleBinding.get(node);
    if (binding?.storage === "native-callable" && binding.value !== undefined) {
      const aliases: { readonly declarations: readonly Node[]; readonly references: readonly Node[];
        readonly producer: RustSourceCallableValueFact }[] = [];
      const summary = source.navigation.declarationUseSummary(node);
      const declarationValue = ast.is.IsFunctionDeclaration(node) && !summary.bindingWritten &&
        rustGenericCallableValue(binding.value.carrier) !== undefined;
      const stored = !declarationValue && (summary.exported || summary.bindingWritten || source.navigation.declarationUses(node).some(use => {
        if (use.kind !== "first-class") return false;
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
      records.moduleCallableStorage.set(node, Object.freeze({ kind: stored ? "stored" : "inline" }), [{ message: "rust finalized native module callable storage uses" }]);
      if (declarationValue) for (const use of summary.uses) {
        if (use.kind !== "first-class") continue;
        const value = records.directCallableReference.get(use.reference);
        if (value !== undefined) records.sourceCallableValue.set(use.reference, value, [{ message: "rust exact immutable declaration-owned callable value" }]);
      }
      if (!stored) for (const alias of aliases) {
        for (const declaration of alias.declarations) records.compileTimeSource.set(declaration, true, [{ message: "rust exact immutable invocation-only native callable alias" }]);
        for (const reference of alias.references) records.directCallableReference.set(reference, alias.producer, [{ message: "rust exact immutable invocation-only native callable producer" }]);
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  walk.context.sourceFiles.forEach(visit);
}
