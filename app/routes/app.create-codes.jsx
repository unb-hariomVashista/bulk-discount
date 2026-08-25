import { useState } from "react";
import { useFetcher, useLoaderData, useNavigate, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Tag,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  FileText,
  HelpCircle,
  Pencil,
  ShoppingBag,
  Ticket,
  Code2,
  UserCheck,
  Calendar as CalendarIcon,
  Info,
  Rocket,
  Search,
  FolderPlus,
  X,
  Check,
  Truck,
  Gift,
  Banknote,
  Percent,
} from "lucide-react";

import { formatCurrency, getCurrencySymbol } from "../utils/currency";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let products = [];
  let collections = [];
  let currencyCode = "USD";

  try {
    const response = await admin.graphql(`
      #graphql
      query getProductsCollectionsAndCurrency {
        shop {
          currencyCode
        }
        products(first: 25) {
          nodes {
            id
            title
          }
        }
        collections(first: 25) {
          nodes {
            id
            title
          }
        }
      }
    `);
    const data = await response.json();
    currencyCode = data.data?.shop?.currencyCode || "USD";
    products = data.data?.products?.nodes || [];
    collections = data.data?.collections?.nodes || [];
  } catch (err) {
    console.error(
      "Error fetching products/collections/currency:",
      err?.message || err,
    );
  }

  if (products.length === 0) {
    products = [
      { id: "gid://shopify/Product/1", title: "Premium Winter Snowboard" },
      {
        id: "gid://shopify/Product/2",
        title: "Pro Ski Goggles - UV Protection",
      },
      { id: "gid://shopify/Product/3", title: "Thermal Insulated Jacket" },
      { id: "gid://shopify/Product/4", title: "Waterproof Snow Pants" },
      { id: "gid://shopify/Product/5", title: "All-Mountain Snowboard Boots" },
    ];
  }

  if (collections.length === 0) {
    collections = [
      {
        id: "gid://shopify/Collection/1",
        title: "Winter Essentials Collection",
      },
      { id: "gid://shopify/Collection/2", title: "New Arrivals 2024" },
      { id: "gid://shopify/Collection/3", title: "Best Sellers" },
      { id: "gid://shopify/Collection/4", title: "Clearance Sale" },
    ];
  }

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

  return { storeSetting, products, collections, currencyCode };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const title = formData.get("title") || "Summer Sale 2024";
  const sourceType = "GENERATE";
  const codePrefix = formData.get("codePrefix") || "SUMMER-";
  const codeLength = parseInt(formData.get("codeLength") || "12", 10);
  const totalCodes = parseInt(formData.get("totalCodes") || "100", 10);
  const discountType = formData.get("discountType") || "FIXED_AMOUNT";
  const discountValue =
    discountType === "FREE_SHIPPING"
      ? 0.0
      : parseFloat(formData.get("discountValue") || "10.00");
  const appliesOncePerOrder = formData.get("appliesOncePerOrder") === "true";
  const appliesTo =
    discountType === "FREE_SHIPPING"
      ? "ALL_PRODUCTS"
      : formData.get("appliesTo") || "ALL_PRODUCTS";
  const targetIds = formData.get("targetIds") || "";

  // BXGY Fields
  const buysQuantity = parseInt(formData.get("buysQuantity") || "2", 10);
  const buysAppliesTo = formData.get("buysAppliesTo") || "SPECIFIC_PRODUCTS";
  const buysTargetIds = formData.get("buysTargetIds") || "";
  const getsQuantity = parseInt(formData.get("getsQuantity") || "1", 10);
  const getsAppliesTo = formData.get("getsAppliesTo") || "SPECIFIC_PRODUCTS";
  const getsTargetIds = formData.get("getsTargetIds") || "";
  const getsDiscountType = formData.get("getsDiscountType") || "FREE";
  const getsDiscountValue = parseFloat(
    formData.get("getsDiscountValue") || "100.0",
  );
  const hasMaxUsesPerOrder = formData.get("hasMaxUsesPerOrder") === "true";
  const maxUsesPerOrder = hasMaxUsesPerOrder
    ? parseInt(formData.get("maxUsesPerOrder") || "1", 10)
    : null;

  const minRequirementType =
    discountType === "BUY_X_GET_Y"
      ? "NONE"
      : formData.get("minRequirementType") || "NONE";
  const minRequirementValue =
    discountType === "BUY_X_GET_Y" || minRequirementType === "NONE"
      ? null
      : parseFloat(formData.get("minRequirementValue") || "0");
  const startDateStr = formData.get("startDate") || new Date().toISOString();
  const endDateStr = formData.get("endDate") || null;
  const usageLimitPerCode = parseInt(
    formData.get("usageLimitPerCode") || "1",
    10,
  );
  const oncePerCustomer = formData.get("oncePerCustomer") === "true";

  let storeSetting = await db.storeSetting.findUnique({ where: { shop } });
  if (!storeSetting) {
    storeSetting = await db.storeSetting.create({
      data: { shop, plan: "PAY_AS_YOU_GO", codesLimit: 250, codesGenerated: 0 },
    });
  }

  const newTotalGenerated = storeSetting.codesGenerated + totalCodes;
  if (newTotalGenerated > storeSetting.codesLimit) {
    return {
      error: `Code limit exceeded! Your Pay-As-You-Go quota allows up to ${storeSetting.codesLimit.toLocaleString()} codes. Current usage: ${storeSetting.codesGenerated.toLocaleString()}/${storeSetting.codesLimit.toLocaleString()}. Please top up your code credits starting at $1 for 10,000 codes on the Pricing page.`,
    };
  }

  const generatedCodes = [];
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let i = 0; i < totalCodes; i++) {
    let randStr = "";
    for (let c = 0; c < codeLength; c++) {
      randStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const finalCode = `${codePrefix.toUpperCase()}${randStr}`;
    generatedCodes.push(finalCode);
  }

  // Construct base campaign data
  const campaignData = {
    shop,
    title,
    sourceType,
    codePrefix: codePrefix.toUpperCase(),
    codeLength,
    totalCodes,
    usedCodes: 0,
    discountType,
    discountValue,
    appliesTo,
    targetIds,
    minRequirementType,
    minRequirementValue,
    startDate: new Date(startDateStr),
    endDate: endDateStr ? new Date(endDateStr) : null,
    usageLimitPerCode,
    oncePerCustomer,
    appliesOncePerOrder,
    status: "ACTIVE",
    codes: {
      create: generatedCodes.map((code) => ({
        code,
        maxUses: usageLimitPerCode,
        usageCount: 0,
      })),
    },
  };

  // Only include BXGY fields when creating a BUY_X_GET_Y discount
  if (discountType === "BUY_X_GET_Y") {
    campaignData.buysQuantity = buysQuantity;
    campaignData.buysAppliesTo = buysAppliesTo;
    campaignData.buysTargetIds = buysTargetIds;
    campaignData.getsQuantity = getsQuantity;
    campaignData.getsAppliesTo = getsAppliesTo;
    campaignData.getsTargetIds = getsTargetIds;
    campaignData.getsDiscountType = getsDiscountType;
    campaignData.getsDiscountValue = getsDiscountValue;
    if (maxUsesPerOrder) campaignData.maxUsesPerOrder = maxUsesPerOrder;
  }

  let campaign;
  try {
    campaign = await db.campaign.create({ data: campaignData });
  } catch (err) {
    if (err.message?.includes("Unknown argument")) {
      delete campaignData.appliesOncePerOrder;
      delete campaignData.buysQuantity;
      delete campaignData.buysAppliesTo;
      delete campaignData.buysTargetIds;
      delete campaignData.getsQuantity;
      delete campaignData.getsAppliesTo;
      delete campaignData.getsTargetIds;
      delete campaignData.getsDiscountType;
      delete campaignData.getsDiscountValue;
      delete campaignData.maxUsesPerOrder;
      campaign = await db.campaign.create({ data: campaignData });
    } else {
      throw err;
    }
  }

  await db.storeSetting.update({
    where: { shop },
    data: { codesGenerated: newTotalGenerated },
  });

  let shopCurrency = "USD";
  try {
    const curRes = await admin.graphql(`
      #graphql
      query getShopCurrency {
        shop {
          currencyCode
        }
      }
    `);
    const curJson = await curRes.json();
    shopCurrency = curJson.data?.shop?.currencyCode || "USD";
  } catch (e) {}

  const discountLabel =
    discountType === "BUY_X_GET_Y"
      ? `Buy ${buysQuantity} Get ${getsQuantity} ${getsDiscountType === "FREE" ? "FREE" : `${getsDiscountValue}% OFF`}`
      : discountType === "FREE_SHIPPING"
        ? "Free Shipping"
        : discountType === "PERCENTAGE"
          ? `${discountValue}% OFF`
          : `${formatCurrency(discountValue, shopCurrency)} OFF`;

  await db.activityLog.create({
    data: {
      shop,
      action: "CAMPAIGN_CREATED",
      description: `Created campaign "${title}" with ${totalCodes.toLocaleString()} unique autogenerated codes (${discountLabel}).`,
      details: JSON.stringify({
        campaignId: campaign.id,
        prefix: codePrefix,
        totalCodes,
        discountType,
        discountValue,
        buysQuantity,
        getsQuantity,
        maxUsesPerOrder,
      }),
    },
  });

  // Call Shopify GraphQL Discount creation
  try {
    const primaryCode = generatedCodes[0];
    let discountNodeId = null;

    if (discountType === "BUY_X_GET_Y") {
      let buysItemsObj = { all: true };
      if (buysAppliesTo === "SPECIFIC_PRODUCTS" && buysTargetIds) {
        const pIds = buysTargetIds.split(",").filter(Boolean);
        if (pIds.length > 0)
          buysItemsObj = { products: { productsToAdd: pIds } };
      } else if (buysAppliesTo === "SPECIFIC_COLLECTIONS" && buysTargetIds) {
        const cIds = buysTargetIds.split(",").filter(Boolean);
        if (cIds.length > 0)
          buysItemsObj = { collections: { collectionsToAdd: cIds } };
      }

      let getsItemsObj = { all: true };
      if (getsAppliesTo === "SPECIFIC_PRODUCTS" && getsTargetIds) {
        const pIds = getsTargetIds.split(",").filter(Boolean);
        if (pIds.length > 0)
          getsItemsObj = { products: { productsToAdd: pIds } };
      } else if (getsAppliesTo === "SPECIFIC_COLLECTIONS" && getsTargetIds) {
        const cIds = getsTargetIds.split(",").filter(Boolean);
        if (cIds.length > 0)
          getsItemsObj = { collections: { collectionsToAdd: cIds } };
      }

      const response = await admin.graphql(
        `#graphql
        mutation discountCodeBxgyCreate($bxgyCodeDiscount: DiscountCodeBxgyInput!) {
          discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) {
            codeDiscountNode {
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
            bxgyCodeDiscount: {
              title: title,
              code: primaryCode,
              startsAt: new Date(startDateStr).toISOString(),
              ...(endDateStr
                ? { endsAt: new Date(endDateStr).toISOString() }
                : {}),
              customerSelection: {
                all: true,
              },
              appliesOncePerCustomer: oncePerCustomer,
              usageLimit: usageLimitPerCode,
              ...(maxUsesPerOrder
                ? { usesPerOrderLimit: maxUsesPerOrder }
                : {}),
              customerBuys: {
                value: {
                  quantity: buysQuantity,
                },
                items: buysItemsObj,
              },
              customerGets: {
                value: {
                  discountOnQuantity: {
                    quantity: getsQuantity,
                    effect:
                      getsDiscountType === "FREE"
                        ? { percentage: 1.0 }
                        : { percentage: getsDiscountValue / 100 },
                  },
                },
                items: getsItemsObj,
              },
            },
          },
        },
      );
      const resJson = await response.json();
      console.log(
        "BXGY Discount Creation Response:",
        JSON.stringify(resJson, null, 2),
      );
      discountNodeId =
        resJson.data?.discountCodeBxgyCreate?.codeDiscountNode?.id;
    } else if (discountType === "FREE_SHIPPING") {
      let minRequirementObj = undefined;
      if (minRequirementType === "MIN_AMOUNT" && minRequirementValue > 0) {
        minRequirementObj = {
          subtotal: {
            greaterThanOrEqualToSubtotal: parseFloat(minRequirementValue),
          },
        };
      } else if (
        minRequirementType === "MIN_QUANTITY" &&
        minRequirementValue > 0
      ) {
        minRequirementObj = {
          quantity: {
            greaterThanOrEqualToQuantity: parseInt(minRequirementValue, 10),
          },
        };
      }

      const response = await admin.graphql(
        `#graphql
        mutation discountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
          discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
            codeDiscountNode {
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
            freeShippingCodeDiscount: {
              title: title,
              code: primaryCode,
              startsAt: new Date(startDateStr).toISOString(),
              ...(endDateStr
                ? { endsAt: new Date(endDateStr).toISOString() }
                : {}),
              customerSelection: {
                all: true,
              },
              appliesOncePerCustomer: oncePerCustomer,
              usageLimit: usageLimitPerCode,
              destination: {
                all: true,
              },
              ...(minRequirementObj
                ? { minimumRequirement: minRequirementObj }
                : {}),
            },
          },
        },
      );
      const resJson = await response.json();
      console.log(
        "Free Shipping Discount Creation Response:",
        JSON.stringify(resJson, null, 2),
      );
      discountNodeId =
        resJson.data?.discountCodeFreeShippingCreate?.codeDiscountNode?.id;
    } else {
      const discountValueObj =
        discountType === "PERCENTAGE"
          ? { percentage: discountValue / 100 }
          : {
              discountAmount: {
                amount: discountValue,
                appliesOnEachItem: !appliesOncePerOrder,
              },
            };

      let itemsObj = { all: true };
      if (appliesTo === "SPECIFIC_PRODUCTS" && targetIds) {
        const pIds = targetIds.split(",").filter(Boolean);
        if (pIds.length > 0) itemsObj = { products: { productsToAdd: pIds } };
        else itemsObj = { all: true };
      } else if (appliesTo === "SPECIFIC_COLLECTIONS" && targetIds) {
        const cIds = targetIds.split(",").filter(Boolean);
        if (cIds.length > 0)
          itemsObj = { collections: { collectionsToAdd: cIds } };
        else itemsObj = { all: true };
      }

      let minRequirementObj = undefined;
      if (minRequirementType === "MIN_AMOUNT" && minRequirementValue > 0) {
        minRequirementObj = {
          subtotal: {
            greaterThanOrEqualToSubtotal: parseFloat(minRequirementValue),
          },
        };
      } else if (
        minRequirementType === "MIN_QUANTITY" &&
        minRequirementValue > 0
      ) {
        minRequirementObj = {
          quantity: {
            greaterThanOrEqualToQuantity: parseInt(minRequirementValue, 10),
          },
        };
      }

      const response = await admin.graphql(
        `#graphql
        mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode {
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
            basicCodeDiscount: {
              title: title,
              code: primaryCode,
              startsAt: new Date(startDateStr).toISOString(),
              ...(endDateStr
                ? { endsAt: new Date(endDateStr).toISOString() }
                : {}),
              customerGets: {
                value: discountValueObj,
                items: itemsObj,
              },
              customerSelection: {
                all: true,
              },
              appliesOncePerCustomer: oncePerCustomer,
              usageLimit: usageLimitPerCode,
              ...(minRequirementObj
                ? { minimumRequirement: minRequirementObj }
                : {}),
            },
          },
        },
      );
      const resJson = await response.json();
      console.log(
        "Basic Discount Creation Response:",
        JSON.stringify(resJson, null, 2),
      );
      discountNodeId =
        resJson.data?.discountCodeBasicCreate?.codeDiscountNode?.id;
    }

    // Attach remaining bulk codes to the created discount node in Shopify
    if (discountNodeId && generatedCodes.length > 1) {
      const remainingCodes = generatedCodes.slice(1).map((c) => ({ code: c }));
      for (let i = 0; i < remainingCodes.length; i += 200) {
        const batch = remainingCodes.slice(i, i + 200);
        try {
          const bulkAddResponse = await admin.graphql(
            `#graphql
            mutation discountRedeemCodeBulkAdd($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
              discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
                bulkCreation {
                  id
                  done
                  codesCount
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                discountId: discountNodeId,
                codes: batch,
              },
            },
          );
          const bulkAddJson = await bulkAddResponse.json();
          console.log(
            "Bulk Redeem Codes Add Result:",
            JSON.stringify(bulkAddJson, null, 2),
          );
        } catch (bErr) {
          console.error(
            "Bulk redeem code creation log:",
            bErr?.message || bErr,
          );
        }
      }
    }

    if (discountNodeId && campaign?.id) {
      try {
        await db.campaign.update({
          where: { id: campaign.id },
          data: { shopifyDiscountId: discountNodeId },
        });
      } catch (uErr) {
        console.error(
          "Failed to save shopifyDiscountId:",
          uErr?.message || uErr,
        );
      }
    }
  } catch (err) {
    console.error(
      "Shopify GraphQL Discount creation log:",
      err?.message || err,
    );
  }

  return redirect("/app/campaigns");
};

