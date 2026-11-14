// @ts-check
// The pure decisions behind gift-card activation: what an Inkress orders webhook delivery means for a
// card, and whether an order read back by id counts as paid. An Inkress test payment charged no one, so
// it never activates, records or emails a card. Plain JS because server.mjs loads app-kit.server.mjs,
// which imports this, without a build step.

/** The three things an order delivery can mean for a gift card. */
export const OrderEventKind = Object.freeze({ Paid: "paid", Test: "test", Ignore: "ignore" });

/**
 * @typedef {{ kind: "paid"; orderId: string } | { kind: "test"; orderId: string | null } | { kind: "ignore" }} CardOrderEvent
 */

/** Order statuses that mean the buyer has paid. */
const PAID_STATUSES = ["paid", "confirmed", "completed", "fulfilled"];

/**
 * Narrow an unknown value to a string index map, or null when it is not an object.
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * True when an order status means the buyer has paid.
 * @param {unknown} status
 * @returns {boolean}
 */
export function isPaid(status) {
  return PAID_STATUSES.includes(String(status).toLowerCase());
}

/**
 * Find the order object in any of the body shapes Inkress has sent.
 * @param {Record<string, unknown>} p
 * @returns {Record<string, unknown>}
 */
function orderOf(p) {
  const data = asRecord(p.data);
  const eventData = asRecord(asRecord(p.event)?.data);
  return asRecord(p.order) || asRecord(data?.order) || asRecord(eventData?.order) || eventData || data || {};
}

/**
 * Decide what an Inkress order delivery means for a gift card. A test is decided before the paid check.
 * @param {{ topic: string; payload: unknown }} evt the app-kit webhook event
 * @returns {CardOrderEvent}
 */
export function cardOrderEvent(evt) {
  const p = asRecord(evt.payload) || {};
  const order = orderOf(p);
  const orderId = order.id ? String(order.id) : null;
  if (p.test === true) return { kind: OrderEventKind.Test, orderId };
  const status = String(order.status || evt.topic || "").toLowerCase();
  if (!orderId || !(isPaid(status) || /paid|confirmed/.test(evt.topic))) return { kind: OrderEventKind.Ignore };
  return { kind: OrderEventKind.Paid, orderId };
}

/**
 * True when an order read back by id is paid and is not an Inkress test payment. The status is read at
 * the top level or under `order`, as `GET /orders/:id` has returned both.
 * @param {unknown} order the order response body
 * @returns {boolean}
 */
export function isPaidLiveOrder(order) {
  const d = asRecord(order);
  if (!d) return false;
  const nested = asRecord(d.order);
  if (d.test === true || nested?.test === true) return false;
  return isPaid(d.status ?? nested?.status ?? "");
}
