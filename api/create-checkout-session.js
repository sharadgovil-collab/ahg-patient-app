// Vercel Serverless Function -- runs on the server, never in the browser.
// This is the ONLY place that decides what a patient is actually charged.
// Even if someone tampered with the app in their browser, this catalog
// (not anything sent from the client) is what determines the price.
//
// IMPORTANT: Shop accessory prices are GST-INCLUSIVE (per the official AHG
// price list, effective Feb 2026) -- do not add GST again on top of them.
// LACE AI Pro is priced EXCLUSIVE of GST -- 9% is added on top for that one.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const GST_RATE = 0.09;

// Keep this in sync with PRODUCTS in src/App.jsx whenever prices change.
const PRODUCTS = {
  "impl-battery": { name: "Cochlear Battery (1 box/60pcs)", price: 100.00 },
  "ha-battery-6": { name: "Hearing Aid Battery (6pcs)", price: 9.00 },
  "ha-battery-60": { name: "Hearing Aid Battery (1 box/60pcs)", price: 60.00 },
  "chg-custom": { name: "Custom Charger", price: 272.50 },
  "chg-premium": { name: "Premium Charger", price: 272.50 },
  "chg-standard": { name: "Standard Charger", price: 218.00 },
  "chg-desktop": { name: "Desktop Charger", price: 218.00 },
  "res-multimic-nexia": { name: "Multi-Mic+ (Nexia)", price: 545.00 },
  "res-tvstreamer-nexia": { name: "TV Streamer+ (Nexia)", price: 545.00 },
  "res-multimic": { name: "Multi-Mic", price: 599.50 },
  "res-tvstreamer2": { name: "TV Streamer 2", price: 218.00 },
  "res-phoneclip": { name: "Phone Clip+", price: 272.50 },
  "res-remote2": { name: "Remote Control 2", price: 135.00 },
  "pho-tvconnector": { name: "TV Connector", price: 230.00 },
  "pho-partnermic": { name: "Partner Mic", price: 460.00 },
  "pho-remote": { name: "Remote Control", price: 230.00 },
  "sig-tvsound": { name: "TV Sound", price: 272.50 },
  "sig-streamlinetv": { name: "Streamline TV", price: 272.50 },
  "sig-streamlinemic": { name: "Streamline Mic", price: 272.50 },
  "sig-minipocket": { name: "MiniPocket", price: 272.50 },
  "oti-connectclip": { name: "ConnectClip", price: 599.50 },
  "oti-edumic": { name: "EduMic", price: 599.50 },
  "oti-remote3": { name: "Remote Control 3.0", price: 135.00 },
  "oti-phoneadaptor": { name: "Phone Adaptor", price: 272.50 },
  "oti-tvadaptor3": { name: "TV Adaptor 3.0", price: 272.50 },
  "earplug-serenity": { name: "Serenity Choice Plus", price: 230.00 },
  "clean-perfectdry": { name: "PerfectDry Lux", price: 272.50 },
  "clean-capsules": { name: "Drying Capsules (1 box/4pcs)", price: 16.50 },
  "clean-cup": { name: "Drying Cup", price: 12.00 },
  "con-receiver": { name: "Receiver", price: 210.00 },
  "con-receiver-up": { name: "Encased with UP receiver", price: 381.50 },
  "con-domes": { name: "Domes (2 pcs)", price: 12.00 },
  "con-earmould": { name: "Earmould", price: 163.50 },
  "con-metalhook": { name: "Metal Earhook", price: 54.50 },
  "con-plastichook": { name: "Plastic Earhook", price: 12.00 },
  "con-tubing": { name: "Tubing", price: 16.50 },
  "con-waxguard": { name: "Wax Guard", price: 16.50 },
  "con-clipngo": { name: "Clip n Go", price: 25.00 },
  "con-audioshoe": { name: "DAI Audioshoe", price: 54.50 },
  "con-earimpression": { name: "Ear Impression", price: 54.50 },
};

const LACE_PRODUCT = { name: "Amazing Hearing LACE AI Pro", price: 499 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { type, cart, origin } = req.body;
    const baseUrl = origin || "https://ahg-patient-app.vercel.app";

    let lineItems = [];
    let orderSummary = [];

    if (type === "lace") {
      // LACE is priced exclusive of GST -- add 9% as its own line.
      lineItems.push({
        price_data: {
          currency: "sgd",
          product_data: { name: LACE_PRODUCT.name },
          unit_amount: Math.round(LACE_PRODUCT.price * 100),
        },
        quantity: 1,
      });
      const gst = Math.round(LACE_PRODUCT.price * GST_RATE * 100) / 100;
      lineItems.push({
        price_data: {
          currency: "sgd",
          product_data: { name: "GST (9%)" },
          unit_amount: Math.round(gst * 100),
        },
        quantity: 1,
      });
      orderSummary.push({ name: LACE_PRODUCT.name, qty: 1, price: LACE_PRODUCT.price });
      const total = LACE_PRODUCT.price + gst;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: lineItems,
        success_url: baseUrl + "/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: baseUrl + "/?checkout=cancel",
      });
      return res.status(200).json({ url: session.url, orderSummary, total });
    }

    if (type === "shop") {
      // Shop prices are GST-INCLUSIVE already -- charge exactly as listed.
      const entries = Object.entries(cart || {}).filter(([, qty]) => qty > 0);
      if (entries.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
      }
      for (const [id, qty] of entries) {
        const product = PRODUCTS[id];
        if (!product) continue;
        lineItems.push({
          price_data: {
            currency: "sgd",
            product_data: { name: product.name },
            unit_amount: Math.round(product.price * 100),
          },
          quantity: qty,
        });
        orderSummary.push({ name: product.name, qty, price: product.price });
      }
      if (lineItems.length === 0) {
        return res.status(400).json({ error: "No valid items in cart" });
      }
      const total = orderSummary.reduce((sum, i) => sum + i.price * i.qty, 0);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: lineItems,
        success_url: baseUrl + "/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: baseUrl + "/?checkout=cancel",
      });
      return res.status(200).json({ url: session.url, orderSummary, total });
    }

    return res.status(400).json({ error: "Unknown order type" });
  } catch (err) {
    console.error("Stripe checkout session error:", err);
    return res.status(500).json({ error: "Couldn't start checkout. Please try again." });
  }
}
