import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// ✅ MVP: mapping chauffeurs (tu mettras les vrais emails plus tard)
const DRIVERS = {
  alex:  { name: "Alex",  email: "alex@example.com"  },
  mehdi: { name: "Mehdi", email: "mehdi@example.com" },
  sarah: { name: "Sarah", email: "sarah@example.com" }
};

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
      price,
      driverKey
    } = body;

    if (!customerName || !customerPhone || !pickupAddress || !dropoffAddress || !date || !time || !vehicle || !price || !driverKey) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
    }

    const driver = DRIVERS[String(driverKey).toLowerCase()];
    if (!driver) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid driver" }) };
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
        driverKey: String(driverKey),
        driverName: driver.name,
        driverEmail: driver.email,
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
