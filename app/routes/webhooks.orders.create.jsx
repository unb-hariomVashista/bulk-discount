import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[Bulk Discount Webhook] Received ${topic} webhook for ${shop}: Order ${payload?.name || payload?.id}`);

  try {
    const discountCodes = payload?.discount_codes || [];
    if (!Array.isArray(discountCodes) || discountCodes.length === 0) {
      return new Response();
    }

    for (const dc of discountCodes) {
      const codeStr = dc.code;
      if (!codeStr) continue;

      // Find discount code record in database
      const codeRecord = await db.discountCode.findFirst({
        where: {
          code: {
            equals: codeStr,
          },
          campaign: {
            shop,
          },
        },
        include: {
          campaign: true,
        },
      });

      if (codeRecord) {
        // Increment single code usage count
        await db.discountCode.update({
          where: { id: codeRecord.id },
          data: {
            usageCount: {
              increment: 1,
            },
          },
        });

        // Increment campaign usedCodes count
        await db.campaign.update({
          where: { id: codeRecord.campaignId },
          data: {
            usedCodes: {
              increment: 1,
            },
          },
        });

        // Record in ActivityLog
        await db.activityLog.create({
          data: {
            shop,
            action: "CODE_REDEEMED",
            description: `Discount code "${codeStr}" was redeemed in Order ${payload.name || payload.id} (Saved ${dc.amount || "0.00"}).`,
          },
        });

        console.log(`[Bulk Discount Webhook] Successfully updated usage for code ${codeStr}`);
      }
    }
  } catch (err) {
    console.error("[Bulk Discount Webhook] Error updating discount code usage from order:", err?.message || err);
  }

  return new Response();
};
