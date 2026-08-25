import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncCampaignUsage } from "../services/discount-sync.server";

import {
  Tag,
  Plus,
  CheckCircle2,
  Ticket,
  TrendingUp,
  Clock,
  MoreHorizontal,
  ChevronRight,
  PlusCircle,
  Activity,
  Zap,
} from "lucide-react";
import { formatCurrency } from "../utils/currency";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Run independent database and network queries in parallel
  const [shopJsonRes, storeDbSetting, dbTotalCampaigns, dbActiveCampaigns, dbRecentCampaigns] = await Promise.all([
    admin.graphql(
      `#graphql
      query getShopCurrency {
        shop {
          currencyCode
        }
      }`
    ).then(res => res.json()).catch(() => null),
    db.storeSetting ? db.storeSetting.findUnique({ where: { shop } }) : null,
    db.campaign ? db.campaign.count({ where: { shop } }) : Promise.resolve(0),
    db.campaign ? db.campaign.count({ where: { shop, status: "ACTIVE" } }) : Promise.resolve(0),
    db.campaign ? db.campaign.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      include: { codes: { take: 5 } }, // Fetch minimal codes to save query speed
      take: 5,
    }) : Promise.resolve([]),
  ]);

  const currencyCode = shopJsonRes?.data?.shop?.currencyCode || "USD";

  let storeSetting = storeDbSetting;
  try {
    if (db.storeSetting && !storeSetting) {
      storeSetting = await db.storeSetting.create({
        data: { shop, plan: "PAY_AS_YOU_GO", codesLimit: 250, codesGenerated: 0 },
      });
    }
  } catch (e) {
    console.error("storeSetting loader error:", e?.message || e);
  }

  if (!storeSetting) {
    storeSetting = { plan: "PAY_AS_YOU_GO", codesLimit: 250, codesGenerated: 0 };
  }

  // Non-blocking background sync of the campaign usage statistics
  if (dbRecentCampaigns && dbRecentCampaigns.length > 0) {
    // This starts background syncing and returns immediate/cached data
    await syncCampaignUsage(admin, dbRecentCampaigns);
  }

  // Load aggregated campaign metrics from local database directly
  let totalCodesCreated = 0;
  let totalCodesUsed = 0;

  if (db.campaign) {
    const allCampaigns = await db.campaign.findMany({
      where: { shop },
      select: { totalCodes: true, usedCodes: true },
    });
    totalCodesCreated = allCampaigns.reduce((acc, c) => acc + (c.totalCodes || 0), 0);
    totalCodesUsed = allCampaigns.reduce((acc, c) => acc + (c.usedCodes || 0), 0);
  }

  return {
    storeSetting,
    totalCampaigns: dbTotalCampaigns,
    activeCampaigns: dbActiveCampaigns,
    totalCodesCreated: storeSetting.codesGenerated || totalCodesCreated,
    totalCodesUsed,
    recentCampaigns: dbRecentCampaigns,
    currencyCode,
  };
};

