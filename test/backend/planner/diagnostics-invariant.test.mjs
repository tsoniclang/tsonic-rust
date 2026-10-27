import { registerTargetPlannerInvariantContractTests } from "../../../../tsonic/test/helpers/contracts/target-planner-invariant-contract.mjs";
import { failRustPlannerInvariant } from "../../../dist/backend/planner/diagnostics.js";

registerTargetPlannerInvariantContractTests("tsonic-rust", failRustPlannerInvariant,
  new URL("../../../src/backend", import.meta.url));
