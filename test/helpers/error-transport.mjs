import { analyzeRustErrorTransport } from "../../dist/analysis/errors/transport.js";
import { analyzeRustSourcePackageErrorBoundaries } from "../../dist/analysis/errors/source-packages.js";
import { analyzeRustErrorVariantEmission } from "../../dist/analysis/errors/transport-emission.js";
import { analyzeRustClosedErrorValues } from "../../dist/analysis/errors/closed-values.js";
import { createRustProgramRecordBuilder } from "../../dist/analysis/program/records/create.js";
import { emptyRustTypeDefinitions } from "../../dist/target-model/types/source-union-definitions.js";

// A source-package error plan with one root component in `errorDomain`. Every component reports the same closed
// error demand (`thrownCarriers`, `retained`) unless the test replaces `program.sourcePackageComponents.forComponent`.
export function rustErrorDomainFixture(errorDomain, thrownCarriers = [], retained = false, external = []) {
  const domain = { componentId: "root", errorOwnerComponentId: errorDomain === "project" ? "root" : undefined,
    errorDomain, errorTypeIdentity: "root:error", definitions: [], externalErrors: external };
  const sourceFile = { kind: "KindSourceFile" };
  return {
    sourceFile,
    errors: {
      componentIdByFileName: new Map([["/src/index.ts", "root"]]),
      componentIdByDefinition: new Map(),
      domainsByComponentId: new Map([["root", domain]]),
      dependencyErrorsByComponentId: new Map([["root", external]]),
    },
    program: {
      projectTypes: { programErrorDefinitions: [], sourceErrorDefinitions: [], programErrorVariant: () => undefined },
      typeDefinitions: emptyRustTypeDefinitions,
      errorStorageDemands: { retainedBoundaries: [] },
      // No safety builders in these fixtures: every node is native code.
      safetyApplications: { operationForExpression: () => undefined },
      sourcePackageComponents: { forComponent: () => ({ closedErrorDemand: { thrownCarriers, retained, sourceView: false } }) },
      source: { ast: { kindName: node => node.kind, pos: () => 0, end: () => 0, parent: () => undefined,
        getSourceFile: () => sourceFile, getFileName: () => "/src/index.ts", getSourceText: () => "" } },
    },
  };
}

// Runs the analysis owners of error transport in pipeline order (analysis/program/emission.ts): payload transport,
// source-package boundaries, variant inventory, closed error values. A stage that reports issues ends the run, as it
// rejects the analysis stage. Returns the records sealed so far and that stage's issues.
// `nodes` and `records` let a case run the closed-value stage over source nodes whose records it supplies.
export function analyzeRustErrorTransportFixture({ program, errors }, { nodes = [], records = {} } = {}) {
  const components = [...errors.domainsByComponentId.values()].flatMap(domain => {
    const selected = program.sourcePackageComponents.forComponent(domain.componentId);
    return selected === undefined ? [] : [{ ...domain, closedErrorDemand: selected.closedErrorDemand }];
  });
  const sourcePackageComponents = { components, componentForFile: () => components[0] };
  const builder = createRustProgramRecordBuilder();
  const done = issues => ({ records: builder.readers, issues });
  const transport = analyzeRustErrorTransport({ ...program, ast: program.source.ast, sourcePackageComponents });
  if (transport.kind !== "resolved") return done(transport.diagnostics);
  analyzeRustSourcePackageErrorBoundaries(program, errors, builder.sourcePackageEmission);
  const variants = analyzeRustErrorVariantEmission({ errorTransport: transport.value }, errors, builder.errorTransportEmissionPlans);
  if (variants.length !== 0) return done(variants);
  return done(analyzeRustClosedErrorValues({ ...program, records: { ...builder.readers, ...records }, sourcePackageComponents }, errors, nodes,
    builder.errorTransportEmissionPlans, builder.conversionEmissionPlans));
}
