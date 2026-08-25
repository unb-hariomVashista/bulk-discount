import { useState } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncCampaignUsage, clearUsageCache } from "../services/discount-sync.server";
import {
  Plus,
  Trash2,
  Search,
  Filter,
  Eye,
  Download,
  Copy,
  Check,
  X,
  Tag,
  AlertCircle,
  CopyCheck,
  CheckSquare,
  Square,
} from "lucide-react";
import { formatCurrency } from "../utils/currency";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch shop currency and campaigns in parallel
  const [shopJsonRes, allCampaigns] = await Promise.all([
    admin.graphql(
      `#graphql
      query getShopCurrency {
        shop {
          currencyCode
        }
      }`
    ).then(res => res.json()).catch(() => null),
    db.campaign ? db.campaign.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      include: {
        codes: {
          take: 1000,
        },
      },
    }) : Promise.resolve([]),
  ]);

  const currencyCode = shopJsonRes?.data?.shop?.currencyCode || "USD";

  // Trigger non-blocking sync in background using discount-sync utility
  if (allCampaigns && allCampaigns.length > 0) {
    await syncCampaignUsage(admin, allCampaigns);
  }

  return { campaigns: allCampaigns, shop, currencyCode };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType");
  const campaignId = formData.get("campaignId");
  const codeId = formData.get("codeId");
  const codeIdsJson = formData.get("codeIds");

  // Clear relevant caches upon updates
  if (campaignId) {
    clearUsageCache([campaignId]);
  }

  // 1. DELETE MULTIPLE DISCOUNT CODES (BATCH)
  if (actionType === "DELETE_MULTIPLE_CODES" && codeIdsJson && campaignId) {
    try {
      const idsArray = JSON.parse(codeIdsJson);
      if (!Array.isArray(idsArray) || idsArray.length === 0) {
        return { error: "No codes selected for deletion." };
      }

      const discountCodes = await db.discountCode.findMany({
        where: { id: { in: idsArray } },
        include: { campaign: true },
      });

      if (discountCodes.length > 0) {
        const campaign = discountCodes[0].campaign;
        let discountId = campaign?.shopifyDiscountId;

        // Fallback lookup if shopifyDiscountId is missing
        if (!discountId && discountCodes[0]?.code) {
          try {
            const lookupRes = await admin.graphql(
              `#graphql
              query getDiscountNodeByCode($code: String!) {
                codeDiscountNodeByCode(code: $code) {
                  id
                }
              }`,
              { variables: { code: discountCodes[0].code } }
            );
            const lookupJson = await lookupRes.json();
            discountId = lookupJson.data?.codeDiscountNodeByCode?.id;
          } catch (lErr) {
            console.warn("Lookup discount node note:", lErr?.message || lErr);
          }
        }

        // Delete from Shopify
        if (discountId) {
          try {
            if (campaign.totalCodes <= discountCodes.length) {
              // If deleting all remaining codes, delete the entire discount node
              await admin.graphql(
                `#graphql
                mutation discountCodeDelete($id: ID!) {
                  discountCodeDelete(id: $id) {
                    deletedCodeDiscountId
                    userErrors {
                      field
                      message
                    }
                  }
                }`,
                { variables: { id: discountId } }
              );
            } else {
              // Delete each code from Shopify
              for (const dc of discountCodes) {
                try {
                  await admin.graphql(
                    `#graphql
                    mutation discountCodeRedeemCodeBulkDelete($discountId: ID!, $search: String) {
                      discountCodeRedeemCodeBulkDelete(discountId: $discountId, search: $search) {
                        job {
                          id
                        }
                        userErrors {
                          field
                          message
                        }
                      }
                    }`,
                    {
                      variables: {
                        discountId,
                        search: dc.code,
                      },
                    }
                  );
                } catch (cErr) {
                  console.warn(`Failed to delete code ${dc.code} from Shopify:`, cErr?.message || cErr);
                }
              }
            }
          } catch (shopErr) {
            console.error("Shopify GraphQL batch deletion error:", shopErr?.message || shopErr);
          }
        }

        // Delete from local DB
        await db.discountCode.deleteMany({
          where: { id: { in: idsArray } },
        });

        // Refund quota to store
        try {
          const storeSetting = await db.storeSetting.findUnique({ where: { shop } });
          if (storeSetting && storeSetting.codesGenerated > 0) {
            await db.storeSetting.update({
              where: { shop },
              data: {
                codesGenerated: Math.max(0, storeSetting.codesGenerated - idsArray.length),
              },
            });
          }
        } catch (sErr) {
          console.error("Failed to decrement store quota:", sErr?.message || sErr);
        }

        await db.activityLog.create({
          data: {
            shop,
            action: "CODES_DELETED",
            description: `Deleted ${idsArray.length} discount codes from campaign "${campaign.title}".`,
          },
        });

        return { success: true, message: `Successfully deleted ${idsArray.length} discount codes.` };
      }
    } catch (err) {
      console.error("Batch code deletion error:", err?.message || err);
      return { error: "Failed to delete selected discount codes." };
    }
  }

  // 2. DELETE SINGLE DISCOUNT CODE
  if (actionType === "DELETE_CODE" && codeId && campaignId) {
    try {
      const discountCode = await db.discountCode.findUnique({
        where: { id: codeId },
        include: { campaign: true },
      });

      if (discountCode) {
        let discountId = discountCode.campaign?.shopifyDiscountId;

        // If shopifyDiscountId is not stored on campaign, look it up by code in Shopify
        if (!discountId) {
          try {
            const lookupRes = await admin.graphql(
              `#graphql
              query getDiscountNodeByCode($code: String!) {
                codeDiscountNodeByCode(code: $code) {
                  id
                }
              }`,
              { variables: { code: discountCode.code } }
            );
            const lookupJson = await lookupRes.json();
            discountId = lookupJson.data?.codeDiscountNodeByCode?.id;
          } catch (lErr) {
            console.warn("Lookup discount node by code note:", lErr?.message || lErr);
          }
        }

        // Delete code from Shopify
        if (discountId) {
          try {
            if (discountCode.campaign.totalCodes <= 1) {
              await admin.graphql(
                `#graphql
                mutation discountCodeDelete($id: ID!) {
                  discountCodeDelete(id: $id) {
                    deletedCodeDiscountId
                    userErrors {
                      field
                      message
                    }
                  }
                }`,
                { variables: { id: discountId } }
              );
            } else {
              const delRes = await admin.graphql(
                `#graphql
                mutation discountCodeRedeemCodeBulkDelete($discountId: ID!, $search: String) {
                  discountCodeRedeemCodeBulkDelete(discountId: $discountId, search: $search) {
                    job {
                      id
                    }
                    userErrors {
                      field
                      message
                    }
                  }
                }`,
                {
                  variables: {
                    discountId,
                    search: discountCode.code,
                  },
                }
              );
              const delJson = await delRes.json();
              console.log("Shopify redeem code bulk delete result:", JSON.stringify(delJson, null, 2));
            }
          } catch (shopErr) {
            console.error("Shopify GraphQL single code deletion error:", shopErr?.message || shopErr);
          }
        }

        // Delete from local DB
        await db.discountCode.delete({
          where: { id: codeId },
        });

        // Refund quota to store
        try {
          const storeSetting = await db.storeSetting.findUnique({ where: { shop } });
          if (storeSetting && storeSetting.codesGenerated > 0) {
            await db.storeSetting.update({
              where: { shop },
              data: {
                codesGenerated: Math.max(0, storeSetting.codesGenerated - 1),
              },
            });
          }
        } catch (sErr) {
          console.error("Failed to decrement store quota:", sErr?.message || sErr);
        }

        await db.activityLog.create({
          data: {
            shop,
            action: "CODE_DELETED",
            description: `Deleted discount code "${discountCode.code}" from campaign "${discountCode.campaign.title}".`,
          },
        });

        return { success: true, message: `Code ${discountCode.code} deleted successfully from Shopify & app.` };
      }
    } catch (err) {
      console.error("Code deletion error:", err?.message || err);
      return { error: "Failed to delete discount code." };
    }
  }

  // 3. DELETE ENTIRE CAMPAIGN (AND ALL ITS CODES)
  if ((actionType === "DELETE" || actionType === "DELETE_CAMPAIGN") && campaignId) {
    try {
      const campaign = await db.campaign.findUnique({
        where: { id: campaignId },
      });

      if (campaign) {
        if (campaign.shopifyDiscountId) {
          try {
            await admin.graphql(
              `#graphql
              mutation discountCodeDelete($id: ID!) {
                discountCodeDelete(id: $id) {
                  deletedCodeDiscountId
                  userErrors {
                    field
                    message
                  }
                }
              }`,
              {
                variables: {
                  id: campaign.shopifyDiscountId,
                },
              }
            );
          } catch (shopErr) {
            console.warn("Shopify GraphQL campaign deletion warning:", shopErr?.message || shopErr);
          }
        }

        // Refund unused quota to store
        try {
          const unusedCodes = Math.max(0, campaign.totalCodes - campaign.usedCodes);
          const storeSetting = await db.storeSetting.findUnique({ where: { shop } });
          if (storeSetting && storeSetting.codesGenerated > 0) {
            await db.storeSetting.update({
              where: { shop },
              data: {
                codesGenerated: Math.max(0, storeSetting.codesGenerated - unusedCodes),
              },
            });
          }
        } catch (sErr) {
          console.error("Failed to refund quota:", sErr?.message || sErr);
        }

        // Delete from local DB (Prisma cascade deletes associated DiscountCodes)
        await db.campaign.delete({
          where: { id: campaignId },
        });

        await db.activityLog.create({
          data: {
            shop,
            action: "CAMPAIGN_DELETED",
            description: `Deleted campaign "${campaign.title}" (${campaign.totalCodes} codes) and removed it from Shopify.`,
          },
        });

        return { success: true, message: `Campaign "${campaign.title}" deleted.` };
      }
    } catch (err) {
      console.error("Campaign deletion error:", err?.message || err);
      return { error: "Failed to delete campaign." };
    }
  }

  return { success: true };
};

