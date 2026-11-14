import { test } from "node:test";
import assert from "node:assert/strict";
import { cardOrderEvent, isPaidLiveOrder, OrderEventKind } from "../app/lib/order-event.mjs";

const paid = { event: { action: "orders.paid" }, order: { id: 55, status: "paid" } };

test("a live paid order activates its card", () => {
  assert.deepEqual(cardOrderEvent({ topic: "orders.paid", payload: paid }), { kind: OrderEventKind.Paid, orderId: "55" });
});
test("a test paid order activates nothing", () => {
  assert.deepEqual(cardOrderEvent({ topic: "orders.paid", payload: { ...paid, test: true } }), { kind: OrderEventKind.Test, orderId: "55" });
});
test("test given as a string is live", () => {
  assert.equal(cardOrderEvent({ topic: "orders.paid", payload: { ...paid, test: "true" } }).kind, OrderEventKind.Paid);
});
test("the payment fallback never treats a test order as paid", () => {
  assert.equal(isPaidLiveOrder({ id: 55, status: "paid", test: true }), false);
  assert.equal(isPaidLiveOrder({ id: 55, status: "paid", test: false }), true);
  assert.equal(isPaidLiveOrder({ order: { status: "confirmed" } }), true);
  assert.equal(isPaidLiveOrder({ id: 55, status: "pending" }), false);
});