export default function Index() {
  const {
    storeSetting,
    totalCampaigns,
    activeCampaigns,
    totalCodesCreated,
    totalCodesUsed,
    recentCampaigns,
    currencyCode,
  } = useLoaderData();

  const navigate = useNavigate();

  const usagePctOfLimit =
    storeSetting.codesLimit > 0
      ? Math.min(100, ((storeSetting.codesGenerated / storeSetting.codesLimit) * 100).toFixed(1))
      : 0;

  const usagePctOfCreated =
    totalCodesCreated > 0
      ? ((totalCodesUsed / totalCodesCreated) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="bd-dashboard">
      <div className="bd-max-width">
        {/* Tier Usage Quota Banner */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e1e3e5",
            borderRadius: "12px",
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ background: "#e6f4ea", color: "#137333", padding: "10px", borderRadius: "10px" }}>
              <Zap size={22} />
            </div>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#1a1a1a" }}>
                Active Model: <span style={{ color: "#15803d" }}>PAY AS YOU GO</span>
                <span style={{ marginLeft: "10px", fontSize: "12px", background: "#dcfce7", color: "#15803d", padding: "2px 8px", borderRadius: "10px" }}>
                  Limit: {storeSetting.codesLimit.toLocaleString()} codes
                </span>
              </div>
              <div style={{ fontSize: "13px", color: "#616161", marginTop: "2px" }}>
                Generated <strong>{storeSetting.codesGenerated.toLocaleString()}</strong> of {storeSetting.codesLimit.toLocaleString()} codes ({usagePctOfLimit}% used)
              </div>
            </div>
          </div>
          <button
            className="bd-btn-secondary"
            onClick={() => navigate("/app/pricing")}
            style={{ fontSize: "13px", padding: "8px 16px" }}
          >
            Top Up Credits
          </button>
        </div>

        {/* Top Header & Promo Banner Grid */}
        <div className="bd-header-grid">
          {/* Left: App Title & Primary Actions */}
          <div className="bd-app-card">
            <div className="bd-app-header-row">
              <div className="bd-app-icon-bg">
                <Tag size={24} />
              </div>
              <div className="bd-app-titles">
                <h1>Bulk Discount Codes</h1>
                <p>
                  Autogenerate thousands of unique discount codes for your store in seconds.
                </p>
              </div>
            </div>

            <div className="bd-app-actions">
              <button
                className="bd-btn-primary"
                onClick={() => navigate("/app/create-codes")}
              >
                <Plus size={16} />
                Create bulk discount
              </button>
            </div>
          </div>

          {/* Right: Promotional Feature Banner */}
          <div className="bd-promo-card">
            <div
              className="bd-promo-image-container"
              id="promo-banner-image-placeholder"
            >
              <img src="/promo_image.webp" alt="Promo illustration" />
            </div>

            <div className="bd-promo-details">
              <h3>Save time. Run better promotions.</h3>
              <ul className="bd-promo-checklist">
                <li>
                  <CheckCircle2 size={16} color="#16a34a" />
                  Autogenerate unique discount codes
                </li>
                <li>
                  <CheckCircle2 size={16} color="#16a34a" />
                  Advanced rules and usage limits
                </li>
                <li>
                  <CheckCircle2 size={16} color="#16a34a" />
                  Automatic store sync
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* 4 Metric Cards */}
        <div className="bd-metrics-grid">
          {/* Metric 1 */}
          <div className="bd-metric-card">
            <div className="bd-metric-top">
              <div className="bd-metric-icon green">
                <Tag size={20} />
              </div>
            </div>
            <div>
              <div className="bd-metric-title">Total campaigns</div>
              <div className="bd-metric-value-row">
                <span className="bd-metric-value">{totalCampaigns}</span>
              </div>
              <div className="bd-metric-subtext">Total campaigns created</div>
            </div>
          </div>

          {/* Metric 2 */}
          <div className="bd-metric-card">
            <div className="bd-metric-top">
              <div className="bd-metric-icon blue">
                <Ticket size={20} />
              </div>
            </div>
            <div>
              <div className="bd-metric-title">Codes created</div>
              <div className="bd-metric-value-row">
                <span className="bd-metric-value">
                  {totalCodesCreated.toLocaleString()}
                </span>
              </div>
              <div className="bd-metric-subtext">Quota: {storeSetting.codesLimit.toLocaleString()}</div>
            </div>
          </div>

          {/* Metric 3 */}
          <div className="bd-metric-card">
            <div className="bd-metric-top">
              <div className="bd-metric-icon green">
                <TrendingUp size={20} />
              </div>
            </div>
            <div>
              <div className="bd-metric-title">Codes used</div>
              <div className="bd-metric-value-row">
                <span className="bd-metric-value">
                  {totalCodesUsed.toLocaleString()}
                </span>
                {totalCodesCreated > 0 && (
                  <span className="bd-badge-green">{usagePctOfCreated}%</span>
                )}
              </div>
              <div className="bd-metric-subtext">of total created</div>
            </div>
          </div>

          {/* Metric 4 */}
          <div className="bd-metric-card">
            <div className="bd-metric-top">
              <div className="bd-metric-icon yellow">
                <Clock size={20} />
              </div>
            </div>
            <div>
              <div className="bd-metric-title">Active campaigns</div>
              <div className="bd-metric-value-row">
                <span className="bd-metric-value">{activeCampaigns}</span>
              </div>
              <div className="bd-metric-subtext">Currently active</div>
            </div>
          </div>
        </div>

        {/* Recent Campaigns Table Card */}
        <div className="bd-table-card">
          <div className="bd-table-header">
            <h2>Recent campaigns</h2>
            <button
              className="bd-btn-secondary"
              style={{ padding: "6px 12px", fontSize: "13px" }}
              onClick={() => navigate("/app/campaigns")}
            >
              View all campaigns
            </button>
          </div>

          {recentCampaigns.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px" }}>
              <div style={{ background: "#f0fdf4", color: "#166534", width: "48px", height: "48px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "12px" }}>
                <Tag size={24} />
              </div>
              <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", fontWeight: 700, color: "#1a1a1a" }}>
                No campaigns created yet
              </h3>
              <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#616161" }}>
                Create your first bulk discount campaign to generate unique codes for your store.
              </p>
              <button
                className="bd-btn-primary"
                onClick={() => navigate("/app/create-codes")}
                style={{ background: "#166534", fontSize: "13px", padding: "8px 16px" }}
              >
                <Plus size={16} />
                Create Your First Campaign
              </button>
            </div>
          ) : (
            <div className="bd-table-wrapper">
              <table className="bd-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Total</th>
                    <th>Active</th>
                    <th>Used</th>
                    <th>Deleted</th>
                    <th>Usage</th>
                    <th>Status</th>
                    <th>Created on</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentCampaigns.map((c) => {
                    const totalCount = c.totalCodes;
                    const activeCount = c.codes ? c.codes.length : Math.max(0, c.totalCodes - (c.deletedCodes || 0));
                    const usedCount = c.codes ? c.codes.filter((cd) => cd.usageCount > 0).length : c.usedCodes;
                    const deletedCount =
                      c.deletedCodes !== undefined && c.deletedCodes !== null
                        ? c.deletedCodes
                        : Math.max(0, totalCount - activeCount);
                    const usagePct = activeCount > 0 ? parseFloat(((usedCount / activeCount) * 100).toFixed(1)) : 0;
                    const discountSub = c.discountType === "BUY_X_GET_Y"
                      ? `Buy ${c.buysQuantity} Get ${c.getsQuantity}`
                      : c.discountType === "FREE_SHIPPING"
                      ? "Free Shipping"
                      : c.discountType === "PERCENTAGE"
                      ? `${c.discountValue}% OFF`
                      : `${formatCurrency(c.discountValue, currencyCode)} OFF`;

                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="bd-campaign-name">{c.title}</div>
                          <div className="bd-campaign-sub">
                            {discountSub} • Prefix: {c.codePrefix || "CUSTOM"}
                          </div>
                        </td>
                        <td><strong>{totalCount.toLocaleString()}</strong></td>
                        <td>
                          <span style={{ fontWeight: 600, color: "#166534" }}>{activeCount.toLocaleString()}</span>
                        </td>
                        <td>{usedCount.toLocaleString()}</td>
                        <td>
                          <span style={{ color: deletedCount > 0 ? "#dc2626" : "#6b7280", fontWeight: deletedCount > 0 ? 600 : 400 }}>
                            {deletedCount.toLocaleString()}
                          </span>
                        </td>
                        <td>
                          <div className="bd-usage-col">
                            <div className="bd-progress-bg">
                              <div
                                className="bd-progress-fill"
                                style={{ width: `${Math.min(100, usagePct)}%` }}
                              />
                            </div>
                            <span className="bd-usage-text">
                              {usagePct}%
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`bd-status-badge ${c.status.toLowerCase()}`}>
                            {c.status}
                          </span>
                        </td>
                        <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                        <td>
                          <button
                            className="bd-action-icon-btn"
                            aria-label="More actions"
                            onClick={() => navigate("/app/campaigns")}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bottom Quick Action Cards */}
        <div className="bd-actions-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {/* Action 1 */}
          <div
            className="bd-quick-card"
            onClick={() => navigate("/app/create-codes")}
          >
            <div className="bd-quick-card-left">
              <div className="bd-quick-icon green">
                <PlusCircle size={20} />
              </div>
              <div className="bd-quick-card-text">
                <h4>Create bulk discount</h4>
                <p>Generate unique discount codes in seconds</p>
              </div>
            </div>
            <ChevronRight size={18} className="bd-quick-card-arrow" />
          </div>

          {/* Action 2 */}
          <div
            className="bd-quick-card"
            onClick={() => navigate("/app/activity-logs")}
          >
            <div className="bd-quick-card-left">
              <div className="bd-quick-icon gray">
                <Activity size={20} />
              </div>
              <div className="bd-quick-card-text">
                <h4>Activity Logs</h4>
                <p>View history of app campaign activities</p>
              </div>
            </div>
            <ChevronRight size={18} className="bd-quick-card-arrow" />
          </div>
        </div>
      </div>
    </div>
  );
}
