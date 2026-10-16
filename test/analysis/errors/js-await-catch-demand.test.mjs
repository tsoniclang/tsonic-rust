import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { rustClosedErrorTransportDemand } from "../../../dist/analysis/errors/closed-errors.js";
import { rustJsValueTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function demand(body) {
  const context = analyzeRustErrorEffects(`export async function action(pending: Promise<number>): Promise<number> { ${body} }`);
  const selected = rustClosedErrorTransportDemand(context.sourceFiles[0], context.ast, context.records,
    context.typeDefinitions, context.projectTypes);
  assert.equal(selected !== undefined, true);
  return selected;
}

test("a caught JS await demands exactly the closed JS value and retained Error paths", () => {
  const selected = demand("try { return await pending; } catch (error) { return 0; }");
  assert.equal(selected.retained, true);
  assert.equal(selected.thrownCarriers.length, 1);
  assert.equal(rustTargetTypeRefEquals(selected.thrownCarriers[0], rustJsValueTargetType()), true);
});

test("uncaught, finally-only and nested-callable awaits do not invent a catch transport", () => {
  for (const body of [
    "return await pending;",
    "try { return await pending; } finally { const done = 1; }",
    "try { const nested = async (): Promise<number> => await pending; return 1; } catch (error) { return 0; }",
    "try { return 1; } catch (error) { return await pending; }",
  ]) {
    const selected = demand(body);
    assert.equal(selected.retained, false, body);
    assert.equal(selected.thrownCarriers.length, 0, body);
  }
});
