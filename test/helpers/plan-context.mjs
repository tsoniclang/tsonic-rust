import { analyzeRust } from "./rust-session.mjs";
import { analyzeRustTypeEmission } from "../../dist/analysis/source-evidence/types/emission.js";
import { createRustTypeEmissionProducer } from "../../dist/analysis/program/records/types/type-emission.js";
import { createRustPlanningContext } from "../../dist/backend/planner/context.js";
import { planRustSourcePackageComponents } from "../../dist/backend/planner/program/source-package-components.js";
import { planRustSourcePackageErrors } from "../../dist/backend/planner/program/source-package-errors.js";
import { createRustSyntheticNameState } from "../../dist/backend/planner/names/synthetic.js";
import { planBlockLike } from "../../dist/backend/planner/statements/index.js";
import { analyzeRustProjectEmission } from "../../dist/analysis/project-types/emission.js";
import { prepareRustProjectGenericMembership } from "../../dist/analysis/project-types/generic-membership.js";
import { createRustProjectEmissionProducer } from "../../dist/analysis/program/records/program/project-emission.js";
import { analyzeRustCarrierReads } from "../../dist/analysis/ownership/carrier-reads.js";
import { createRustCarrierReadProducer } from "../../dist/analysis/program/records/storage/carrier-reads.js";
import { rustCallableInputAbsenceWitness } from "../../dist/target-model/types/carriers/callable-input-witness.js";

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
    nativeHeaderPlacement: sourceFile,
    nativeHeaderParent: undefined,
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

// A sealed analysis program compiled from `source`, whose type emission records also cover `carriers`: the
// analysis owner (analyzeRustTypeEmission) selects every carrier the program uses plus these, as it does for the
// carriers a real program renders. Planner and render tests use it instead of hand-made type emission records.
export function rustProgramWithTypeEmissions(carriers, { source = "export function probe(): void {}\n", surfaces = [],
  typeDefinitions, structuralShapes } = {}) {
  const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
  const selectedCarriers = [...carriers, ...carriers.flatMap(carrier => {
    const witness = rustCallableInputAbsenceWitness(carrier);
    return witness === undefined ? [] : [witness];
  })];
  const context = program.physicalEmissionContexts.contexts[0];
  if (context === undefined) throw new Error("The native type fixture requires one actual emitted source owner.");
  const input = { ...program,
    ...(typeDefinitions === undefined ? {} : { typeDefinitions }),
    ...(structuralShapes === undefined ? {} : { structuralShapes }),
    physicalEmissionContexts: { ...program.physicalEmissionContexts,
      contexts: [{ ...context, operands: [...context.operands, ...selectedCarriers] },
        ...program.physicalEmissionContexts.contexts.slice(1)] },
  };
  const projects = createRustProjectEmissionProducer(() => {});
  analyzeRustProjectEmission({ program: input, nodes: [], producer: projects,
    memberships: prepareRustProjectGenericMembership(input.declarationGenericRequirements) });
  const admitted = { ...input, records: { ...program.records, ...projects.records } };
  const producer = createRustTypeEmissionProducer(() => {});
  analyzeRustTypeEmission(admitted, [], producer, selectedCarriers, projects);
  const reads = createRustCarrierReadProducer(() => {});
  analyzeRustCarrierReads(admitted, [], reads);
  return { ...admitted, records: { ...admitted.records, ...producer.records, ...reads.records } };
}

// The planner context of the program's first authored source file.
export function rustProgramPlanContext(program, overrides = {}) {
  return rustSourceFilePlanContext(program, rustProgramSourceFiles(program)[0], overrides);
}
