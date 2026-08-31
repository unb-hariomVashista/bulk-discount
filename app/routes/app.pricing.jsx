import { useEffect } from "react";
import {
  Form,
  useLoaderData,
  useRouteError,
  useActionData,
} from "react-router";
import { authenticate } from "../shopify.server";
import {
  PACK_10K,
  PACK_100K,
  PACK_250K,
  PAYG_PACKS,
} from "../billing.constants";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import {
  CheckCircle2,
  Zap,
  ShieldCheck,
  Info,
  PlusCircle,
  Coins,
} from "lucide-react";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let storeSetting = null;
  try {
    if (db.storeSetting) {
      storeSetting = await db.storeSetting.findUnique({ where: { shop } });
      if (!storeSetting) {
        storeSetting = await db.storeSetting.create({
          data: {
            shop,
            plan: "PAY_AS_YOU_GO",
            codesLimit: 250,
            codesGenerated: 0,
          },
        });
      }
    }
  } catch (e) {
    console.error("storeSetting loader error:", e?.message || e);
  }

  if (!storeSetting) {
    storeSetting = {
      plan: "PAY_AS_YOU_GO",
      codesLimit: 250,
      codesGenerated: 0,
    };
  }

  const url = new URL(request.url);
  const purchasedPackKey = url.searchParams.get("purchasedPack");
  const chargeId = url.searchParams.get("charge_id");
  let justPurchasedPack = null;

  if (purchasedPackKey && PAYG_PACKS[purchasedPackKey]) {
    const pack = PAYG_PACKS[purchasedPackKey];

    if (chargeId) {
      const fullChargeId = chargeId.startsWith("gid://")
        ? chargeId
        : `gid://shopify/AppPurchaseOneTime/${chargeId}`;

      try {
        const existingLog = await db.activityLog.findFirst({
          where: {
            shop,
            action: "CREDITS_PURCHASED",
            details: fullChargeId,
          },
        });

        if (!existingLog) {
          let isPaymentVerified = true;
          if (admin && admin.graphql) {
            try {
              const response = await admin.graphql(
                `#graphql
                query checkAppPurchase($id: ID!) {
                  node(id: $id) {
                    ... on AppPurchaseOneTime {
                      id
                      status
                    }
                  }
                }`,
                { variables: { id: fullChargeId } },
              );
              const resJson = await response.json();
              const status = resJson?.data?.node?.status;
              if (status && status !== "ACTIVE" && status !== "ACCEPTED") {
                isPaymentVerified = false;
              }
            } catch (graphqlErr) {
              console.warn(
                "[Bulk Discount] GraphQL charge check warning:",
                graphqlErr?.message || graphqlErr,
              );
            }
          }

          if (isPaymentVerified) {
            storeSetting = await db.storeSetting.update({
              where: { shop },
              data: {
                codesLimit: { increment: pack.limitAdd },
              },
            });

            await db.activityLog.create({
              data: {
                shop,
                action: "CREDITS_PURCHASED",
                description: `Purchased top-up pack ${pack.name} (+${pack.limitAdd.toLocaleString()} codes for ${pack.price}).`,
                details: fullChargeId,
              },
            });

            justPurchasedPack = pack;
          }
        }
      } catch (err) {
        console.error("[Bulk Discount] Failed to record purchase:", err);
      }
    }
  }

  return { storeSetting, justPurchasedPack };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const packKey = formData.get("packKey");

  const pack = PAYG_PACKS[packKey];
  if (!pack || !pack.limitAdd) {
    return { error: "Invalid top-up pack selected." };
  }

  const shopifyPlanName = packKey;
  const url = new URL(request.url);
  const shopHandle = session.shop.replace(".myshopify.com", "");
  const apiKey = process.env.SHOPIFY_API_KEY;

  const returnUrl =
    apiKey && shopHandle
      ? `https://admin.shopify.com/store/${shopHandle}/apps/${apiKey}/app/pricing?purchasedPack=${packKey}`
      : `${url.origin}/app/pricing?purchasedPack=${packKey}`;

  try {
    return await billing.request({
      plan: shopifyPlanName,
      isTest: true,
      returnUrl,
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    const errorDataMsg = error?.errorData?.[0]?.message || "";
    const isDistributionError =
      error?.message?.includes("without a public distribution") ||
      errorDataMsg.includes("without a public distribution");

    if (isDistributionError) {
      const updatedSetting = await db.storeSetting.update({
        where: { shop },
        data: {
          codesLimit: { increment: pack.limitAdd },
        },
      });

      await db.activityLog.create({
        data: {
          shop,
          action: "CREDITS_PURCHASED",
          description: `Added top-up pack ${pack.name} (+${pack.limitAdd.toLocaleString()} codes for ${pack.price}) [Dev Mode].`,
          details: `DEV_MODE_${Date.now()}`,
        },
      });

      return {
        success: true,
        updatedSetting,
        info: `Successfully added +${pack.limitAdd.toLocaleString()} discount codes to your balance! Your new total limit is ${updatedSetting.codesLimit.toLocaleString()} codes.`,
      };
    }

    throw error;
  }
};

export default function PricingPage() {
  const { storeSetting, justPurchasedPack } = useLoaderData();
  const actionData = useActionData();

  const remainingCodes = Math.max(
    0,
    storeSetting.codesLimit - storeSetting.codesGenerated,
  );

  const packs = [
    {
      id: "FREE",
      name: "Free Baseline",
      price: "$0",
      type: "Included",
      limitLabel: "250 Free Codes",
      subtext: "Included automatically for all stores",
      popular: false,
      isFree: true,
      features: [
        "250 initial discount codes included",
        "Prefix code generator",
        "Fixed amount & percentage discounts",
        "CSV export & import",
        "Activity log audit trail",
      ],
    },
    {
      id: PACK_10K,
      name: "10K Code Pack",
      price: "$1",
      type: "One-time",
      limitAdd: 10000,
      limitLabel: "+10,000 Extra Codes",
      subtext: "$1.00 USD one-time purchase",
      popular: false,
      isFree: false,
      features: [
        "Adds +10,000 unique codes to your balance",
        "No monthly recurring charges",
        "Buy as many times as needed",
        "Prefix & custom code length (6-12)",
        "Priority generation & CSV export",
      ],
    },
    {
      id: PACK_100K,
      name: "100K Code Pack",
      price: "$3",
      type: "One-time",
      limitAdd: 100000,
      limitLabel: "+100,000 Extra Codes",
      subtext: "$3.00 USD one-time purchase",
      popular: true,
      badgeText: "Best Value",
      isFree: false,
      features: [
        "Adds +100,000 unique codes to your balance",
        "No monthly recurring charges",
        "Buy as many times as needed",
        "High-performance batch generation",
        "All discount types & usage limits",
        "Priority audit log tracking",
      ],
    },
    {
      id: PACK_250K,
      name: "250K Code Pack",
      price: "$5",
      type: "One-time",
      limitAdd: 250000,
      limitLabel: "+250,000 Extra Codes",
      subtext: "$5.00 USD one-time purchase",
      popular: false,
      badgeText: "Enterprise Scale",
      isFree: false,
      features: [
        "Adds +250,000 unique codes to your balance",
        "No monthly recurring charges",
        "Buy as many times as needed",
        "Maximum generation performance",
        "Large-scale campaign support",
        "Priority store support",
      ],
    },
  ];

  return (
    <div className="bd-dashboard">
      <div className="bd-max-width">
        {/* Header */}
        <div style={{ textAlign: "center", margin: "20px 0 30px 0" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "#dcfce7",
              color: "#166534",
              padding: "6px 14px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: 700,
              marginBottom: "12px",
            }}
          >
            <Coins size={16} /> Pay-As-You-Go Credit Top-Ups
          </div>
          <h1
            style={{
              margin: "0 0 8px 0",
              fontSize: "28px",
              fontWeight: 800,
              color: "#1a1a1a",
            }}
          >
            Top Up Discount Code Credits On Demand
          </h1>
          <p
            style={{
              margin: 0,
              color: "#616161",
              fontSize: "15px",
              maxWidth: "620px",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            No monthly subscription commitments! Every store starts with{" "}
            <strong>250 Free Codes</strong>. Top up your code balance whenever
            you need more for your campaigns.
          </p>
        </div>

        {actionData?.info && (
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #93c5fd",
              color: "#1e40af",
              padding: "14px 18px",
              borderRadius: "10px",
              marginBottom: "24px",
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              fontSize: "14px",
              lineHeight: "1.5",
            }}
          >
            <Info
              size={20}
              color="#2563eb"
              style={{ flexShrink: 0, marginTop: "2px" }}
            />
            <div>{actionData.info}</div>
          </div>
        )}

        {justPurchasedPack && (
          <div
            style={{
              background: "#dcfce7",
              border: "1px solid #86efac",
              color: "#166534",
              padding: "14px 18px",
              borderRadius: "10px",
              marginBottom: "24px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={20} color="#16a34a" />
            <span>
              Success! Added +{justPurchasedPack.limitAdd?.toLocaleString()}{" "}
              discount codes to your account balance.
            </span>
          </div>
        )}

        {/* Current Balance / Quota Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e1e3e5",
            borderRadius: "12px",
            padding: "20px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "30px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                background: "#0d0d0d",
                color: "#ffffff",
                padding: "12px",
                borderRadius: "12px",
              }}
            >
              <Zap size={24} />
            </div>
            <div>
              <div
                style={{
                  fontSize: "13px",
                  color: "#616161",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  fontWeight: 600,
                }}
              >
                Active Billing Plan
              </div>
              <div
                style={{
                  fontSize: "20px",
                  fontWeight: 800,
                  color: "#1a1a1a",
                  marginTop: "2px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                Pay-As-You-Go Model
                <span
                  style={{
                    fontSize: "12px",
                    color: "#166534",
                    background: "#dcfce7",
                    padding: "3px 10px",
                    borderRadius: "12px",
                    fontWeight: 700,
                  }}
                >
                  Active Balance
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "32px", textAlign: "right" }}>
            <div>
              <div
                style={{ fontSize: "12px", color: "#616161", fontWeight: 600 }}
              >
                Used Codes
              </div>
              <div
                style={{ fontSize: "18px", fontWeight: 700, color: "#374151" }}
              >
                {storeSetting.codesGenerated.toLocaleString()}
              </div>
            </div>
            <div>
              <div
                style={{ fontSize: "12px", color: "#616161", fontWeight: 600 }}
              >
                Remaining Balance
              </div>
              <div
                style={{ fontSize: "18px", fontWeight: 800, color: "#166534" }}
              >
                {remainingCodes.toLocaleString()}
              </div>
            </div>
            <div
              style={{ borderLeft: "1px solid #e5e7eb", paddingLeft: "32px" }}
            >
              <div
                style={{ fontSize: "12px", color: "#616161", fontWeight: 600 }}
              >
                Total Limit
              </div>
              <div
                style={{ fontSize: "18px", fontWeight: 800, color: "#111827" }}
              >
                {storeSetting.codesLimit.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "20px",
            alignItems: "stretch",
            marginBottom: "32px",
          }}
        >
          {packs.map((p) => {
            return (
              <div
                key={p.id}
                style={{
                  background: "#ffffff",
                  border: p.popular ? "2px solid #166534" : "1px solid #e1e3e5",
                  borderRadius: "14px",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  position: "relative",
                  boxShadow: p.popular
                    ? "0 8px 24px rgba(22, 101, 52, 0.12)"
                    : "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                {p.popular && (
                  <div
                    style={{
                      position: "absolute",
                      top: "-12px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "#166534",
                      color: "#ffffff",
                      fontSize: "11px",
                      fontWeight: 800,
                      padding: "4px 12px",
                      borderRadius: "12px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {p.badgeText || "Most Popular"}
                  </div>
                )}

                <div>
                  <h3
                    style={{
                      margin: "0 0 8px 0",
                      fontSize: "18px",
                      fontWeight: 700,
                      color: "#1a1a1a",
                    }}
                  >
                    {p.name}
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "6px",
                      marginBottom: "16px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "36px",
                        fontWeight: 800,
                        color: "#1a1a1a",
                      }}
                    >
                      {p.price}
                    </span>
                    <span style={{ fontSize: "13px", color: "#616161" }}>
                      {p.type}
                    </span>
                  </div>

                  <div
                    style={{
                      background: p.popular ? "#f0fdf4" : "#f9fafb",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      padding: "10px 12px",
                      fontWeight: 700,
                      fontSize: "14px",
                      color: p.popular ? "#166534" : "#1a1a1a",
                      textAlign: "center",
                      marginBottom: "20px",
                    }}
                  >
                    {p.limitLabel}
                  </div>

                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: "0 0 24px 0",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    {p.features.map((f, index) => (
                      <li
                        key={index}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          fontSize: "13px",
                          color: "#4b5563",
                        }}
                      >
                        <CheckCircle2
                          size={16}
                          color="#16a34a"
                          style={{ flexShrink: 0 }}
                        />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>

                {p.isFree ? (
                  <button
                    disabled
                    className="bd-btn-secondary"
                    style={{
                      width: "100%",
                      justifyContent: "center",
                      padding: "12px",
                      fontSize: "14px",
                      opacity: 0.7,
                      cursor: "default",
                      background: "#f3f4f6",
                      borderColor: "#e5e7eb",
                      color: "#4b5563",
                      fontWeight: 600,
                    }}
                  >
                    Included Default
                  </button>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="packKey" value={p.id} />
                    <button
                      type="submit"
                      className={
                        p.popular ? "bd-btn-primary" : "bd-btn-secondary"
                      }
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        padding: "12px",
                        fontSize: "14px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        ...(p.popular ? { background: "#166534" } : {}),
                      }}
                    >
                      <PlusCircle size={16} />
                      Buy {p.name} ({p.price})
                    </button>
                  </Form>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  useEffect(() => {
    if (
      error?.data &&
      typeof error.data === "string" &&
      error.data.includes("<script")
    ) {
      const div = document.createElement("div");
      div.innerHTML = error.data;
      const scripts = div.querySelectorAll("script");
      scripts.forEach((oldScript) => {
        const newScript = document.createElement("script");
        Array.from(oldScript.attributes).forEach((attr) =>
          newScript.setAttribute(attr.name, attr.value),
        );
        newScript.appendChild(document.createTextNode(oldScript.innerHTML));
        document.body.appendChild(newScript);
      });
    }
  }, [error]);

  return boundary.error(error);
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
