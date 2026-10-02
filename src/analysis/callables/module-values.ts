import type { Node } from "@tsonic/tsts";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustCallableConversionMatches } from "../../target-model/conversions/callable.js";
import { rustContextualValueConversionFactKey, rustDirectCallableReferenceFactKey, rustModuleBindingFactKey } from "../facts/keys.js";
import type { RustFactWalk } from "../program/walk.js";

export const rustModuleCallableStorageFactKey = defineRustPlanKey<{ readonly kind: "inline" | "stored" }>(
  "moduleCallableStorage", (left, right) => left.kind === right.kind,
);

export function recordRustModuleCallableStorage(walk: RustFactWalk): void {
  const { ast, facts, source } = walk.context;
  const visit = (node: Node): void => {
    const binding = facts.get(node, rustModuleBindingFactKey);
    if (binding?.storage === "native-callable" && binding.value !== undefined) {
      const stored = source.navigation.declarationUseSummary(node).exported || source.navigation.declarationUses(node).some(use => {
        if (use.kind !== "first-class") return false;
        const reference = facts.get(use.reference, rustDirectCallableReferenceFactKey);
        const selected = facts.get(use.reference, rustContextualValueConversionFactKey);
        return reference === undefined || selected?.conversion.kind !== "callable-adapter" ||
          !rustCallableConversionMatches(selected.conversion, reference.carrier, selected.targetCarrier, walk.context.typeDefinitions);
      });
      facts.set(node, rustModuleCallableStorageFactKey, Object.freeze({ kind: stored ? "stored" : "inline" }),
        [{ message: "rust finalized native module callable storage uses" }]);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  walk.context.sourceFiles.forEach(visit);
}
