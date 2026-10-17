import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { rustClosedErrorTransportDemand } from "../../../dist/analysis/errors/closed-errors.js";
import { rustJsValueTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function demand(body) {
  const context = analyzeRustErrorEffects(`export async function action(pending: Promise<number>): Promise<number> { ${body} }`);
  const selected = rustClosedErrorTransportDemand(context.sourceFiles[0], context.ast, context.records,
    context.typeDefinitions, context.projectTypes, node => context.records.errorEffects.get(node), context.isNativeNode);
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

test("caught transport reads one completed intrinsic TryBlock effect and never treats missing evidence as pure", () => {
  for (const body of [
    "try { return await pending; } catch (error) { return 0; }",
    "try { const first = await pending; return first + await pending; } catch (error) { return 0; }",
    "try { return 1; } catch (error) { return 0; }",
  ]) {
    const context = analyzeRustErrorEffects(`export async function action(pending: Promise<number>): Promise<number> { ${body} }`);
    const reads = [];
    const selected = rustClosedErrorTransportDemand(context.sourceFiles[0], context.ast, context.records,
      context.typeDefinitions, context.projectTypes, node => {
        reads.push(node);
        return context.records.errorEffects.get(node);
      }, context.isNativeNode);
    assert.equal(selected !== undefined, true, body);
    assert.equal(reads.length, 1, "One caught try reads one completed region, independent of its await count.");
    const statement = context.ast.parent(reads[0]);
    assert.equal(context.ast.kindName(statement), "KindTryStatement");
    assert.equal(context.ast.as.AsTryStatement(statement).TryBlock === reads[0], true, "The intrinsic owner is the original TryBlock.");
    const missing = rustClosedErrorTransportDemand(context.sourceFiles[0], context.ast, context.records,
      context.typeDefinitions, context.projectTypes, () => undefined, context.isNativeNode);
    assert.equal(missing === undefined, true, "Missing required region evidence remains unresolved, even for a pure try.");
    assert.equal(selected.retained, body.includes("await"), body);
    assert.equal(selected.thrownCarriers.length, body.includes("await") ? 1 : 0, body);
  }
});

test("nested catches consume their own completed region and do not escape into an enclosing catch", () => {
  const context = analyzeRustErrorEffects(`export async function action(pending: Promise<number>): Promise<number> {
    try { try { return await pending; } catch (inner) { return 1; } } catch (outer) { return 0; }
  }`);
  const reads = [];
  const selected = rustClosedErrorTransportDemand(context.sourceFiles[0], context.ast, context.records,
    context.typeDefinitions, context.projectTypes, node => {
      const effects = context.records.errorEffects.get(node);
      reads.push({ node, effects });
      return effects;
    }, context.isNativeNode);
  assert.equal(selected !== undefined, true);
  assert.equal(reads.length, 2);
  const outer = reads.find(entry => reads.some(other => other !== entry && context.ast.parent(context.ast.parent(other.node)) === entry.node));
  const inner = reads.find(entry => entry !== outer);
  assert.equal(outer !== undefined && inner !== undefined, true, "Both original nested TryBlocks are read.");
  assert.equal(outer.effects.nativeErrors.length, 0, "The outer region excludes errors handled by the inner catch.");
  assert.equal(inner.effects.nativeErrors.some(error => rustTargetTypeRefEquals(error.errorType, rustJsValueTargetType())), true);
  assert.equal(selected.thrownCarriers.length, 1, "Only the inner catch demands the canonical JS rejection transport.");
});

test("the caught intrinsic region includes the await operand's synchronous factory failure", () => {
  const context = analyzeRustErrorEffects(`
    function factory(flag: boolean, pending: Promise<number>): Promise<number> {
      if (flag) throw new Error("factory");
      return pending;
    }
    export async function action(flag: boolean, pending: Promise<number>): Promise<number> {
      try { return await factory(flag, pending); } catch (error) { return 0; }
    }
  `);
  const reads = [];
  const selected = rustClosedErrorTransportDemand(context.sourceFiles[0], context.ast, context.records,
    context.typeDefinitions, context.projectTypes, node => {
      const effects = context.records.errorEffects.get(node);
      reads.push({ node, effects });
      return effects;
    }, context.isNativeNode);
  assert.equal(selected !== undefined && reads.length === 1, true, "One completed caught region supplies the entire demand.");
  assert.equal(reads[0].effects.localErrors, true, "The operand's synchronous source failure remains in the same intrinsic region.");
  assert.equal(reads[0].effects.nativeErrors.some(error => error.identity === "js-rejection" &&
    rustTargetTypeRefEquals(error.errorType, rustJsValueTargetType())), true,
  "The awaited rejection remains distinct from the factory's synchronous failure.");
  assert.equal(selected.retained && selected.thrownCarriers.length === 1 &&
    rustTargetTypeRefEquals(selected.thrownCarriers[0], rustJsValueTargetType()), true,
  "Both failure channels demand the existing single canonical caught JS transport.");
});

test("an escaping finally await is attributed to the enclosing caught TryBlock", () => {
  const context = analyzeRustErrorEffects(`export async function action(pending: Promise<number>): Promise<number> {
    try { try { return 1; } finally { await pending; } } catch (error) { return 0; }
  }`);
  const reads = [];
  const selected = rustClosedErrorTransportDemand(context.sourceFiles[0], context.ast, context.records,
    context.typeDefinitions, context.projectTypes, node => {
      const effects = context.records.errorEffects.get(node);
      reads.push({ node, effects });
      return effects;
    }, context.isNativeNode);
  assert.equal(selected !== undefined && reads.length === 1, true, "Only the outer caught statement reads a demand region.");
  const statement = context.ast.parent(reads[0].node);
  assert.equal(context.ast.as.AsTryStatement(statement).CatchClause !== undefined, true,
    "The exact original enclosing catch owns the escaping finally failure.");
  assert.equal(reads[0].effects.nativeErrors.some(error => error.identity === "js-rejection" &&
    rustTargetTypeRefEquals(error.errorType, rustJsValueTargetType())), true,
  "The already-completed outer region includes the nested finally's rejection.");
  assert.equal(selected.retained && selected.thrownCarriers.length === 1 &&
    rustTargetTypeRefEquals(selected.thrownCarriers[0], rustJsValueTargetType()), true,
  "No per-await ancestor search or invented finally-only catch is needed.");
});
