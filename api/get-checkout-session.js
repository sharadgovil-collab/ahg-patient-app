// Vercel Serverless Function -- runs on the server, never in the browser.
// Confirms a checkout session actually completed (payment_status === "paid")
// and returns just enough detail (paid amount, card brand/last4) to put on an
// invoice. This is the source of truth for "was this really paid" -- the
// client's own sessionStorage order is only used for the human-readable item
// breakdown, never to decide whether a payment succeeded.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: "Missing session_id" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["payment_intent.payment_method"],
    });

    let card = null;
    const pm = session.payment_intent && session.payment_intent.payment_method;
    if (pm && pm.card) {
      card = { brand: pm.card.brand, last4: pm.card.last4 };
    }

    return res.status(200).json({
      paid: session.payment_status === "paid",
      amountTotal: session.amount_total != null ? session.amount_total / 100 : null,
      currency: session.currency,
      card,
      created: session.created,
    });
  } catch (err) {
    console.error("get-checkout-session error:", err);
    return res.status(500).json({ error: "Couldn't verify checkout session." });
  }
}
