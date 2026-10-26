import assert from "node:assert/strict";
import test from "node:test";
import { defaultValueFactKey } from "@tsonic/tsts";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { rustOperationContext } from "../../../dist/analysis/program/walk.js";
import { mapRustSourceMarkerCall } from "../../../dist/analysis/operations/members/calls/deferred.js";

test("native default admission requires exact source facts and selected logical type arguments", () => {
  const { context, walk, requestFor } = analyzeRustOperations(`
import type { int32 } from "@tsonic/core/types.js";
import { defaultvalue } from "@tsonic/core/lang.js";
export function zero(): int32 { return defaultvalue<int32>(); }
export function flag(): boolean { return defaultvalue<boolean>(); }
`, { surfaces: [] });
  const calls = context.sourceStorage.nodes.filter(node => context.ast.is.IsCallExpression(node));
  assert.equal(calls.length, 2, "both real checked default operations are retained");
  const [call, otherCall] = calls;
  const request = requestFor(call);
  const otherRequest = requestFor(otherCall);
  const current = rustOperationContext(walk, call);
  const provider = context.records.selectedCall.get(call)?.providerDeclaration;
  assert.equal(provider !== undefined, true, "the real source-core provider is selected");
  const select = (candidate, sourceFacts = current.source.sourceFacts) => mapRustSourceMarkerCall(
    candidate, provider, "default-value", { ...current, source: { ...current.source, sourceFacts } }, walk.operationOptions,
  );
  const selected = select(request);
  assert.equal(selected.kind, "accept", "supported native Default evidence remains admitted");
  assert.equal(selected.value.targetFact.resultCarrier.name, "int32", "native integer carrier is exact");
  const original = current.source.sourceFacts;
  const otherFact = original.getFact(otherCall, defaultValueFactKey);
  assert.equal(otherFact !== undefined, true, "the forged fact comes from a distinct checked native type");
  const withFact = fact => ({ ...original, getFact(subject, key) {
    return subject === call && key === defaultValueFactKey ? fact : original.getFact(subject, key);
  } });
  const variants = [
    ["missing source fact", request, withFact(undefined)],
    ["different source fact", request, withFact(otherFact)],
    ["missing selected type", { ...request, source: { ...request.source, sourceSelectedMethodTypeArguments: [] } }],
    ["different selected type", { ...request, source: { ...request.source,
      sourceSelectedMethodTypeArguments: otherRequest.source.sourceSelectedMethodTypeArguments } }],
    ["extra selected type", { ...request, source: { ...request.source,
      sourceSelectedMethodTypeArguments: [...request.source.sourceSelectedMethodTypeArguments,
        ...otherRequest.source.sourceSelectedMethodTypeArguments] } }],
    ["unexpected value argument", { ...request, source: { ...request.source,
      sourceArguments: [{ expression: call }] } }],
  ];
  for (const [label, candidate, facts] of variants) {
    const rejected = select(candidate, facts);
    assert.equal(rejected.kind, "reject", label);
    assert.equal(rejected.diagnostic.extensionCode, "RUST_DEFAULT_VALUE_EVIDENCE_NOT_PROVEN", label);
    assert.equal(rejected.diagnostic.message,
      "Native default initialization requires one exact source-core type fact, one matching selected type argument, no arguments, and one matching Rust result carrier.", label);
  }
  assert.equal(select(request).kind, "accept", "inverse probes never change the supported native operation");
});
