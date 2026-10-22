import { createRustPlanningContext } from "../../dist/backend/planner/context.js";
import { planRustSourcePackageComponents } from "../../dist/backend/planner/program/source-package-components.js";
import { planRustSourcePackageErrors } from "../../dist/backend/planner/program/source-package-errors.js";
import { createRustSyntheticNameState } from "../../dist/backend/planner/names/synthetic.js";
import { planBlockLike } from "../../dist/backend/planner/statements/index.js";

// The sealed program's authored source files, in artifact order.
export function rustProgramSourceFiles(program) {
  return program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile);
}

// A planner context for the source file that owns `node`, built from the sealed program the same way the planner
// builds one per source file (planRustOutput / planRustSourceFile). `overrides` replaces individual fields.
export function rustSourceFilePlanContext(program, node, overrides = {}) {
  const input = createRustPlanningContext(program);
  const { ast } = input.program.source;
  const { records } = input.program;
  const identities = records.programEmission.get().identities;
  const components = planRustSourcePackageComponents(input);
  const sourceFile = ast.getSourceFile(node);
  const identity = identities.get(ast.getFileName(sourceFile));
  const component = components.find(value => value.componentId === identity?.componentId);
  if (identity === undefined || component === undefined) throw new Error("The node's source file has no native component identity.");
  return {
    input,
    sourceFile,
    sourcePackageComponentId: component.componentId,
    moduleName: identity.moduleName,
    ...(component.crateName === undefined ? {} : { crateName: component.crateName }),
    moduleNameByFileName: new Map([...identities].map(([fileName, value]) => [fileName, value.moduleName])),
    externalCrateNameByFileName: new Map([...identities].flatMap(([fileName, value]) =>
      value.externalCrateName === undefined ? [] : [[fileName, value.externalCrateName]])),
    externalItemPathByIdentity: records.externalSourceItems.get(),
    externalStructuralShapeModuleByFileName: new Map(),
    workerEntryIdentityByFileName: new Map(),
    programModuleName: component.programModuleName,
    structuralShapesModuleName: component.structuralShapesModuleName,
    publicImplementationItemIdentities: component.publicImplementationItemIdentities,
    publishesImplementationAbi: component.publishesImplementationAbi,
    diagnostics: [],
    errorDomain: component.errorDomain,
    sourcePackageErrors: planRustSourcePackageErrors(input),
    usedAliases: new Set(),
    planBlock: planBlockLike,
    syntheticNames: createRustSyntheticNameState(ast, node, []),
    ...overrides,
  };
}
