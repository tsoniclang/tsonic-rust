import type { TargetSourceProfileContributions } from "@tsonic/target-api/provider";
import type { RustProviderPackageDefinition } from "../providers/packages/model.js";

export const rustProviderGlobalsFileName = "provider-globals.d.ts";

export function rustProviderGlobalDeclarations(
  definition: RustProviderPackageDefinition,
): TargetSourceProfileContributions {
  const declarations = Object.entries(definition.sourceGlobals ?? {}).map(([name, exportId]) => {
    for (const module of definition.modules) {
      const exported = module.exports.find((candidate) => candidate.id === exportId);
      if (exported !== undefined) {
        return `declare var ${name}: typeof import(${JSON.stringify(module.moduleSpecifier)})[${JSON.stringify(exported.name)}];`;
      }
    }
    throw new Error(`Provider global '${name}' has no exact export '${exportId}'.`);
  });
  return declarations.length === 0 ? {} : {
    declarations: [{ fileName: rustProviderGlobalsFileName, text: declarations.join("\n") }],
  };
}
