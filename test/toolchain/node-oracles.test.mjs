import assert from "node:assert/strict";
import test from "node:test";
import { nodeOraclePrograms, runNodeOracle, runNativeNodeOracle } from "../helpers/node-oracles.mjs";
import { nodeOraclePrograms as sharedPrograms, runNodeOracle as sharedNodeRunner } from "../../../tsonic/test/fixtures/node-oracle/index.mjs";

test("Rust consumes the one shared oracle catalogue and Node reference runner", () => {
  assert.equal(nodeOraclePrograms === sharedPrograms, true);
  assert.equal(runNodeOracle === sharedNodeRunner, true);
  assert.equal(typeof runNativeNodeOracle, "function");
  assert.equal(nodeOraclePrograms.length, 11);
});
