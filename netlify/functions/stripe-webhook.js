import Stripe from "stripe";
import SibApiV3Sdk from "sib-api-v3-sdk";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

function getRawBody(event) {
  return event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const rawBody = getRawBody(event);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // ✅ Paiement OK
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const md = session.metadata || {};

    const driverEmail = md.driverEmail;
    const driverName = md.driverName;

    if (driverEmail) {
      // Brevo config
      const client = SibApiV3Sdk.ApiClient.instance;
      client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;
      const api = new SibApiV3Sdk.TransactionalEmailsApi();

      const content =
`Nouvelle course payée ✅

Client : ${md.customerName} (${md.customerPhone})
Départ : ${md.pickupAddress}
Arrivée : ${md.dropoffAddress}
Date / Heure : ${md.date} à ${md.time}
Véhicule : ${md.vehicle}
Prix : ${md.price} €

Merci de contacter le client pour confirmer la prise en charge.`;

      await api.sendTransacEmail({
        sender: { email: process.env.MAIL_SENDER, name: "Réservation VTC" },
        to: [{ email: driverEmail, name: driverName || "Chauffeur" }],
        subject: "Nouvelle course payée ✅",
        textContent: content
      });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
