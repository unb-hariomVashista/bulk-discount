-- CreateTable
CREATE TABLE "StoreSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'PAY_AS_YOU_GO',
    "codesLimit" INTEGER NOT NULL DEFAULT 250,
    "codesGenerated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'GENERATE',
    "codePrefix" TEXT,
    "codeLength" INTEGER NOT NULL DEFAULT 8,
    "totalCodes" INTEGER NOT NULL,
    "usedCodes" INTEGER NOT NULL DEFAULT 0,
    "discountType" TEXT NOT NULL DEFAULT 'FIXED_AMOUNT',
    "discountValue" REAL NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'ALL_PRODUCTS',
    "targetIds" TEXT,
    "minRequirementType" TEXT NOT NULL DEFAULT 'NONE',
    "minRequirementValue" REAL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "usageLimitPerCode" INTEGER NOT NULL DEFAULT 1,
    "oncePerCustomer" BOOLEAN NOT NULL DEFAULT true,
    "appliesOncePerOrder" BOOLEAN NOT NULL DEFAULT true,
    "buysQuantity" INTEGER DEFAULT 1,
    "buysAppliesTo" TEXT,
    "buysTargetIds" TEXT,
    "getsQuantity" INTEGER DEFAULT 1,
    "getsAppliesTo" TEXT,
    "getsTargetIds" TEXT,
    "getsDiscountType" TEXT,
    "getsDiscountValue" REAL,
    "maxUsesPerOrder" INTEGER,
    "shopifyDiscountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscountCode_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreSetting_shop_key" ON "StoreSetting"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");
