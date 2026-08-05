// Vercel Serverless Function -- runs on the server, never in the browser.
// Actually moves money: issues a real refund against the original Stripe
// payment. Only ever called from Staff Admin's Refund tool, which is gated
// to the super_admin role client-side -- but this endpoint itself has no
// auth of its own, so treat the STRIPE_SECRET_KEY as the only thing standing
// between "logged in" and "can refund" and keep it that way.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sessionId, amount, reason } = req.body;
    if (!sessionId || !amount || amount <= 0) {
      return res.status(400).json({ error: "sessionId and a positive amount are required" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session.payment_intent) {
      return res.status(400).json({ error: "This checkout session has no payment to refund" });
    }

    const refund = await stripe.refunds.create({
      payment_intent: session.payment_intent,
      amount: Math.round(amount * 100),
      reason: "requested_by_customer",
      metadata: { note: (reason || "").slice(0, 490) },
    });

    return res.status(200).json({ refundId: refund.id, status: refund.status });
  } catch (err) {
    console.error("refund-payment error:", err);
    return res.status(500).json({ error: err.message || "Couldn't process the refund." });
  }
}
