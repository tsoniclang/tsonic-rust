import assert from "node:assert/strict";
import test from "node:test";

import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import {
  compileRust,
  createRustSession,
  rustSourceDiagnostics,
} from "../../helpers/rust-session.mjs";

test("generated Rust closes identity, binary, collection, Date, and object APIs", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
        class Owner {
          value = 1;
        }

        export function identityAndBinary(): number {
          const fresh = Symbol("state");
          const registered = Symbol.for("state");
          const owner = new Owner();
          const weakMap = new WeakMap<Owner, symbol>();
          const weakSet = new WeakSet<Owner>();
          weakMap.set(owner, fresh);
          weakSet.add(owner);

          const buffer = new ArrayBuffer(8);
          const view = new DataView(buffer);
          view.setUint32(0, 0x01020304, false);
          const words = new Uint32Array(buffer);
          const bytes = new Uint8Array(buffer);

          return (weakMap.get(owner) === fresh ? 1 : 0) +
            (weakSet.has(owner) ? 1 : 0) +
            (Symbol.keyFor(registered) === "state" ? 1 : 0) +
            view.getUint32(0, false) + words.length + bytes[0];
        }

        export function collectionsAndDate(): string {
          const left = new Set<number>([1, 2]);
          const right = new Set<number>([2, 3]);
          const union = left.union(right);
          const intersection = left.intersection(right);
          let seen = 0;
          const map = new Map<string, number>([["one", 1]]);
          map.forEach((value, key, selected) => {
            if (selected === map && key === "one") seen += value;
          });
          union.forEach((value, key, selected) => {
            if (selected === union && key === value) seen += value;
          });

          const date = new Date(Date.UTC(2023, 0, 31, 12, 30));
          date.setUTCMonth(1);
          date.setUTCHours(24, 5);
          const assigned = Object.assign({ count: seen }, { label: date.toUTCString() });
          const invalidJson = new Date(Number.NaN).toJSON() ?? "invalid";
          return assigned.label + invalidJson + intersection.size + left.isSubsetOf(union) +
            union.isSupersetOf(left) + left.isDisjointFrom(new Set<number>([9]));
        }
      `,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("js-api-capability-values", result.artifacts);
});

test("JavaScript capability globals remain absent from the native Rust source profile", () => {
  const diagnostics = rustSourceDiagnostics(createRustSession({
    files: {
      "index.ts": `
        export const symbol = Symbol("state");
        export const weak = new WeakMap<object, number>();
        export const buffer = new ArrayBuffer(8);
        export const formatter = new Intl.NumberFormat("en-US");
        export const timer = setTimeout(() => {}, 0);
      `,
    },
  }));

  assert.match(diagnostics, /Cannot find name 'WeakMap'/u);
  assert.match(diagnostics, /Cannot find name 'ArrayBuffer'/u);
  assert.match(diagnostics, /Cannot find name 'Intl'/u);
  assert.match(diagnostics, /Cannot find name 'setTimeout'/u);
});

test("generated Rust closes Promise, Intl, JSON, console, and timer APIs", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
        export async function asynchronous(): Promise<string> {
          const first = Promise.resolve(1);
          const second = Promise.resolve(2);
          const raced = await Promise.race([first, second]);
          const any = await Promise.any([Promise.reject<number>("no"), second]);
          const settled = await Promise.allSettled([first, Promise.reject<number>("no")]);
          const finalized = await first.finally(() => console.count("finally"));

          const date = new Intl.DateTimeFormat("en-US", {
            timeZone: "UTC",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(Date.UTC(2023, 5, 15));
          const number = new Intl.NumberFormat("en-US", {
            style: "percent",
            maximumFractionDigits: 1,
          }).format(0.125);
          const order = new Intl.Collator("en-US", { numeric: true })
            .compare("item2", "item10");
          const json = JSON.stringify(
            { keep: raced + any + finalized, drop: order },
            (key, value) => key === "drop" ? undefined : value,
            2,
          ) ?? "";

          const timer = setTimeout(() => console.timeLog("build", settled.length), 0);
          clearTimeout(timer);
          const interval = setInterval(() => console.debug(date), 1);
          clearInterval(interval);
          console.time("build");
          console.timeEnd("build");
          return date + number + json;
        }
      `,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("js-api-capability-async", result.artifacts);
});
