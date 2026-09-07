import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[Shopify Webhook] Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "customers/data_request":
      console.log(`[Compliance] Received customer data request for ${shop}:`, payload);
      // App does not store customer PII. Nothing to export.
      break;

    case "CUSTOMERS_REDACT":
    case "customers/redact":
      console.log(`[Compliance] Received customer redact request for ${shop}:`, payload);
      // App does not store customer PII. Nothing to redact.
      break;

    case "SHOP_REDACT":
    case "shop/redact":
      console.log(`[Compliance] Received shop redact request for ${shop}`);
      if (shop) {
        try {
          await db.session.deleteMany({ where: { shop } });
          await db.storeSetting.deleteMany({ where: { shop } });
          await db.activityLog.deleteMany({ where: { shop } });
          await db.campaign.deleteMany({ where: { shop } });
          console.log(`[Compliance] Purged all shop data for ${shop}`);
        } catch (error) {
          console.error(`[Compliance] Error purging data for ${shop}:`, error);
        }
      }
      break;

    default:
      console.log(`[Shopify Webhook] Unhandled topic: ${topic}`);
      break;
  }

  return new Response();
};
