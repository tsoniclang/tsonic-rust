import type { Node } from "@tsonic/tsts";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustCallableConversionMatches } from "../../target-model/conversions/callable.js";
import { rustCallableInputMatches } from "../../target-model/conversions/callable-input.js";
import { rustContextualValueConversionFactKey, rustDirectCallableReferenceFactKey, rustModuleBindingFactKey } from "../facts/keys.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSourceCallableValueFact } from "../facts/keys.js";
import { selectRustInlineModuleCallableAliases } from "./module-aliases.js";
import { rustCompileTimeSourceKey } from "../../target-model/facts/source-declarations.js";

export const rustModuleCallableStorageFactKey = defineRustPlanKey<{ readonly kind: "inline" | "stored" }>(
  "moduleCallableStorage", (left, right) => left.kind === right.kind,
);

export function recordRustModuleCallableStorage(walk: RustFactWalk): void {
  const { ast, facts, source } = walk.context;
  const visit = (node: Node): void => {
    const binding = facts.get(node, rustModuleBindingFactKey);
    if (binding?.storage === "native-callable" && binding.value !== undefined) {
      const aliases: { readonly declarations: readonly Node[]; readonly references: readonly Node[];
        readonly producer: RustSourceCallableValueFact }[] = [];
      const stored = source.navigation.declarationUseSummary(node).exported || source.navigation.declarationUses(node).some(use => {
        if (use.kind !== "first-class") return false;
        const reference = facts.get(use.reference, rustDirectCallableReferenceFactKey);
        const selected = facts.get(use.reference, rustContextualValueConversionFactKey);
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
      });
      facts.set(node, rustModuleCallableStorageFactKey, Object.freeze({ kind: stored ? "stored" : "inline" }),
        [{ message: "rust finalized native module callable storage uses" }]);
      if (!stored) for (const alias of aliases) {
        for (const declaration of alias.declarations) facts.set(declaration, rustCompileTimeSourceKey, true,
          [{ message: "rust exact immutable invocation-only native callable alias" }]);
        for (const reference of alias.references) facts.set(reference, rustDirectCallableReferenceFactKey, alias.producer,
          [{ message: "rust exact immutable invocation-only native callable producer" }]);
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  walk.context.sourceFiles.forEach(visit);
}