export default function CreateCodes() {
  const { storeSetting, products, collections, currencyCode } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  // Form State
  const [title, setTitle] = useState("Summer Sale 2024");
  const [codePrefix, setCodePrefix] = useState("SUMMER-");
  const [codeLength, setCodeLength] = useState(12);
  const [totalCodes, setTotalCodes] = useState(100);
  const [discountType, setDiscountType] = useState("FIXED_AMOUNT"); // FIXED_AMOUNT, PERCENTAGE, FREE_SHIPPING, BUY_X_GET_Y
  const [discountValue, setDiscountValue] = useState(10.0);
  const [appliesOncePerOrder, setAppliesOncePerOrder] = useState(true);
  const [appliesTo, setAppliesTo] = useState("ALL_PRODUCTS");

  // BXGY Specific Form State
  const [buysQuantity, setBuysQuantity] = useState(2);
  const [buysAppliesTo, setBuysAppliesTo] = useState("SPECIFIC_PRODUCTS");
  const [buysProducts, setBuysProducts] = useState([products[0]]);
  const [buysCollections, setBuysCollections] = useState([collections[0]]);

  const [getsQuantity, setGetsQuantity] = useState(1);
  const [getsAppliesTo, setGetsAppliesTo] = useState("SPECIFIC_PRODUCTS");
  const [getsProducts, setGetsProducts] = useState([
    products[1] || products[0],
  ]);
  const [getsCollections, setGetsCollections] = useState([collections[0]]);
  const [getsDiscountType, setGetsDiscountType] = useState("FREE"); // FREE or PERCENTAGE
  const [getsDiscountValue, setGetsDiscountValue] = useState(100.0); // 100 for FREE, or percentage

  const [hasMaxUsesPerOrder, setHasMaxUsesPerOrder] = useState(false);
  const [maxUsesPerOrder, setMaxUsesPerOrder] = useState(1);

  // Selection Modal State
  const [selectedProducts, setSelectedProducts] = useState([products[0]]);
  const [selectedCollections, setSelectedCollections] = useState([
    collections[0],
  ]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTargetKey, setModalTargetKey] = useState("product");
  const [modalSearch, setModalSearch] = useState("");
  const [tempCheckedIds, setTempCheckedIds] = useState([]);

  // Requirements & Dates
  const [minRequirementType, setMinRequirementType] = useState("NONE");
  const [minRequirementValue, setMinRequirementValue] = useState(50.0);
  const [usageLimitPerCode, setUsageLimitPerCode] = useState(1);
  const [oncePerCustomer, setOncePerCustomer] = useState(true);
  const [startDate, setStartDate] = useState("2026-08-24");
  const [endDate, setEndDate] = useState("");

  const isSubmitting = fetcher.state === "submitting";
  const remainingQuota = storeSetting.codesLimit - storeSetting.codesGenerated;

  // Code preview
  const sampleRandom = "A7B9XK2L1P8Q".slice(0, codeLength);
  const codePreviewString = `${codePrefix.toUpperCase()}${sampleRandom}`;

  const openModalForTarget = async (targetKey) => {
    setModalTargetKey(targetKey);
    setModalSearch("");
    const isProduct = targetKey.includes("product");
    const itemType = isProduct ? "product" : "collection";

    try {
      if (shopify && shopify.resourcePicker) {
        const selection = await shopify.resourcePicker({
          type: itemType,
          multiple: true,
        });
        if (selection) {
          const formatted = selection.map((item) => ({
            id: item.id,
            title: item.title,
          }));
          if (targetKey === "buys_product") setBuysProducts(formatted);
          else if (targetKey === "buys_collection")
            setBuysCollections(formatted);
          else if (targetKey === "gets_product") setGetsProducts(formatted);
          else if (targetKey === "gets_collection")
            setGetsCollections(formatted);
          else if (targetKey === "product") setSelectedProducts(formatted);
          else if (targetKey === "collection")
            setSelectedCollections(formatted);
          return;
        }
      }
    } catch (e) {
      // Fallback modal
    }

    let currentIds = [];
    if (targetKey === "buys_product")
      currentIds = buysProducts.map((p) => p.id);
    else if (targetKey === "buys_collection")
      currentIds = buysCollections.map((c) => c.id);
    else if (targetKey === "gets_product")
      currentIds = getsProducts.map((p) => p.id);
    else if (targetKey === "gets_collection")
      currentIds = getsCollections.map((c) => c.id);
    else if (targetKey === "product")
      currentIds = selectedProducts.map((p) => p.id);
    else if (targetKey === "collection")
      currentIds = selectedCollections.map((c) => c.id);

    setTempCheckedIds(currentIds);
    setIsModalOpen(true);
  };

  const handleConfirmModal = () => {
    const isProduct = modalTargetKey.includes("product");
    const fullList = isProduct ? products : collections;
    const updated = fullList.filter((item) => tempCheckedIds.includes(item.id));

    if (modalTargetKey === "buys_product") setBuysProducts(updated);
    else if (modalTargetKey === "buys_collection") setBuysCollections(updated);
    else if (modalTargetKey === "gets_product") setGetsProducts(updated);
    else if (modalTargetKey === "gets_collection") setGetsCollections(updated);
    else if (modalTargetKey === "product") setSelectedProducts(updated);
    else if (modalTargetKey === "collection") setSelectedCollections(updated);

    setIsModalOpen(false);
  };

  const removeChipItem = (targetKey, id) => {
    if (targetKey === "buys_product")
      setBuysProducts(buysProducts.filter((p) => p.id !== id));
    else if (targetKey === "buys_collection")
      setBuysCollections(buysCollections.filter((c) => c.id !== id));
    else if (targetKey === "gets_product")
      setGetsProducts(getsProducts.filter((p) => p.id !== id));
    else if (targetKey === "gets_collection")
      setGetsCollections(getsCollections.filter((c) => c.id !== id));
    else if (targetKey === "product")
      setSelectedProducts(selectedProducts.filter((p) => p.id !== id));
    else if (targetKey === "collection")
      setSelectedCollections(selectedCollections.filter((c) => c.id !== id));
  };

  const getAppliesToText = () => {
    if (discountType === "BUY_X_GET_Y") {
      const buysInfo =
        buysAppliesTo === "SPECIFIC_PRODUCTS"
          ? `${buysProducts.length} product(s)`
          : `${buysCollections.length} collection(s)`;
      const getsInfo =
        getsAppliesTo === "SPECIFIC_PRODUCTS"
          ? `${getsProducts.length} product(s)`
          : `${getsCollections.length} collection(s)`;
      return `Buys ${buysQuantity} (${buysInfo}) ➔ Gets ${getsQuantity} (${getsInfo})`;
    }
    if (discountType === "FREE_SHIPPING") return "All shipping rates";
    if (appliesTo === "ALL_PRODUCTS") return "Entire order (All products)";
    if (appliesTo === "SPECIFIC_PRODUCTS")
      return `${selectedProducts.length} product(s) selected`;
    if (appliesTo === "SPECIFIC_COLLECTIONS")
      return `${selectedCollections.length} collection(s) selected`;
    return "Entire order";
  };

  const targetIdsString =
    appliesTo === "SPECIFIC_PRODUCTS"
      ? selectedProducts.map((p) => p.id).join(",")
      : appliesTo === "SPECIFIC_COLLECTIONS"
        ? selectedCollections.map((c) => c.id).join(",")
        : "";

  const buysTargetIdsString =
    buysAppliesTo === "SPECIFIC_PRODUCTS"
      ? buysProducts.map((p) => p.id).join(",")
      : buysCollections.map((c) => c.id).join(",");

  const getsTargetIdsString =
    getsAppliesTo === "SPECIFIC_PRODUCTS"
      ? getsProducts.map((p) => p.id).join(",")
      : getsCollections.map((c) => c.id).join(",");

  return (
    <div className="bd-dashboard">
      <div className="bd-max-width">
        {/* Top Header Row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              type="button"
              onClick={() => navigate("/app")}
              className="bd-action-icon-btn"
              style={{
                background: "#ffffff",
                border: "1px solid #e1e3e5",
                padding: "8px",
                borderRadius: "8px",
              }}
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: "22px",
                  fontWeight: 700,
                  color: "#1a1a1a",
                }}
              >
                Create Bulk Discount Campaign
              </h1>
              <p
                style={{
                  margin: "2px 0 0 0",
                  color: "#616161",
                  fontSize: "13px",
                }}
              >
                Configure your campaign settings, prefix rules, and discount
                logic.
              </p>
            </div>
          </div>
        </div>

        {/* Current Plan Banner */}
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
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                background: "#e6f4ea",
                color: "#137333",
                padding: "10px",
                borderRadius: "8px",
              }}
            >
              <Tag size={20} />
            </div>
            <div>
              <div
                style={{ fontWeight: 600, fontSize: "14px", color: "#1a1a1a" }}
              >
                Current Plan:{" "}
                <span style={{ color: "#166534", fontWeight: 800 }}>
                  {storeSetting.plan}
                </span>
              </div>
              <div
                style={{ fontSize: "12px", color: "#616161", marginTop: "2px" }}
              >
                Used {storeSetting.codesGenerated.toLocaleString()} of{" "}
                {storeSetting.codesLimit.toLocaleString()} discount codes (
                {remainingQuota.toLocaleString()} remaining)
              </div>
            </div>
          </div>
          <button
            type="button"
            className="bd-btn-secondary"
            onClick={() => navigate("/app/pricing")}
            style={{ fontSize: "13px", padding: "6px 14px" }}
          >
            Upgrade Plan
          </button>
        </div>

        {/* Error / Success Alerts */}
        {fetcher.data?.error && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              color: "#991b1b",
              borderRadius: "10px",
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "14px",
            }}
          >
            <AlertCircle size={20} />
            <span>{fetcher.data.error}</span>
          </div>
        )}

        {fetcher.data?.success && (
          <div
            style={{
              background: "#f0fdf4",
              border: "1px solid #86efac",
              color: "#166534",
              borderRadius: "10px",
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "14px",
            }}
          >
            <CheckCircle2 size={20} />
            <span>
              Successfully created campaign with {fetcher.data.totalCodes}{" "}
              unique discount codes!
            </span>
          </div>
        )}

        {/* Form Container */}
        <fetcher.Form method="POST">
          <input type="hidden" name="discountType" value={discountType} />
          <input type="hidden" name="targetIds" value={targetIdsString} />
          <input type="hidden" name="buysAppliesTo" value={buysAppliesTo} />
          <input
            type="hidden"
            name="buysTargetIds"
            value={buysTargetIdsString}
          />
          <input type="hidden" name="getsAppliesTo" value={getsAppliesTo} />
          <input
            type="hidden"
            name="getsTargetIds"
            value={getsTargetIdsString}
          />
          <input
            type="hidden"
            name="getsDiscountType"
            value={getsDiscountType}
          />
          <input
            type="hidden"
            name="getsDiscountValue"
            value={
              getsDiscountType === "FREE"
                ? "100.0"
                : getsDiscountValue.toString()
            }
          />

          <div className="bd-create-layout">
            {/* Left Column */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "20px" }}
            >
              {/* Section 1 */}
              <div className="bd-table-card">
                <div className="bd-section-header">
                  <div className="bd-step-badge">1</div>
                  <h2>Campaign & Code Generation</h2>
                </div>
                <div className="bd-section-subtitle">
                  Set campaign details and how codes will be autogenerated.
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "18px",
                  }}
                >
                  <div>
                    <label className="bd-input-label">Campaign Name *</label>
                    <input
                      type="text"
                      name="title"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Summer Sale 2024"
                      className="bd-input-text"
                    />
                    <div className="bd-input-subtext">
                      Internal name for your campaign (only you will see this).
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "16px",
                      marginTop: "4px",
                    }}
                  >
                    <div>
                      <label className="bd-input-label">
                        Prefix (e.g. SUMMER-) *
                      </label>
                      <input
                        type="text"
                        name="codePrefix"
                        value={codePrefix}
                        onChange={(e) => setCodePrefix(e.target.value)}
                        placeholder="SUMMER-"
                        className="bd-input-text"
                      />
                      <div className="bd-input-subtext">
                        Add a prefix to code
                      </div>
                    </div>

                    <div>
                      <label className="bd-input-label">
                        Number of Codes to Create *
                      </label>
                      <input
                        type="number"
                        name="totalCodes"
                        required
                        min={1}
                        max={remainingQuota}
                        value={totalCodes}
                        onChange={(e) =>
                          setTotalCodes(parseInt(e.target.value || "1", 10))
                        }
                        className="bd-input-text"
                      />
                      <div className="bd-input-subtext">
                        Maximum allowed: {remainingQuota.toLocaleString()}
                      </div>
                    </div>

                    <div>
                      <label className="bd-input-label">
                        Random Code Length (6 - 12 chars) *
                      </label>
                      <input
                        type="number"
                        name="codeLength"
                        required
                        min={6}
                        max={12}
                        value={codeLength}
                        onChange={(e) =>
                          setCodeLength(
                            Math.max(
                              6,
                              Math.min(12, parseInt(e.target.value || "6", 10)),
                            ),
                          )
                        }
                        className="bd-input-text"
                      />
                      <div className="bd-input-subtext">
                        Preview:{" "}
                        <strong style={{ color: "#166534" }}>
                          {codePreviewString}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Discount Configuration */}
              <div className="bd-table-card">
                <div className="bd-section-header">
                  <div className="bd-step-badge">2</div>
                  <h2>Discount Configuration</h2>
                </div>
                <div className="bd-section-subtitle">
                  Choose the discount type and configuration.
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "18px",
                  }}
                >
                  <div>
                    <label className="bd-input-label">Discount Type</label>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, 1fr)",
                        gap: "12px",
                        marginTop: "6px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setDiscountType("FIXED_AMOUNT");
                          setDiscountValue(10.0);
                        }}
                        style={{
                          padding: "12px",
                          borderRadius: "8px",
                          border:
                            discountType === "FIXED_AMOUNT"
                              ? "2px solid #166534"
                              : "1px solid #c9cccf",
                          background:
                            discountType === "FIXED_AMOUNT"
                              ? "#f4fbf7"
                              : "#ffffff",
                          color:
                            discountType === "FIXED_AMOUNT"
                              ? "#166534"
                              : "#1a1a1a",
                          fontWeight: 700,
                          fontSize: "13px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                        }}
                      >
                        <Banknote size={16} /> Fixed Amount
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDiscountType("PERCENTAGE");
                          setDiscountValue(20.0);
                        }}
                        style={{
                          padding: "12px",
                          borderRadius: "8px",
                          border:
                            discountType === "PERCENTAGE"
                              ? "2px solid #166534"
                              : "1px solid #c9cccf",
                          background:
                            discountType === "PERCENTAGE"
                              ? "#f4fbf7"
                              : "#ffffff",
                          color:
                            discountType === "PERCENTAGE"
                              ? "#166534"
                              : "#1a1a1a",
                          fontWeight: 700,
                          fontSize: "13px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                        }}
                      >
                        <Percent size={16} /> Percentage
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDiscountType("FREE_SHIPPING");
                          setDiscountValue(0.0);
                        }}
                        style={{
                          padding: "12px",
                          borderRadius: "8px",
                          border:
                            discountType === "FREE_SHIPPING"
                              ? "2px solid #166534"
                              : "1px solid #c9cccf",
                          background:
                            discountType === "FREE_SHIPPING"
                              ? "#f4fbf7"
                              : "#ffffff",
                          color:
                            discountType === "FREE_SHIPPING"
                              ? "#166534"
                              : "#1a1a1a",
                          fontWeight: 700,
                          fontSize: "13px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                        }}
                      >
                        <Truck size={16} /> Free Shipping
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDiscountType("BUY_X_GET_Y");
                        }}
                        style={{
                          padding: "12px",
                          borderRadius: "8px",
                          border:
                            discountType === "BUY_X_GET_Y"
                              ? "2px solid #166534"
                              : "1px solid #c9cccf",
                          background:
                            discountType === "BUY_X_GET_Y"
                              ? "#f4fbf7"
                              : "#ffffff",
                          color:
                            discountType === "BUY_X_GET_Y"
                              ? "#166534"
                              : "#1a1a1a",
                          fontWeight: 700,
                          fontSize: "13px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                        }}
                      >
                        <Gift size={16} /> Buy X Get Y
                      </button>
                    </div>
                  </div>

                  {/* BUY X GET Y FORM UI */}
                  {discountType === "BUY_X_GET_Y" && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "20px",
                      }}
                    >
                      {/* Customer Buys (X) Card */}
                      <div
                        style={{
                          background: "#f9fafb",
                          border: "1px solid #e1e3e5",
                          borderRadius: "10px",
                          padding: "18px",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "14px",
                            color: "#166534",
                            marginBottom: "12px",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <ShoppingBag size={18} />
                          Customer Buys (X)
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "140px 1fr",
                            gap: "16px",
                          }}
                        >
                          <div>
                            <label className="bd-input-label">Quantity *</label>
                            <input
                              type="number"
                              name="buysQuantity"
                              required
                              min={1}
                              value={buysQuantity}
                              onChange={(e) =>
                                setBuysQuantity(
                                  parseInt(e.target.value || "1", 10),
                                )
                              }
                              className="bd-input-text"
                            />
                          </div>

                          <div>
                            <label className="bd-input-label">
                              Item Selection
                            </label>
                            <select
                              value={buysAppliesTo}
                              onChange={(e) => setBuysAppliesTo(e.target.value)}
                              className="bd-input-text"
                            >
                              <option value="SPECIFIC_PRODUCTS">
                                Specific Products
                              </option>
                              <option value="SPECIFIC_COLLECTIONS">
                                Specific Collections
                              </option>
                            </select>
                          </div>
                        </div>

                        {/* Buys Selector & Chips */}
                        <div style={{ marginTop: "14px" }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: "8px",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#1a1a1a",
                              }}
                            >
                              {buysAppliesTo === "SPECIFIC_PRODUCTS"
                                ? `Selected Products (${buysProducts.length})`
                                : `Selected Collections (${buysCollections.length})`}
                            </span>
                            <button
                              type="button"
                              className="bd-btn-secondary"
                              style={{ fontSize: "13px", padding: "6px 12px" }}
                              onClick={() =>
                                openModalForTarget(
                                  buysAppliesTo === "SPECIFIC_PRODUCTS"
                                    ? "buys_product"
                                    : "buys_collection",
                                )
                              }
                            >
                              {buysAppliesTo === "SPECIFIC_PRODUCTS" ? (
                                <Search size={14} />
                              ) : (
                                <FolderPlus size={14} />
                              )}
                              {buysAppliesTo === "SPECIFIC_PRODUCTS"
                                ? "Select Products"
                                : "Select Collections"}
                            </button>
                          </div>

                          <div className="bd-target-chips">
                            {buysAppliesTo === "SPECIFIC_PRODUCTS" ? (
                              buysProducts.length === 0 ? (
                                <div
                                  style={{ fontSize: "13px", color: "#616161" }}
                                >
                                  No products selected for X.
                                </div>
                              ) : (
                                buysProducts.map((p) => (
                                  <span className="bd-chip" key={p.id}>
                                    <ShoppingBag size={12} color="#166534" />
                                    {p.title}
                                    <button
                                      type="button"
                                      className="bd-chip-remove"
                                      onClick={() =>
                                        removeChipItem("buys_product", p.id)
                                      }
                                    >
                                      <X size={14} />
                                    </button>
                                  </span>
                                ))
                              )
                            ) : buysCollections.length === 0 ? (
                              <div
                                style={{ fontSize: "13px", color: "#616161" }}
                              >
                                No collections selected for X.
                              </div>
                            ) : (
                              buysCollections.map((c) => (
                                <span className="bd-chip" key={c.id}>
                                  <FolderPlus size={12} color="#1a73e8" />
                                  {c.title}
                                  <button
                                    type="button"
                                    className="bd-chip-remove"
                                    onClick={() =>
                                      removeChipItem("buys_collection", c.id)
                                    }
                                  >
                                    <X size={14} />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Customer Gets (Y) Card */}
                      <div
                        style={{
                          background: "#f9fafb",
                          border: "1px solid #e1e3e5",
                          borderRadius: "10px",
                          padding: "18px",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "14px",
                            color: "#1a73e8",
                            marginBottom: "12px",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <Gift size={18} />
                          Customer Gets (Y)
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "140px 1fr",
                            gap: "16px",
                          }}
                        >
                          <div>
                            <label className="bd-input-label">Quantity *</label>
                            <input
                              type="number"
                              name="getsQuantity"
                              required
                              min={1}
                              value={getsQuantity}
                              onChange={(e) =>
                                setGetsQuantity(
                                  parseInt(e.target.value || "1", 10),
                                )
                              }
                              className="bd-input-text"
                            />
                          </div>

                          <div>
                            <label className="bd-input-label">
                              Item Selection
                            </label>
                            <select
                              value={getsAppliesTo}
                              onChange={(e) => setGetsAppliesTo(e.target.value)}
                              className="bd-input-text"
                            >
                              <option value="SPECIFIC_PRODUCTS">
                                Specific Products
                              </option>
                              <option value="SPECIFIC_COLLECTIONS">
                                Specific Collections
                              </option>
                            </select>
                          </div>
                        </div>

                        {/* Gets Selector & Chips */}
                        <div style={{ marginTop: "14px" }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: "8px",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#1a1a1a",
                              }}
                            >
                              {getsAppliesTo === "SPECIFIC_PRODUCTS"
                                ? `Selected Products (${getsProducts.length})`
                                : `Selected Collections (${getsCollections.length})`}
                            </span>
                            <button
                              type="button"
                              className="bd-btn-secondary"
                              style={{ fontSize: "13px", padding: "6px 12px" }}
                              onClick={() =>
                                openModalForTarget(
                                  getsAppliesTo === "SPECIFIC_PRODUCTS"
                                    ? "gets_product"
                                    : "gets_collection",
                                )
                              }
                            >
                              {getsAppliesTo === "SPECIFIC_PRODUCTS" ? (
                                <Search size={14} />
                              ) : (
                                <FolderPlus size={14} />
                              )}
                              {getsAppliesTo === "SPECIFIC_PRODUCTS"
                                ? "Select Products"
                                : "Select Collections"}
                            </button>
                          </div>

                          <div className="bd-target-chips">
                            {getsAppliesTo === "SPECIFIC_PRODUCTS" ? (
                              getsProducts.length === 0 ? (
                                <div
                                  style={{ fontSize: "13px", color: "#616161" }}
                                >
                                  No products selected for Y.
                                </div>
                              ) : (
                                getsProducts.map((p) => (
                                  <span className="bd-chip" key={p.id}>
                                    <ShoppingBag size={12} color="#1a73e8" />
                                    {p.title}
                                    <button
                                      type="button"
                                      className="bd-chip-remove"
                                      onClick={() =>
                                        removeChipItem("gets_product", p.id)
                                      }
                                    >
                                      <X size={14} />
                                    </button>
                                  </span>
                                ))
                              )
                            ) : getsCollections.length === 0 ? (
                              <div
                                style={{ fontSize: "13px", color: "#616161" }}
                              >
                                No collections selected for Y.
                              </div>
                            ) : (
                              getsCollections.map((c) => (
                                <span className="bd-chip" key={c.id}>
                                  <FolderPlus size={12} color="#1a73e8" />
                                  {c.title}
                                  <button
                                    type="button"
                                    className="bd-chip-remove"
                                    onClick={() =>
                                      removeChipItem("gets_collection", c.id)
                                    }
                                  >
                                    <X size={14} />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        {/* At a Discounted Value Toggle */}
                        <div
                          style={{
                            marginTop: "16px",
                            paddingTop: "14px",
                            borderTop: "1px solid #e1e3e5",
                          }}
                        >
                          <label className="bd-input-label">
                            At a Discounted Value
                          </label>
                          <div
                            style={{
                              display: "flex",
                              gap: "20px",
                              alignItems: "center",
                              marginTop: "8px",
                            }}
                          >
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                cursor: "pointer",
                                fontSize: "14px",
                                fontWeight: 600,
                              }}
                            >
                              <input
                                type="radio"
                                name="getsDiscountTypeRadio"
                                value="FREE"
                                checked={getsDiscountType === "FREE"}
                                onChange={() => {
                                  setGetsDiscountType("FREE");
                                  setGetsDiscountValue(100.0);
                                }}
                              />
                              Free (100% OFF)
                            </label>

                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                cursor: "pointer",
                                fontSize: "14px",
                                fontWeight: 600,
                              }}
                            >
                              <input
                                type="radio"
                                name="getsDiscountTypeRadio"
                                value="PERCENTAGE"
                                checked={getsDiscountType === "PERCENTAGE"}
                                onChange={() => {
                                  setGetsDiscountType("PERCENTAGE");
                                  setGetsDiscountValue(50.0);
                                }}
                              />
                              Percentage Discount (%)
                            </label>
                          </div>

                          {getsDiscountType === "PERCENTAGE" && (
                            <div
                              style={{ maxWidth: "240px", marginTop: "12px" }}
                            >
                              <label className="bd-input-label">
                                Discount Percentage (%) *
                              </label>
                              <div
                                style={{
                                  position: "relative",
                                  display: "flex",
                                  alignItems: "center",
                                }}
                              >
                                <span
                                  style={{
                                    position: "absolute",
                                    left: "14px",
                                    color: "#616161",
                                    fontWeight: 600,
                                    fontSize: "14px",
                                    pointerEvents: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    height: "100%",
                                  }}
                                >
                                  %
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  max={100}
                                  value={getsDiscountValue}
                                  onChange={(e) =>
                                    setGetsDiscountValue(
                                      parseFloat(e.target.value || "1"),
                                    )
                                  }
                                  style={{ paddingLeft: "34px" }}
                                  className="bd-input-text"
                                />
                              </div>
                              <div className="bd-input-subtext">
                                Percentage off for item Y (e.g. 50%).
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Max Uses Per Order Option */}
                      <div
                        style={{
                          background: "#ffffff",
                          border: "1px solid #e1e3e5",
                          borderRadius: "10px",
                          padding: "16px",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: 700,
                            color: "#1a1a1a",
                          }}
                        >
                          <input
                            type="checkbox"
                            name="hasMaxUsesPerOrder"
                            value="true"
                            checked={hasMaxUsesPerOrder}
                            onChange={(e) =>
                              setHasMaxUsesPerOrder(e.target.checked)
                            }
                            style={{
                              width: "18px",
                              height: "18px",
                              accentColor: "#166534",
                            }}
                          />
                          Set maximum number of uses per order
                        </label>
                        <div
                          className="bd-input-subtext"
                          style={{ marginLeft: "28px", marginTop: "4px" }}
                        >
                          Buy X Get Y discounts can be applied multiple times
                          per order. Check this box to cap the maximum number of
                          times it can trigger in a single order.
                        </div>

                        {hasMaxUsesPerOrder && (
                          <div
                            style={{
                              maxWidth: "240px",
                              marginLeft: "28px",
                              marginTop: "12px",
                            }}
                          >
                            <label className="bd-input-label">
                              Max Uses Per Order *
                            </label>
                            <input
                              type="number"
                              name="maxUsesPerOrder"
                              required
                              min={1}
                              value={maxUsesPerOrder}
                              onChange={(e) =>
                                setMaxUsesPerOrder(
                                  parseInt(e.target.value || "1", 10),
                                )
                              }
                              className="bd-input-text"
                            />
                            <div className="bd-input-subtext">
                              Maximum times this offer can apply in one order.
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Free Shipping Info Banner */}
                  {discountType === "FREE_SHIPPING" && (
                    <div
                      style={{
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        borderRadius: "8px",
                        padding: "16px",
                        color: "#166534",
                        fontSize: "14px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <Truck size={22} style={{ flexShrink: 0 }} />
                      <span>
                        Free shipping discount will automatically apply to all
                        eligible checkout shipping rates. No product selection
                        or discount amount required.
                      </span>
                    </div>
                  )}

                  {/* Fixed Amount / Percentage Inputs */}
                  {(discountType === "FIXED_AMOUNT" ||
                    discountType === "PERCENTAGE") && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "16px",
                        }}
                      >
                        <div>
                          <label className="bd-input-label">
                            {discountType === "PERCENTAGE"
                              ? "Discount Percentage (%) *"
                              : `Discount Value (${currencyCode} Amount) *`}
                          </label>
                          <div
                            style={{
                              position: "relative",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                left: "14px",
                                color: "#616161",
                                fontWeight: 600,
                                fontSize: "14px",
                                pointerEvents: "none",
                                display: "flex",
                                alignItems: "center",
                                height: "100%",
                              }}
                            >
                              {discountType === "PERCENTAGE"
                                ? "%"
                                : getCurrencySymbol(currencyCode)}
                            </span>
                            <input
                              type="number"
                              name="discountValue"
                              required
                              min={1}
                              max={
                                discountType === "PERCENTAGE" ? 100 : undefined
                              }
                              step={discountType === "PERCENTAGE" ? 1 : 0.01}
                              value={discountValue}
                              onChange={(e) =>
                                setDiscountValue(
                                  parseFloat(e.target.value || "0"),
                                )
                              }
                              style={{ paddingLeft: "34px" }}
                              className="bd-input-text"
                            />
                          </div>

                          {discountType === "FIXED_AMOUNT" && (
                            <div style={{ marginTop: "10px" }}>
                              <label
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  cursor: "pointer",
                                  fontSize: "13px",
                                  fontWeight: 600,
                                  color: "#1a1a1a",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  name="appliesOncePerOrder"
                                  value="true"
                                  checked={appliesOncePerOrder}
                                  onChange={(e) =>
                                    setAppliesOncePerOrder(e.target.checked)
                                  }
                                  style={{
                                    width: "16px",
                                    height: "16px",
                                    accentColor: "#166534",
                                  }}
                                />
                                Only apply discount once per order
                              </label>
                              <div
                                className="bd-input-subtext"
                                style={{ marginLeft: "24px", marginTop: "2px" }}
                              >
                                {appliesOncePerOrder
                                  ? "Discount amount is applied once to the total order."
                                  : "If unchecked, discount amount will be taken off each eligible item."}
                              </div>
                            </div>
                          )}

                          {discountType === "PERCENTAGE" && (
                            <div className="bd-input-subtext">
                              Enter the discount percentage (1-100%).
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="bd-input-label">Applies To</label>
                          <select
                            name="appliesTo"
                            value={appliesTo}
                            onChange={(e) => setAppliesTo(e.target.value)}
                            className="bd-input-text"
                          >
                            <option value="ALL_PRODUCTS">
                              Entire order (All products)
                            </option>
                            <option value="SPECIFIC_PRODUCTS">
                              Selected products
                            </option>
                            <option value="SPECIFIC_COLLECTIONS">
                              Selected collections
                            </option>
                          </select>
                          <div className="bd-input-subtext">
                            Choose where this discount will apply.
                          </div>
                        </div>
                      </div>

                      {appliesTo === "SPECIFIC_PRODUCTS" && (
                        <div
                          style={{
                            background: "#f9fafb",
                            border: "1px solid #e1e3e5",
                            borderRadius: "8px",
                            padding: "16px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: "8px",
                            }}
                          >
                            <label
                              className="bd-input-label"
                              style={{ margin: 0 }}
                            >
                              Selected Products ({selectedProducts.length})
                            </label>
                            <button
                              type="button"
                              className="bd-btn-secondary"
                              style={{ fontSize: "13px", padding: "6px 12px" }}
                              onClick={() => openModalForTarget("product")}
                            >
                              <Search size={14} /> Select Products
                            </button>
                          </div>

                          <div className="bd-target-chips">
                            {selectedProducts.length === 0 ? (
                              <div
                                style={{ fontSize: "13px", color: "#616161" }}
                              >
                                No products selected yet. Click "Select
                                Products" to choose items.
                              </div>
                            ) : (
                              selectedProducts.map((p) => (
                                <span className="bd-chip" key={p.id}>
                                  <ShoppingBag size={12} color="#166534" />
                                  {p.title}
                                  <button
                                    type="button"
                                    className="bd-chip-remove"
                                    onClick={() =>
                                      removeChipItem("product", p.id)
                                    }
                                  >
                                    <X size={14} />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      {appliesTo === "SPECIFIC_COLLECTIONS" && (
                        <div
                          style={{
                            background: "#f9fafb",
                            border: "1px solid #e1e3e5",
                            borderRadius: "8px",
                            padding: "16px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: "8px",
                            }}
                          >
                            <label
                              className="bd-input-label"
                              style={{ margin: 0 }}
                            >
                              Selected Collections ({selectedCollections.length}
                              )
                            </label>
                            <button
                              type="button"
                              className="bd-btn-secondary"
                              style={{ fontSize: "13px", padding: "6px 12px" }}
                              onClick={() => openModalForTarget("collection")}
                            >
                              <FolderPlus size={14} /> Select Collections
                            </button>
                          </div>

                          <div className="bd-target-chips">
                            {selectedCollections.length === 0 ? (
                              <div
                                style={{ fontSize: "13px", color: "#616161" }}
                              >
                                No collections selected yet. Click "Select
                                Collections" to choose.
                              </div>
                            ) : (
                              selectedCollections.map((c) => (
                                <span className="bd-chip" key={c.id}>
                                  <FolderPlus size={12} color="#1a73e8" />
                                  {c.title}
                                  <button
                                    type="button"
                                    className="bd-chip-remove"
                                    onClick={() =>
                                      removeChipItem("collection", c.id)
                                    }
                                  >
                                    <X size={14} />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Section 3: Requirements & Usage Limits (ONLY shown when NOT Buy X Get Y) */}
              {discountType !== "BUY_X_GET_Y" && (
                <div className="bd-table-card">
                  <div className="bd-section-header">
                    <div className="bd-step-badge">3</div>
                    <h2>Requirements & Usage Limits</h2>
                  </div>
                  <div className="bd-section-subtitle">
                    Set purchase requirements and limit usage.
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "18px",
                    }}
                  >
                    <div>
                      <label className="bd-input-label">
                        Minimum Requirement
                      </label>
                      <div
                        style={{
                          display: "flex",
                          gap: "24px",
                          margin: "6px 0 12px 0",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: 500,
                          }}
                        >
                          <input
                            type="radio"
                            name="minRequirementType"
                            value="NONE"
                            checked={minRequirementType === "NONE"}
                            onChange={() => setMinRequirementType("NONE")}
                          />
                          None
                        </label>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: 500,
                          }}
                        >
                          <input
                            type="radio"
                            name="minRequirementType"
                            value="MIN_AMOUNT"
                            checked={minRequirementType === "MIN_AMOUNT"}
                            onChange={() => setMinRequirementType("MIN_AMOUNT")}
                          />
                          Minimum purchase amount ({currencyCode})
                        </label>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: 500,
                          }}
                        >
                          <input
                            type="radio"
                            name="minRequirementType"
                            value="MIN_QUANTITY"
                            checked={minRequirementType === "MIN_QUANTITY"}
                            onChange={() =>
                              setMinRequirementType("MIN_QUANTITY")
                            }
                          />
                          Minimum quantity of items
                        </label>
                      </div>

                      {minRequirementType !== "NONE" && (
                        <div style={{ maxWidth: "320px" }}>
                          <label className="bd-input-label">
                            {minRequirementType === "MIN_AMOUNT"
                              ? `Minimum Amount (${currencyCode}) *`
                              : "Minimum Quantity *"}
                          </label>
                          {minRequirementType === "MIN_AMOUNT" ? (
                            <div
                              style={{
                                position: "relative",
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              <span
                                style={{
                                  position: "absolute",
                                  left: "14px",
                                  color: "#616161",
                                  fontWeight: 600,
                                  fontSize: "14px",
                                  pointerEvents: "none",
                                  display: "flex",
                                  alignItems: "center",
                                  height: "100%",
                                }}
                              >
                                {getCurrencySymbol(currencyCode)}
                              </span>
                              <input
                                type="number"
                                name="minRequirementValue"
                                required
                                min={1}
                                value={minRequirementValue}
                                onChange={(e) =>
                                  setMinRequirementValue(
                                    parseFloat(e.target.value || "1"),
                                  )
                                }
                                style={{ paddingLeft: "32px" }}
                                className="bd-input-text"
                              />
                            </div>
                          ) : (
                            <input
                              type="number"
                              name="minRequirementValue"
                              required
                              min={1}
                              value={minRequirementValue}
                              onChange={(e) =>
                                setMinRequirementValue(
                                  parseFloat(e.target.value || "1"),
                                )
                              }
                              className="bd-input-text"
                            />
                          )}
                          <div className="bd-input-subtext">
                            {minRequirementType === "MIN_AMOUNT"
                              ? "Customer must spend at least this amount."
                              : "Customer must purchase at least this quantity."}
                          </div>
                        </div>
                      )}
                    </div>

                    <hr
                      style={{
                        border: "none",
                        borderTop: "1px solid #e1e3e5",
                        margin: "4px 0",
                      }}
                    />

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "16px",
                      }}
                    >
                      <div>
                        <label className="bd-input-label">Usage Limit</label>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#616161",
                            marginBottom: "6px",
                          }}
                        >
                          Limit total uses per code (Default: 1)
                        </div>
                        <input
                          type="number"
                          name="usageLimitPerCode"
                          required
                          min={1}
                          value={usageLimitPerCode}
                          onChange={(e) =>
                            setUsageLimitPerCode(
                              parseInt(e.target.value || "1", 10),
                            )
                          }
                          className="bd-input-text"
                        />
                        <div className="bd-input-subtext">
                          Total times each code can be used.
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          justify: "center",
                          paddingTop: "18px",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: 600,
                          }}
                        >
                          <input
                            type="checkbox"
                            name="oncePerCustomer"
                            value="true"
                            checked={oncePerCustomer}
                            onChange={(e) =>
                              setOncePerCustomer(e.target.checked)
                            }
                            style={{
                              width: "18px",
                              height: "18px",
                              accentColor: "#166534",
                            }}
                          />
                          Limit to one use per customer
                        </label>
                        <div
                          className="bd-input-subtext"
                          style={{ marginLeft: "28px" }}
                        >
                          Each customer can use the code only once.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Section 4: Active Dates */}
              <div className="bd-table-card">
                <div className="bd-section-header">
                  <div className="bd-step-badge">
                    {discountType === "BUY_X_GET_Y" ? "3" : "4"}
                  </div>
                  <h2>Active Dates</h2>
                </div>
                <div className="bd-section-subtitle">
                  Set when this campaign will be active.
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "16px",
                  }}
                >
                  <div>
                    <label className="bd-input-label">Start Date *</label>
                    <input
                      type="date"
                      name="startDate"
                      required
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bd-input-text"
                    />
                  </div>

                  <div>
                    <label className="bd-input-label">
                      End Date (Optional)
                    </label>
                    <input
                      type="date"
                      name="endDate"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="bd-input-text"
                    />
                    <div className="bd-input-subtext">
                      Leave empty if you don't want an end date.
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Action Row */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "10px",
                }}
              >
                <button
                  type="button"
                  className="bd-btn-secondary"
                  onClick={() => navigate("/app")}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bd-btn-primary"
                  disabled={isSubmitting}
                  style={{
                    background: "#0d0d0d",
                    padding: "12px 24px",
                    fontSize: "14px",
                  }}
                >
                  <Rocket size={16} />
                  {isSubmitting
                    ? "Generating Codes..."
                    : "Generate Bulk Discounts"}
                </button>
              </div>
            </div>

            {/* Right Column: Campaign Summary Sidebar */}
            <div className="bd-summary-card">
              <h3>Campaign Summary</h3>

              <div className="bd-summary-list">
                <div className="bd-summary-item">
                  <Pencil size={16} className="bd-summary-item-icon" />
                  <div>
                    <div className="bd-summary-item-label">Campaign name</div>
                    <div className="bd-summary-item-value">
                      {title || "Summer Sale 2024"}
                    </div>
                  </div>
                </div>

                <div className="bd-summary-item">
                  <Tag size={16} className="bd-summary-item-icon" />
                  <div>
                    <div className="bd-summary-item-label">Discount type</div>
                    <div className="bd-summary-item-value">
                      {discountType === "BUY_X_GET_Y"
                        ? `Buy ${buysQuantity} Get ${getsQuantity} ${getsDiscountType === "FREE" ? "Free" : `${getsDiscountValue}% off`}`
                        : discountType === "FREE_SHIPPING"
                          ? "Free Shipping"
                          : discountType === "PERCENTAGE"
                            ? `${discountValue}% off`
                            : `${formatCurrency(discountValue, currencyCode)} off ${appliesOncePerOrder ? "(Once per order)" : "(Per item)"}`}
                    </div>
                  </div>
                </div>

                <div className="bd-summary-item">
                  <ShoppingBag size={16} className="bd-summary-item-icon" />
                  <div>
                    <div className="bd-summary-item-label">Applies to</div>
                    <div className="bd-summary-item-value">
                      {getAppliesToText()}
                    </div>
                  </div>
                </div>

                <div className="bd-summary-item">
                  <Ticket size={16} className="bd-summary-item-icon" />
                  <div>
                    <div className="bd-summary-item-label">Codes to create</div>
                    <div className="bd-summary-item-value">
                      {totalCodes.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="bd-summary-item">
                  <Code2 size={16} className="bd-summary-item-icon" />
                  <div>
                    <div className="bd-summary-item-label">Code format</div>
                    <div className="bd-summary-item-value">
                      {codePrefix.toUpperCase()} + {codeLength} characters
                    </div>
                  </div>
                </div>

                <div className="bd-summary-item">
                  <UserCheck size={16} className="bd-summary-item-icon" />
                  <div>
                    <div className="bd-summary-item-label">Usage limit</div>
                    <div className="bd-summary-item-value">
                      {discountType === "BUY_X_GET_Y"
                        ? hasMaxUsesPerOrder
                          ? `Max ${maxUsesPerOrder}/order`
                          : "Unlimited per order"
                        : oncePerCustomer
                          ? "1 per customer"
                          : `${usageLimitPerCode} per code`}
                    </div>
                  </div>
                </div>

                <div className="bd-summary-item">
                  <CalendarIcon size={16} className="bd-summary-item-icon" />
                  <div>
                    <div className="bd-summary-item-label">Active dates</div>
                    <div className="bd-summary-item-value">
                      {startDate ? startDate : "Aug 24, 2026"} –{" "}
                      {endDate ? endDate : "No end date"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bd-summary-info-box">
                <Info size={18} style={{ flexShrink: 0 }} />
                <span>You can review and confirm before generating codes.</span>
              </div>
            </div>
          </div>
        </fetcher.Form>

        {/* Selection Modal */}
        {isModalOpen && (
          <div
            className="bd-modal-overlay"
            onClick={() => setIsModalOpen(false)}
          >
            <div
              className="bd-modal-container"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bd-modal-header">
                <h3>
                  Select{" "}
                  {modalTargetKey.includes("product")
                    ? "Products"
                    : "Collections"}
                </h3>
                <button
                  type="button"
                  className="bd-action-icon-btn"
                  onClick={() => setIsModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="bd-modal-body">
                <div style={{ position: "relative" }}>
                  <Search
                    size={16}
                    style={{
                      position: "absolute",
                      left: "12px",
                      top: "10px",
                      color: "#8c9196",
                    }}
                  />
                  <input
                    type="text"
                    placeholder={`Search ${modalTargetKey.includes("product") ? "products" : "collections"}...`}
                    value={modalSearch}
                    onChange={(e) => setModalSearch(e.target.value)}
                    className="bd-input-text"
                    style={{ paddingLeft: "36px" }}
                  />
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    marginTop: "8px",
                  }}
                >
                  {(modalTargetKey.includes("product") ? products : collections)
                    .filter((item) =>
                      item.title
                        .toLowerCase()
                        .includes(modalSearch.toLowerCase()),
                    )
                    .map((item) => {
                      const isChecked = tempCheckedIds.includes(item.id);
                      return (
                        <label
                          key={item.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "10px 12px",
                            borderRadius: "8px",
                            background: isChecked ? "#f4fbf7" : "#ffffff",
                            border: isChecked
                              ? "1px solid #bbf7d0"
                              : "1px solid #e1e3e5",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setTempCheckedIds([...tempCheckedIds, item.id]);
                              } else {
                                setTempCheckedIds(
                                  tempCheckedIds.filter((id) => id !== item.id),
                                );
                              }
                            }}
                            style={{
                              width: "16px",
                              height: "16px",
                              accentColor: "#166534",
                            }}
                          />
                          <span
                            style={{
                              fontSize: "14px",
                              fontWeight: 600,
                              color: "#1a1a1a",
                            }}
                          >
                            {item.title}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div className="bd-modal-footer">
                <button
                  type="button"
                  className="bd-btn-secondary"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="bd-btn-primary"
                  onClick={handleConfirmModal}
                  style={{ background: "#166534" }}
                >
                  <Check size={16} />
                  Add ({tempCheckedIds.length})
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
