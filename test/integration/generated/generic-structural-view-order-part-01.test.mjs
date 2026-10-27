import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, createRustSession, rustSourceDiagnostics, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import {
  orderedDeclarations,
  constantSource,
  dependentSource,
  permutedSource,
  getterSource,
} from "./generic-structural-view-order-fixtures.mjs";

for (const surfaces of ([[], ["js"]]).slice(0, 1)) {
for (const order of (["closed-only", "closed-first", "open-first"]).slice(0, 3)) {
for (const [name, source] of ([["constant", constantSource], ["dependent", dependentSource], ["permuted", permutedSource], ["getter", getterSource]]).slice(0, 4)) {
test(`${name} generic structural views preserve native ABI and live state ${order} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
        const { result, source: checked } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
          files: { "index.ts": source(order) + "\nmain();\n" } });
        const diagnostics = result.diagnostics.slice(0, 32).map(row => {
          const node = row.sourceNode;
          const range = node === undefined ? undefined : checked.ast.authoredRange(node);
          const file = node === undefined ? undefined : checked.ast.getSourceFile(node);
          const text = range?.kind === "authored" && file !== undefined
            ? checked.ast.getSourceText(file).slice(range.start, range.end).slice(0, 160) : "";
          return JSON.stringify({ code: row.code, message: row.message.slice(0, 256),
            kind: node === undefined ? undefined : checked.ast.kindName(node), text });
        }).join("\n");
        assert.equal(result.diagnostics.length, 0, diagnostics);
        const emitted = rustSourceText(result);
        assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test(emitted), false,
          "the structural ABI must retain statically selected native dispatch");
        const native = validateGeneratedProject(`generic-structural-view-${name}-${order}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
        assert.equal(native.status, 0, native.stdout + native.stderr);
      });
}
}

test(`generic structural views reject incompatible carriers and readonly destinations in ${surfaces[0] ?? "native"}`, () => {
    for (const [name, source] of [
      ["incompatible field", "type View<T> = { readonly value?: T }; class Box<T> { value: T; constructor(value: T) { this.value = value; } } const view: View<string> = new Box<number>(1);"],
      ["incompatible method", "type View<T> = { read(): T }; class Box<T> { value: T; constructor(value: T) { this.value = value; } read(): T { return this.value; } } const view: View<string> = new Box<number>(1);"],
      ["readonly write", "type View<T> = { readonly value?: T }; class Box<T> { value: T; constructor(value: T) { this.value = value; } } const view: View<number> = new Box<number>(1); view.value = 2;"],
    ]) {
      const session = createRustSession({ surfaces, files: { "index.ts": source } });
      assert.match(rustSourceDiagnostics(session), /error TS(?:2322|2540)/u, name);
    }
  });
}

for (const surfaces of ([[], ["js"]]).slice(1, 2)) {
for (const order of (["closed-only", "closed-first", "open-first"]).slice(0, 1)) {
for (const [name, source] of ([["constant", constantSource], ["dependent", dependentSource], ["permuted", permutedSource], ["getter", getterSource]]).slice(0, 4)) {
test(`${name} generic structural views preserve native ABI and live state ${order} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
        const { result, source: checked } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
          files: { "index.ts": source(order) + "\nmain();\n" } });
        const diagnostics = result.diagnostics.slice(0, 32).map(row => {
          const node = row.sourceNode;
          const range = node === undefined ? undefined : checked.ast.authoredRange(node);
          const file = node === undefined ? undefined : checked.ast.getSourceFile(node);
          const text = range?.kind === "authored" && file !== undefined
            ? checked.ast.getSourceText(file).slice(range.start, range.end).slice(0, 160) : "";
          return JSON.stringify({ code: row.code, message: row.message.slice(0, 256),
            kind: node === undefined ? undefined : checked.ast.kindName(node), text });
        }).join("\n");
        assert.equal(result.diagnostics.length, 0, diagnostics);
        const emitted = rustSourceText(result);
        assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test(emitted), false,
          "the structural ABI must retain statically selected native dispatch");
        const native = validateGeneratedProject(`generic-structural-view-${name}-${order}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
        assert.equal(native.status, 0, native.stdout + native.stderr);
      });
}
}

for (const order of (["closed-only", "closed-first", "open-first"]).slice(1, 2)) {
for (const [name, source] of ([["constant", constantSource], ["dependent", dependentSource], ["permuted", permutedSource], ["getter", getterSource]]).slice(0, 3)) {
test(`${name} generic structural views preserve native ABI and live state ${order} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
        const { result, source: checked } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
          files: { "index.ts": source(order) + "\nmain();\n" } });
        const diagnostics = result.diagnostics.slice(0, 32).map(row => {
          const node = row.sourceNode;
          const range = node === undefined ? undefined : checked.ast.authoredRange(node);
          const file = node === undefined ? undefined : checked.ast.getSourceFile(node);
          const text = range?.kind === "authored" && file !== undefined
            ? checked.ast.getSourceText(file).slice(range.start, range.end).slice(0, 160) : "";
          return JSON.stringify({ code: row.code, message: row.message.slice(0, 256),
            kind: node === undefined ? undefined : checked.ast.kindName(node), text });
        }).join("\n");
        assert.equal(result.diagnostics.length, 0, diagnostics);
        const emitted = rustSourceText(result);
        assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test(emitted), false,
          "the structural ABI must retain statically selected native dispatch");
        const native = validateGeneratedProject(`generic-structural-view-${name}-${order}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
        assert.equal(native.status, 0, native.stdout + native.stderr);
      });
}
}
}
