-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSetting" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'PAY_AS_YOU_GO',
    "codesLimit" INTEGER NOT NULL DEFAULT 250,
    "codesGenerated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'GENERATE',
    "codePrefix" TEXT,
    "codeLength" INTEGER NOT NULL DEFAULT 8,
    "totalCodes" INTEGER NOT NULL,
    "usedCodes" INTEGER NOT NULL DEFAULT 0,
    "discountType" TEXT NOT NULL DEFAULT 'FIXED_AMOUNT',
    "discountValue" DOUBLE PRECISION NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'ALL_PRODUCTS',
    "targetIds" TEXT,
    "minRequirementType" TEXT NOT NULL DEFAULT 'NONE',
    "minRequirementValue" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
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
    "getsDiscountValue" DOUBLE PRECISION,
    "maxUsesPerOrder" INTEGER,
    "shopifyDiscountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreSetting_shop_key" ON "StoreSetting"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");

-- AddForeignKey
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
