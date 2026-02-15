import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

/**
 * Chauffeur unique (solo) :
 * Renseigne ces variables dans Netlify > Environment variables
 * - DRIVER_NAME  (ex: "Black Riviera")
 * - DRIVER_EMAIL (ex: "contact@blackriviera.fr")
 */
const DRIVER_NAME = process.env.DRIVER_NAME || "Chauffeur";
const DRIVER_EMAIL = process.env.DRIVER_EMAIL || "";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const {
      customerName,
      customerPhone,
      pickupAddress,
      dropoffAddress,
      date,
      time,
      vehicle,
      price
    } = body;

    if (!customerName || !customerPhone || !pickupAddress || !dropoffAddress || !date || !time || !vehicle || !price) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
    }

    if (!DRIVER_EMAIL) {
      return { statusCode: 500, body: JSON.stringify({ error: "DRIVER_EMAIL not configured on Netlify" }) };
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${process.env.FRONT_URL}/?paid=1`,
      cancel_url: `${process.env.FRONT_URL}/?canceled=1`,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: "Course VTC" },
            unit_amount: Math.round(Number(price) * 100)
          },
          quantity: 1
        }
      ],
      metadata: {
        driverName: DRIVER_NAME,
        driverEmail: DRIVER_EMAIL,
        customerName,
        customerPhone,
        pickupAddress,
        dropoffAddress,
        date,
        time,
        vehicle,
        price: String(price)
      }
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: String(e?.message || e) }) };
  }
};

