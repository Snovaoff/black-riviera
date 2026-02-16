import Stripe from "stripe";
import SibApiV3Sdk from "sib-api-v3-sdk";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

function getRawBody(event) {
  return event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");
}

// FR: 06.. => +336.. (utile pour tel:/sms:)
function normalizePhoneToE164FR(input) {
  const raw = String(input || "").trim();
  const digits = raw.replace(/[^\d+]/g, "");

  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return "+33" + digits.slice(1);
  if (digits.startsWith("33")) return "+" + digits;
  return digits;
}

/**
 * ✅ SMS link "unifié"
 * Beaucoup d'apps acceptent `?&body=` (Android) et iOS ne casse pas.
 * C’est la forme la plus “compatible” en un seul lien dans un email.
 */
function smsLink(phoneE164, body) {
  const enc = encodeURIComponent(body);
  return `sms:${phoneE164}?&body=${enc}`;
}

function telLink(phoneE164) {
  return `tel:${phoneE164}`;
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

  // On envoie le mail uniquement si paiement OK
  if (stripeEvent.type !== "checkout.session.completed") {
    return { statusCode: 200, body: "Ignored" };
  }

  try {
    const session = stripeEvent.data.object;
    const md = session.metadata || {};

    const driverEmail = md.driverEmail;
    const driverName = md.driverName || "Chauffeur";

    const customerName = md.customerName || "";
    const customerPhone = md.customerPhone || "";
    const phoneE164 = normalizePhoneToE164FR(customerPhone);

    const pickupAddress = md.pickupAddress || "";
    const dropoffAddress = md.dropoffAddress || "";
    const date = md.date || "";
    const time = md.time || "";
    const vehicle = md.vehicle || "";
    const price = md.price || "";

    if (!process.env.BREVO_API_KEY) {
      return { statusCode: 500, body: "BREVO_API_KEY missing" };
    }
    if (!process.env.MAIL_SENDER) {
      return { statusCode: 500, body: "MAIL_SENDER missing" };
    }
    if (!driverEmail) {
      return { statusCode: 500, body: "driverEmail missing in metadata" };
    }

    const msgAccept =
`Bonjour, c’est votre chauffeur.
Je vous confirme que la course a bien été acceptée.
Si vous avez le moindre impératif vous pouvez me contacter via ce numéro.`;

    const msgDecline =
`Bonjour, c’est votre chauffeur,
je suis dans le regret de vous annoncer que je ne serais pas dans la mesure de prendre votre course en charge.
Le remboursement se fera sous peu.
Cordialement.`;

    const acceptUrl = phoneE164 ? smsLink(phoneE164, msgAccept) : "";
    const declineUrl = phoneE164 ? smsLink(phoneE164, msgDecline) : "";
    const callUrl = phoneE164 ? telLink(phoneE164) : "";

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.45;color:#111;">
        <h2 style="margin:0 0 10px;">Nouvelle course payée ✅</h2>
        <p style="margin:0 0 12px;">Bonjour <b>${driverName}</b>, une course vient d’être réglée.</p>

        <div style="border:1px solid #eee;border-radius:12px;padding:12px;background:#fafafa;">
          <p style="margin:6px 0;"><b>Client :</b> ${customerName}</p>
          <p style="margin:6px 0;"><b>Téléphone :</b> ${customerPhone}</p>
          <p style="margin:6px 0;"><b>Départ :</b> ${pickupAddress}</p>
          <p style="margin:6px 0;"><b>Arrivée :</b> ${dropoffAddress}</p>
          <p style="margin:6px 0;"><b>Date/Heure :</b> ${date} • ${time}</p>
          <p style="margin:6px 0;"><b>Véhicule :</b> ${vehicle}</p>
          <p style="margin:6px 0;"><b>Prix :</b> ${price} €</p>
        </div>

        <p style="margin:14px 0 8px;"><b>Réponse rapide au client (SMS pré-rempli)</b></p>

        ${phoneE164 ? `
          <a href="${acceptUrl}"
            style="display:inline-block;margin:6px 10px 6px 0;padding:10px 12px;border-radius:10px;
            background:#16a34a;color:#fff;text-decoration:none;font-weight:bold;">
            Confirmer la course
          </a>

          <a href="${declineUrl}"
            style="display:inline-block;margin:6px 10px 6px 0;padding:10px 12px;border-radius:10px;
            background:#dc2626;color:#fff;text-decoration:none;font-weight:bold;">
            Refuser la course
          </a>

          <a href="${callUrl}"
            style="display:inline-block;margin:6px 0;padding:10px 12px;border-radius:10px;
            background:#111827;color:#fff;text-decoration:none;font-weight:bold;">
            Appeler le client
          </a>
        ` : `
          <p style="margin:8px 0;color:#666;">Numéro client invalide : impossible de préparer un SMS.</p>
        `}

        <p style="margin:14px 0 0;color:#666;font-size:12px;">
          Astuce : sur certaines applis mail, si le SMS ne s’ouvre pas, utilise “Appeler” ou copie/colle le texte.
        </p>
      </div>
    `;

    // Brevo
    const client = SibApiV3Sdk.ApiClient.instance;
    client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;

    const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

    await apiInstance.sendTransacEmail({
      sender: { email: process.env.MAIL_SENDER, name: driverName },
      to: [{ email: driverEmail }],
      subject: "Nouvelle course payée ✅",
      htmlContent: html
    });

    return { statusCode: 200, body: "OK" };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Webhook failed", details: String(e?.message || e) }) };
  }
};
