import { allocateRustGeneratedName as allocateGeneratedName } from "../../../target-model/names/generated.js";
import { projectMemberNames } from "./helpers.js";

import type { RustProjectTypePolicyHost } from "../construction-model.js";
import type { RustProjectConstructorSignature, RustProjectTypeDefinition, RustProjectTypeIssue } from "../../../target-model/types/project-types.js";

export function analyzeRustProjectConstructors(
  host: RustProjectTypePolicyHost, definitions: readonly RustProjectTypeDefinition[],
  issues: RustProjectTypeIssue[],
): WeakMap<RustProjectTypeDefinition, readonly RustProjectConstructorSignature[]> {
  const constructorsByDefinition = new WeakMap<
    RustProjectTypeDefinition,
    readonly RustProjectConstructorSignature[]
  >();
  for (const definition of definitions) {
    if (definition.kind !== "class") {
      constructorsByDefinition.set(definition, Object.freeze([]));
      continue;
    }
    const selected = host.navigation.classConstructors(definition.declaration);
    if (selected.kind === "unresolved") {
      issues.push({
        node: selected.declaration,
        code: "RUST_PROJECT_CONSTRUCTOR_SOURCE_UNRESOLVED",
        message: selected.reason,
      });
      constructorsByDefinition.set(definition, Object.freeze([]));
      continue;
    }
    const usedNames = projectMemberNames(definition.declaration, host.ast, host.names);
    const targetName = allocateGeneratedName(
      usedNames,
      "new",
    );
    const signatures = selected.signatures.map((signature) => {
      const plan: RustProjectConstructorSignature = Object.freeze({
        signature: signature.signature,
        ...(signature.declaration === undefined ? {} : { declaration: signature.declaration }),
        parameters: signature.parameters,
        implicit: selected.implicit,
        targetName,
      });
      return plan;
    });
    constructorsByDefinition.set(definition, Object.freeze(signatures));
  }

  return constructorsByDefinition;
}
