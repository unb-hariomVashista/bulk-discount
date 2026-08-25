import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("Shop redact payload:", payload);

  // 48 hours after uninstall, shop redact webhook is sent.
  // Purge store settings, session records, and campaign logs for shop.
  if (shop) {
    try {
      await db.session.deleteMany({ where: { shop } });
      await db.storeSetting.deleteMany({ where: { shop } });
      await db.activityLog.deleteMany({ where: { shop } });
    } catch (error) {
      console.error("Error performing shop redact cleanup:", error);
    }
  }

  return new Response();
};