export default function CampaignsPage() {
  const { campaigns, currencyCode } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [activeModalCampaign, setActiveModalCampaign] = useState(null);
  const [modalSearchTerm, setModalSearchTerm] = useState("");
  const [selectedCodeIds, setSelectedCodeIds] = useState([]);
  const [copiedCode, setCopiedCode] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const filteredCampaigns = campaigns.filter((c) => {
    const matchesSearch =
      c.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.codePrefix && c.codePrefix.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleCopy = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleCopyAllCodes = (codesList) => {
    if (!codesList || codesList.length === 0) return;
    const allCodesString = codesList.map((c) => c.code).join("\n");
    navigator.clipboard.writeText(allCodesString);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  };

  const handleExportCSV = (campaign) => {
    if (!campaign.codes || campaign.codes.length === 0) return;
    const header = "Code,Usage Count,Max Uses,Created At\n";
    const rows = campaign.codes
      .map((c) => `"${c.code}",${c.usageCount},${c.maxUses},"${new Date(c.createdAt).toISOString()}"`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${campaign.title.replace(/\s+/g, "_")}_discount_codes.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectedCampaignForModal = activeModalCampaign
    ? campaigns.find((c) => c.id === activeModalCampaign.id) || activeModalCampaign
    : null;

  const modalFilteredCodes = selectedCampaignForModal?.codes
    ? selectedCampaignForModal.codes.filter((c) =>
        c.code.toLowerCase().includes(modalSearchTerm.toLowerCase())
      )
    : [];

  const isAllModalCodesSelected =
    modalFilteredCodes.length > 0 &&
    modalFilteredCodes.every((c) => selectedCodeIds.includes(c.id));

  const toggleSelectAllModalCodes = () => {
    if (isAllModalCodesSelected) {
      const filteredIds = new Set(modalFilteredCodes.map((c) => c.id));
      setSelectedCodeIds(selectedCodeIds.filter((id) => !filteredIds.has(id)));
    } else {
      const combined = new Set([...selectedCodeIds, ...modalFilteredCodes.map((c) => c.id)]);
      setSelectedCodeIds(Array.from(combined));
    }
  };

  const toggleSelectSingleCode = (id) => {
    if (selectedCodeIds.includes(id)) {
      setSelectedCodeIds(selectedCodeIds.filter((cId) => cId !== id));
    } else {
      setSelectedCodeIds([...selectedCodeIds, id]);
    }
  };

  const isDeletingBatch =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("actionType") === "DELETE_MULTIPLE_CODES";

  return (
    <div className="bd-dashboard">
      <div className="bd-max-width">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>Discount Campaigns</h1>
            <p style={{ margin: "4px 0 0 0", color: "#616161", fontSize: "14px" }}>
              View, manage, export, and delete generated discount campaigns and individual codes.
            </p>
          </div>
          <button
            className="bd-btn-primary"
            onClick={() => navigate("/app/create-codes")}
          >
            <Plus size={16} />
            Create Bulk Discount
          </button>
        </div>

        {/* Action feedback */}
        {fetcher.data?.message && (
          <div
            style={{
              background: "#f0fdf4",
              border: "1px solid #86efac",
              color: "#166534",
              padding: "12px 16px",
              borderRadius: "8px",
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Check size={18} />
            <span>{fetcher.data.message}</span>
          </div>
        )}

        {fetcher.data?.error && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              color: "#991b1b",
              padding: "12px 16px",
              borderRadius: "8px",
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <AlertCircle size={18} />
            <span>{fetcher.data.error}</span>
          </div>
        )}

        {/* Filter Bar */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e1e3e5",
            borderRadius: "12px",
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div style={{ position: "relative", flex: 1, maxWidth: "350px" }}>
            <Search
              size={18}
              style={{ position: "absolute", left: "12px", top: "10px", color: "#8c9196" }}
            />
            <input
              type="text"
              placeholder="Search by campaign title or prefix..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 14px 8px 36px",
                borderRadius: "8px",
                border: "1px solid #c9cccf",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Filter size={16} color="#616161" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1px solid #c9cccf",
                fontSize: "14px",
                background: "#ffffff",
              }}
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="EXPIRED">Expired</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        </div>

        {/* Campaigns Table Card */}
        <div className="bd-table-card">
          <div className="bd-table-wrapper">
            <table className="bd-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Prefix</th>
                  <th>Total</th>
                  <th>Active</th>
                  <th>Used</th>
                  <th>Deleted</th>
                  <th>Usage %</th>
                  <th>Discount</th>
                  <th>Status</th>
                  <th>Created On</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: "center", padding: "40px", color: "#616161" }}>
                      No campaigns found. Click <strong>"Create Bulk Discount"</strong> to generate your first batch!
                    </td>
                  </tr>
                ) : (
                  filteredCampaigns.map((c) => {
                    const totalCount = c.totalCodes;
                    const activeCount = c.codes ? c.codes.length : Math.max(0, c.totalCodes - (c.deletedCodes || 0));
                    const usedCount = c.codes ? c.codes.filter((cd) => cd.usageCount > 0).length : c.usedCodes;
                    const deletedCount =
                      c.deletedCodes !== undefined && c.deletedCodes !== null
                        ? c.deletedCodes
                        : Math.max(0, totalCount - activeCount);
                    const usagePct = activeCount > 0 ? ((usedCount / activeCount) * 100).toFixed(1) : 0;

                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="bd-campaign-name" style={{ fontWeight: 600, color: "#1a1a1a" }}>{c.title}</div>
                          <div className="bd-campaign-sub" style={{ fontSize: "12px", color: "#616161" }}>
                            {c.minRequirementType === "NONE"
                              ? "No min requirement"
                              : c.minRequirementType === "MIN_AMOUNT"
                              ? `Min spend ${formatCurrency(c.minRequirementValue, currencyCode)}`
                              : `Min qty ${c.minRequirementValue}`}
                          </div>
                        </td>
                        <td>
                          <code style={{ background: "#f1f2f4", padding: "3px 8px", borderRadius: "4px", fontSize: "12px" }}>
                            {c.codePrefix ? `${c.codePrefix}*` : "CUSTOM"}
                          </code>
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
                            <span className="bd-usage-text">{usagePct}%</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>
                            {c.discountType === "BUY_X_GET_Y"
                              ? `BUY ${c.buysQuantity || 1} GET ${c.getsQuantity || 1} ${c.getsDiscountType === "PERCENTAGE" ? `${c.getsDiscountValue}% OFF` : "FREE"}`
                              : c.discountType === "FREE_SHIPPING"
                              ? "FREE SHIPPING"
                              : c.discountType === "PERCENTAGE"
                              ? `${c.discountValue}% OFF`
                              : `${formatCurrency(c.discountValue, currencyCode)} OFF`}
                          </span>
                        </td>
                        <td>
                          <span className={`bd-status-badge ${c.status.toLowerCase()}`}>
                            {c.status}
                          </span>
                        </td>
                        <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            {/* View Codes Button */}
                            <button
                              type="button"
                              className="bd-action-icon-btn"
                              title="View & Delete Codes"
                              onClick={() => {
                                setActiveModalCampaign(c);
                                setModalSearchTerm("");
                                setSelectedCodeIds([]);
                              }}
                              style={{
                                background: "#f1f2f4",
                                border: "1px solid #d1d5db",
                                padding: "6px",
                                borderRadius: "6px",
                                cursor: "pointer",
                              }}
                            >
                              <Eye size={16} color="#374151" />
                            </button>

                            {/* Export CSV Button */}
                            <button
                              type="button"
                              className="bd-action-icon-btn"
                              title="Export CSV"
                              onClick={() => handleExportCSV(c)}
                              style={{
                                background: "#f1f2f4",
                                border: "1px solid #d1d5db",
                                padding: "6px",
                                borderRadius: "6px",
                                cursor: "pointer",
                              }}
                            >
                              <Download size={16} color="#374151" />
                            </button>

                            {/* Delete Campaign Button */}
                            <fetcher.Form method="POST" style={{ display: "inline" }}>
                              <input type="hidden" name="campaignId" value={c.id} />
                              <input type="hidden" name="actionType" value="DELETE_CAMPAIGN" />
                              <button
                                type="submit"
                                className="bd-action-icon-btn"
                                title="Delete campaign from Shopify & App"
                                style={{
                                  background: "#fef2f2",
                                  border: "1px solid #fca5a5",
                                  color: "#dc2626",
                                  padding: "6px",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                }}
                                onClick={(e) => {
                                  if (
                                    !confirm(
                                      `Are you sure you want to delete campaign "${c.title}" and its ${c.totalCodes} discount codes from Shopify? This action cannot be undone.`
                                    )
                                  ) {
                                    e.preventDefault();
                                  }
                                }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </fetcher.Form>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* VIEW & DELETE INDIVIDUAL / BULK CODES MODAL */}
      {selectedCampaignForModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              maxWidth: "760px",
              width: "100%",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#111827", display: "flex", alignItems: "center", gap: "8px" }}>
                  <Tag size={18} color="#166534" />
                  {selectedCampaignForModal.title} &mdash; Codes ({selectedCampaignForModal.codes?.length || 0})
                </h3>
                <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#6b7280" }}>
                  Total Generated: <strong>{selectedCampaignForModal.totalCodes}</strong> &bull; Active: <strong style={{ color: "#166534" }}>{selectedCampaignForModal.codes?.length || 0}</strong> &bull; Deleted: <strong style={{ color: "#dc2626" }}>{selectedCampaignForModal.deletedCodes || Math.max(0, selectedCampaignForModal.totalCodes - (selectedCampaignForModal.codes?.length || 0))}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveModalCampaign(null);
                  setSelectedCodeIds([]);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "#6b7280",
                  padding: "4px",
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Search & Filter Bar */}
            <div
              style={{
                padding: "12px 24px",
                background: "#f9fafb",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              {/* Search specific code */}
              <div style={{ position: "relative", flex: 1 }}>
                <Search size={16} style={{ position: "absolute", left: "10px", top: "9px", color: "#9ca3af" }} />
                <input
                  type="text"
                  placeholder="Search code (e.g. DIWALI-)..."
                  value={modalSearchTerm}
                  onChange={(e) => setModalSearchTerm(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 12px 7px 32px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Action Buttons: Copy All, Export CSV */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {/* Copy All Codes Button */}
                <button
                  type="button"
                  onClick={() => handleCopyAllCodes(modalFilteredCodes)}
                  className="bd-btn-secondary"
                  title="Copy all visible codes"
                  style={{
                    fontSize: "12px",
                    padding: "6px 12px",
                    background: copiedAll ? "#dcfce7" : "#ffffff",
                    borderColor: copiedAll ? "#86efac" : "#d1d5db",
                    color: copiedAll ? "#166534" : "#374151",
                  }}
                >
                  {copiedAll ? <Check size={14} /> : <CopyCheck size={14} />}
                  <span>{copiedAll ? "All Copied!" : "Copy All"}</span>
                </button>

                {/* Export CSV Button */}
                <button
                  type="button"
                  onClick={() => handleExportCSV(selectedCampaignForModal)}
                  className="bd-btn-secondary"
                  style={{ fontSize: "12px", padding: "6px 12px" }}
                >
                  <Download size={14} /> Export CSV
                </button>
              </div>
            </div>

            {/* Multi-Select Action Bar (Shows when codes are selected) */}
            <div
              style={{
                padding: "8px 24px",
                background: selectedCodeIds.length > 0 ? "#eff6ff" : "#ffffff",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: "13px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={toggleSelectAllModalCodes}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#374151",
                    padding: 0,
                  }}
                >
                  {isAllModalCodesSelected ? (
                    <CheckSquare size={16} color="#166534" />
                  ) : (
                    <Square size={16} color="#9ca3af" />
                  )}
                  <span>
                    Select All ({modalFilteredCodes.length})
                  </span>
                </button>
                {selectedCodeIds.length > 0 && (
                  <span style={{ color: "#2563eb", fontWeight: 600, marginLeft: "8px" }}>
                    &bull; {selectedCodeIds.length} selected
                  </span>
                )}
              </div>

              {selectedCodeIds.length > 0 && (
                <fetcher.Form
                  method="POST"
                  onSubmit={(e) => {
                    if (
                      !confirm(
                        `Are you sure you want to delete ${selectedCodeIds.length} selected discount codes from Shopify & the app?`
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="actionType" value="DELETE_MULTIPLE_CODES" />
                  <input type="hidden" name="campaignId" value={selectedCampaignForModal.id} />
                  <input type="hidden" name="codeIds" value={JSON.stringify(selectedCodeIds)} />
                  <button
                    type="submit"
                    disabled={isDeletingBatch}
                    style={{
                      background: "#dc2626",
                      color: "#ffffff",
                      border: "none",
                      padding: "6px 14px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <Trash2 size={14} />
                    {isDeletingBatch
                      ? "Deleting..."
                      : `Delete Selected (${selectedCodeIds.length})`}
                  </button>
                </fetcher.Form>
              )}
            </div>

            {/* Codes List Table/Grid */}
            <div style={{ padding: "16px 24px", overflowY: "auto", flex: 1 }}>
              {modalFilteredCodes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>
                  {modalSearchTerm ? "No discount codes match your search query." : "No codes available in this campaign."}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {modalFilteredCodes.map((codeItem) => {
                    const isSelected = selectedCodeIds.includes(codeItem.id);
                    return (
                      <div
                        key={codeItem.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          background: isSelected ? "#f0fdf4" : "#f9fafb",
                          borderRadius: "8px",
                          border: isSelected ? "1px solid #86efac" : "1px solid #e5e7eb",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {/* Selection Checkbox */}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectSingleCode(codeItem.id)}
                            style={{
                              width: "16px",
                              height: "16px",
                              accentColor: "#166534",
                              cursor: "pointer",
                            }}
                          />

                          {/* Code String */}
                          <code style={{ fontSize: "14px", fontWeight: 700, color: "#166534", letterSpacing: "0.5px" }}>
                            {codeItem.code}
                          </code>

                          {/* Uses Count */}
                          <span style={{ fontSize: "12px", color: "#6b7280" }}>
                            Uses: {codeItem.usageCount} / {codeItem.maxUses}
                          </span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {/* Copy Code */}
                          <button
                            type="button"
                            onClick={() => handleCopy(codeItem.code)}
                            title="Copy Code"
                            style={{
                              background: copiedCode === codeItem.code ? "#dcfce7" : "#ffffff",
                              border: "1px solid #d1d5db",
                              borderRadius: "6px",
                              padding: "6px 10px",
                              fontSize: "12px",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              cursor: "pointer",
                              color: copiedCode === codeItem.code ? "#166534" : "#374151",
                            }}
                          >
                            {copiedCode === codeItem.code ? <Check size={14} /> : <Copy size={14} />}
                            {copiedCode === codeItem.code ? "Copied" : "Copy"}
                          </button>

                          {/* Delete Single Code */}
                          <fetcher.Form method="POST" style={{ display: "inline" }}>
                            <input type="hidden" name="actionType" value="DELETE_CODE" />
                            <input type="hidden" name="campaignId" value={selectedCampaignForModal.id} />
                            <input type="hidden" name="codeId" value={codeItem.id} />
                            <button
                              type="submit"
                              title="Delete this code from Shopify & App"
                              style={{
                                background: "#fef2f2",
                                border: "1px solid #fca5a5",
                                color: "#dc2626",
                                borderRadius: "6px",
                                padding: "6px 10px",
                                fontSize: "12px",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                cursor: "pointer",
                              }}
                              onClick={(e) => {
                                if (!confirm(`Are you sure you want to delete discount code "${codeItem.code}"?`)) {
                                  e.preventDefault();
                                }
                              }}
                            >
                              <Trash2 size={14} /> Delete
                            </button>
                          </fetcher.Form>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e5e7eb",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: "13px", color: "#6b7280" }}>
                Showing <strong>{modalFilteredCodes.length}</strong> of <strong>{selectedCampaignForModal.codes?.length || 0}</strong> codes
              </div>
              <button
                type="button"
                className="bd-btn-secondary"
                onClick={() => {
                  setActiveModalCampaign(null);
                  setSelectedCodeIds([]);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
