/**
 * Background service for syncing discount usage from Shopify
 * Prevents blocking page loads with expensive API calls
 */

import db from "../db.server";

// In-memory cache for usage data (5 minute TTL)
const usageCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached usage data if available and fresh
 */
function getCachedUsage(campaignId) {
  const cached = usageCache.get(campaignId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * Cache usage data
 */
function setCachedUsage(campaignId, data) {
  usageCache.set(campaignId, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Batch sync campaign usage from Shopify
 * Returns immediately with cached data, syncs in background
 */
export async function syncCampaignUsage(admin, campaigns, options = {}) {
  const { forceSync = false } = options;

  // Return campaigns with cached data immediately
  const campaignsWithCache = campaigns.map((c) => {
    const cached = getCachedUsage(c.id);
    if (cached && !forceSync) {
      return { ...c, usedCodes: cached.usedCodes };
    }
    return c;
  });

  // Trigger background sync (non-blocking)
  if (forceSync || campaigns.some((c) => !getCachedUsage(c.id))) {
    setImmediate(() => {
      syncInBackground(admin, campaigns).catch((err) => {
        console.error("Background sync error:", err);
      });
    });
  }

  return campaignsWithCache;
}

/**
 * Background sync worker - processes campaigns in batches
 */
async function syncInBackground(admin, campaigns) {
  const BATCH_SIZE = 5; // Process 5 campaigns at a time

  for (let i = 0; i < campaigns.length; i += BATCH_SIZE) {
    const batch = campaigns.slice(i, i + BATCH_SIZE);

    // Process batch in parallel
    await Promise.all(
      batch.map((campaign) => syncSingleCampaign(admin, campaign))
    );
  }
}

/**
 * Sync a single campaign's usage from Shopify
 */
async function syncSingleCampaign(admin, campaign) {
  try {
    let discountNodeId = campaign.shopifyDiscountId;

    // Lookup discount ID if missing (only for first code)
    if (!discountNodeId && campaign.codes?.[0]) {
      discountNodeId = await lookupDiscountId(admin, campaign.codes[0].code);

      if (discountNodeId) {
        // Update campaign with discovered ID
        await db.campaign.update({
          where: { id: campaign.id },
          data: { shopifyDiscountId: discountNodeId },
        });
      }
    }

    if (!discountNodeId) {
      return; // No discount ID, skip sync
    }

    // Fetch usage from Shopify
    const usageData = await fetchDiscountUsage(admin, discountNodeId);

    if (usageData) {
      const remoteTotalUsage = usageData.asyncUsageCount || 0;

      // Batch update: Only update if changed
      if (remoteTotalUsage !== campaign.usedCodes) {
        await db.campaign.update({
          where: { id: campaign.id },
          data: { usedCodes: remoteTotalUsage },
        });
      }

      // Batch update codes (collect all updates, execute together)
      const codeUpdates = [];
      const remoteCodes = usageData.codes || [];

      for (const rc of remoteCodes) {
        const matchedLocal = campaign.codes?.find(
          (lc) => lc.code.toUpperCase() === rc.code.toUpperCase()
        );

        if (matchedLocal && matchedLocal.usageCount !== rc.asyncUsageCount) {
          codeUpdates.push({
            where: { id: matchedLocal.id },
            data: { usageCount: rc.asyncUsageCount },
          });
        }
      }

      // Execute all code updates in a transaction (much faster)
      if (codeUpdates.length > 0) {
        await db.$transaction(
          codeUpdates.map((update) =>
            db.discountCode.update(update)
          )
        );
      }

      // Cache the result
      setCachedUsage(campaign.id, { usedCodes: remoteTotalUsage });
    }
  } catch (err) {
    console.warn(
      `Failed to sync campaign ${campaign.id}:`,
      err?.message || err
    );
  }
}

/**
 * Lookup discount node ID by code
 */
async function lookupDiscountId(admin, code) {
  try {
    const response = await admin.graphql(
      `#graphql
      query getDiscountIdByCode($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          id
        }
      }`,
      { variables: { code } }
    );
    const json = await response.json();
    return json.data?.codeDiscountNodeByCode?.id;
  } catch (err) {
    console.warn("Lookup discount ID error:", err?.message || err);
    return null;
  }
}

/**
 * Fetch discount usage from Shopify
 */
async function fetchDiscountUsage(admin, discountNodeId) {
  try {
    const response = await admin.graphql(
      `#graphql
      query getDiscountUsage($id: ID!) {
        codeDiscountNode(id: $id) {
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              asyncUsageCount
              codes(first: 250) {
                nodes {
                  code
                  asyncUsageCount
                }
              }
            }
            ... on DiscountCodeBxgy {
              asyncUsageCount
              codes(first: 250) {
                nodes {
                  code
                  asyncUsageCount
                }
              }
            }
            ... on DiscountCodeFreeShipping {
              asyncUsageCount
              codes(first: 250) {
                nodes {
                  code
                  asyncUsageCount
                }
              }
            }
          }
        }
      }`,
      { variables: { id: discountNodeId } }
    );

    const json = await response.json();
    const discountObj = json.data?.codeDiscountNode?.codeDiscount;

    if (discountObj) {
      return {
        asyncUsageCount: discountObj.asyncUsageCount,
        codes: discountObj.codes?.nodes || [],
      };
    }
  } catch (err) {
    console.warn("Fetch usage error:", err?.message || err);
  }

  return null;
}

/**
 * Force a full sync for specific campaigns
 */
export async function forceSyncCampaigns(admin, campaignIds) {
  const campaigns = await db.campaign.findMany({
    where: { id: { in: campaignIds } },
    include: { codes: { take: 250 } },
  });

  await syncInBackground(admin, campaigns);
}

/**
 * Clear cache for specific campaigns or all
 */
export function clearUsageCache(campaignIds = null) {
  if (campaignIds) {
    campaignIds.forEach((id) => usageCache.delete(id));
  } else {
    usageCache.clear();
  }
}
