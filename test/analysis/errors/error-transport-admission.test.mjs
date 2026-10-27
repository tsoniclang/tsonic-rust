import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorVariantEmission } from "../../../dist/analysis/errors/transport-emission.js";
import { createRustErrorTransportEmissionProducer } from "../../../dist/analysis/program/records/errors/error-transport.js";

for (const name of ["HttpError", "Runtime", "SourceCreated", "Suppressed"]) {
  test(`error transport admission rejects the original ${name} variant conflict before publication`, () => {
    const first = {};
    const second = {};
    const inventory = [
      { kind: "project", name: "HttpError", definition: first, sourceError: true },
      { kind: "project", name, definition: second, sourceError: false },
    ];
    const domain = { componentId: "root", errorDomain: "project", errorOwnerComponentId: "root",
      errorTypeIdentity: "tsonic-source-package:root:TsonicError", definitions: [first, second], externalErrors: [] };
    const errors = { domainsByComponentId: new Map([["root", domain]]) };
    const producer = createRustErrorTransportEmissionProducer(() => {});
    const issues = analyzeRustErrorVariantEmission({ errorTransport: { forComponent: () => inventory } }, errors, producer);
    assert.equal(issues.length, 1, "the same source inventory is refused once by its owning admission");
    assert.equal(issues[0]?.code, "RUST_CLOSED_ERROR_DEMAND_MISSING", "the existing source diagnostic is unchanged");
    assert.equal(producer.records.programErrorVariants.get("root"), undefined, "invalid variants publish no sealed transport");
    assert.equal(producer.records.boundaryErrorVariants.get("root", domain.errorTypeIdentity), undefined,
      "invalid variants publish no boundary specialization");
  });
}
