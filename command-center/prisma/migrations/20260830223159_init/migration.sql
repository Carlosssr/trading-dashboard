-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'ACCOUNTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "Ledger" AS ENUM ('PERSONAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "EntityKind" AS ENUM ('PERSONAL', 'LLC', 'S_CORP', 'C_CORP', 'PARTNERSHIP', 'TRUST', 'RENTAL_PROPERTY');

-- CreateEnum
CREATE TYPE "ProviderName" AS ENUM ('PLAID', 'MX', 'FINICITY', 'MANUAL', 'DEMO');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'SAVINGS', 'MONEY_MARKET', 'CD', 'CREDIT_CARD', 'LINE_OF_CREDIT', 'AUTO_LOAN', 'MORTGAGE', 'STUDENT_LOAN', 'PERSONAL_LOAN', 'BUSINESS_LOAN', 'INVESTMENT', 'RETIREMENT', 'PROPERTY', 'VEHICLE', 'OTHER_ASSET', 'OTHER_LIABILITY');

-- CreateEnum
CREATE TYPE "AccountClassification" AS ENUM ('PERSONAL', 'BUSINESS', 'INVESTMENT', 'REAL_ESTATE');

-- CreateEnum
CREATE TYPE "CategoryGroup" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'DEBT_PAYMENT');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('MERCHANT_EXACT', 'MERCHANT_CONTAINS', 'DESCRIPTION_CONTAINS', 'REGEX');

-- CreateEnum
CREATE TYPE "Cadence" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'IRREGULAR');

-- CreateEnum
CREATE TYPE "SeriesStatus" AS ENUM ('DETECTED', 'CONFIRMED', 'IGNORED');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BillAmountType" AS ENUM ('FIXED', 'VARIABLE');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('SCHEDULED', 'DUE', 'PAID', 'OVERDUE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'SCHEDULED', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ACH', 'CARD', 'CHECK', 'EXTERNAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReserveScope" AS ENUM ('PERSONAL', 'BUSINESS', 'ENTITY');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('PRIMARY_RESIDENCE', 'SECOND_HOME', 'RENTAL', 'MULTI_FAMILY', 'COMMERCIAL', 'LAND');

-- CreateEnum
CREATE TYPE "ValuationSource" AS ENUM ('MANUAL', 'AVM', 'APPRAISAL', 'PURCHASE');

-- CreateEnum
CREATE TYPE "InsightSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InsightKind" AS ENUM ('SPENDING_INCREASE', 'UNUSUAL_TRANSACTION', 'HIGH_CREDIT_UTILIZATION', 'UPCOMING_LARGE_PAYMENT', 'SUBSCRIPTION_INCREASE', 'CASH_FLOW_STRAIN', 'EXCESS_CASH', 'HIGH_INTEREST_DEBT', 'BUSINESS_EXPENSE_INCREASE', 'PERSONAL_SPENDING_TREND', 'BUSINESS_PROFITABILITY_TREND', 'RECURRING_EXPENSE_INCREASE', 'OVERDUE_BILL');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordSalt" TEXT NOT NULL,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaSecretIv" TEXT,
    "mfaSecretTag" TEXT,
    "mfaKeyVersion" INTEGER,
    "mfaEnrolledAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mfaSatisfied" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EntityKind" NOT NULL,
    "ledger" "Ledger" NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "minCashReserve" DECIMAL(18,2),
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "ProviderName" NOT NULL,
    "providerInstitutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "provider" "ProviderName" NOT NULL,
    "providerItemId" TEXT NOT NULL,
    "accessTokenCiphertext" TEXT NOT NULL,
    "accessTokenIv" TEXT NOT NULL,
    "accessTokenTag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "transactionCursor" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "consentExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "institutionId" TEXT,
    "providerItemId" TEXT,
    "provider" "ProviderName" NOT NULL DEFAULT 'MANUAL',
    "providerAccountId" TEXT,
    "institutionName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "officialName" TEXT,
    "mask" TEXT,
    "type" "AccountType" NOT NULL,
    "subtype" TEXT,
    "classification" "AccountClassification" NOT NULL,
    "ledger" "Ledger" NOT NULL,
    "currentBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "availableBalance" DECIMAL(18,2),
    "creditLimit" DECIMAL(18,2),
    "apr" DECIMAL(9,6),
    "minimumPayment" DECIMAL(18,2),
    "nextPaymentDueAt" TIMESTAMP(3),
    "lastStatementBalance" DECIMAL(18,2),
    "lastStatementAt" TIMESTAMP(3),
    "originalPrincipal" DECIMAL(18,2),
    "maturityDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "isDisconnected" BOOLEAN NOT NULL DEFAULT false,
    "includeInNetWorth" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "current" DECIMAL(18,2) NOT NULL,
    "available" DECIMAL(18,2),
    "limit" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "CategoryGroup" NOT NULL,
    "parentId" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "ledgerHint" "Ledger",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ledger" "Ledger" NOT NULL,
    "provider" "ProviderName" NOT NULL DEFAULT 'MANUAL',
    "providerTransactionId" TEXT,
    "postedAt" DATE NOT NULL,
    "authorizedAt" TIMESTAMP(3),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "merchantName" TEXT,
    "rawName" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "subcategory" TEXT,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringSeriesId" TEXT,
    "isTransfer" BOOLEAN NOT NULL DEFAULT false,
    "transferPairId" TEXT,
    "excludeFromReports" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL DEFAULT 'MERCHANT_CONTAINS',
    "pattern" TEXT NOT NULL,
    "categoryId" TEXT,
    "entityId" TEXT,
    "ledger" "Ledger",
    "cadence" "Cadence",
    "fundingAccountId" TEXT,
    "autoCreateBill" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringSeries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "accountId" TEXT,
    "categoryId" TEXT,
    "merchantName" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "cadence" "Cadence" NOT NULL,
    "averageAmount" DECIMAL(18,2) NOT NULL,
    "lastAmount" DECIMAL(18,2) NOT NULL,
    "minAmount" DECIMAL(18,2) NOT NULL,
    "maxAmount" DECIMAL(18,2) NOT NULL,
    "lastOccurredAt" DATE,
    "nextExpectedAt" DATE,
    "dayOfMonth" INTEGER,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "SeriesStatus" NOT NULL DEFAULT 'DETECTED',
    "isIncome" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ledger" "Ledger" NOT NULL,
    "name" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "categoryId" TEXT,
    "targetAccountId" TEXT,
    "fundingAccountId" TEXT,
    "amountType" "BillAmountType" NOT NULL DEFAULT 'FIXED',
    "expectedAmount" DECIMAL(18,2) NOT NULL,
    "cadence" "Cadence" NOT NULL DEFAULT 'MONTHLY',
    "dueDayOfMonth" INTEGER,
    "nextDueAt" DATE,
    "autopay" BOOLEAN NOT NULL DEFAULT false,
    "autopayNote" TEXT,
    "status" "BillStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "recurringSeriesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillOccurrence" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "dueAt" DATE NOT NULL,
    "amountDue" DECIMAL(18,2) NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(18,2),
    "paidSource" TEXT,
    "markedByUserId" TEXT,
    "matchedTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ledger" "Ledger" NOT NULL,
    "billOccurrenceId" TEXT,
    "fundingAccountId" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "scheduledFor" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'ACH',
    "memo" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "provider" "ProviderName" NOT NULL DEFAULT 'MANUAL',
    "providerPaymentId" TEXT,
    "confirmationTokenHash" TEXT,
    "confirmationSentence" TEXT,
    "warnings" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "createdByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashReserveRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" "ReserveScope" NOT NULL,
    "entityId" TEXT,
    "minimumAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashReserveRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ledger" "Ledger" NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "propertyType" "PropertyType" NOT NULL DEFAULT 'RENTAL',
    "purchaseDate" DATE,
    "purchasePrice" DECIMAL(18,2),
    "estimatedValue" DECIMAL(18,2) NOT NULL,
    "valuationSource" "ValuationSource" NOT NULL DEFAULT 'MANUAL',
    "valuationAsOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mortgageAccountId" TEXT,
    "isRental" BOOLEAN NOT NULL DEFAULT false,
    "monthlyRent" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "monthlyPropertyTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "monthlyInsurance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "monthlyHoa" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "monthlyOtherExpenses" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "manualMortgageBalance" DECIMAL(18,2),
    "manualMortgagePayment" DECIMAL(18,2),
    "manualMortgageRate" DECIMAL(9,6),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyValuation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "source" "ValuationSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "securityName" TEXT NOT NULL,
    "ticker" TEXT,
    "quantity" DECIMAL(20,8) NOT NULL,
    "costBasis" DECIMAL(18,2),
    "price" DECIMAL(18,6) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "asOf" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "InsightKind" NOT NULL,
    "severity" "InsightSeverity" NOT NULL DEFAULT 'INFO',
    "ledger" "Ledger",
    "entityId" TEXT,
    "accountId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metricValue" DECIMAL(18,2),
    "comparisonValue" DECIMAL(18,2),
    "periodStart" DATE,
    "periodEnd" DATE,
    "dedupeKey" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_idx" ON "Membership"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_workspaceId_key" ON "Membership"("userId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackupCode_codeHash_key" ON "BackupCode"("codeHash");

-- CreateIndex
CREATE INDEX "BackupCode_userId_idx" ON "BackupCode"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "Entity_workspaceId_ledger_idx" ON "Entity"("workspaceId", "ledger");

-- CreateIndex
CREATE UNIQUE INDEX "Entity_workspaceId_name_key" ON "Entity"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_workspaceId_provider_providerInstitutionId_key" ON "Institution"("workspaceId", "provider", "providerInstitutionId");

-- CreateIndex
CREATE INDEX "ProviderItem_workspaceId_status_idx" ON "ProviderItem"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderItem_provider_providerItemId_key" ON "ProviderItem"("provider", "providerItemId");

-- CreateIndex
CREATE INDEX "Account_workspaceId_ledger_idx" ON "Account"("workspaceId", "ledger");

-- CreateIndex
CREATE INDEX "Account_workspaceId_entityId_idx" ON "Account"("workspaceId", "entityId");

-- CreateIndex
CREATE INDEX "Account_workspaceId_type_idx" ON "Account"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "AccountBalanceSnapshot_asOf_idx" ON "AccountBalanceSnapshot"("asOf");

-- CreateIndex
CREATE UNIQUE INDEX "AccountBalanceSnapshot_accountId_asOf_key" ON "AccountBalanceSnapshot"("accountId", "asOf");

-- CreateIndex
CREATE INDEX "Category_workspaceId_group_idx" ON "Category"("workspaceId", "group");

-- CreateIndex
CREATE UNIQUE INDEX "Category_workspaceId_name_parentId_key" ON "Category"("workspaceId", "name", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_transferPairId_key" ON "Transaction"("transferPairId");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_postedAt_idx" ON "Transaction"("workspaceId", "postedAt");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_ledger_postedAt_idx" ON "Transaction"("workspaceId", "ledger", "postedAt");

-- CreateIndex
CREATE INDEX "Transaction_accountId_postedAt_idx" ON "Transaction"("accountId", "postedAt");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_categoryId_postedAt_idx" ON "Transaction"("workspaceId", "categoryId", "postedAt");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_merchantName_idx" ON "Transaction"("workspaceId", "merchantName");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_provider_providerTransactionId_key" ON "Transaction"("provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "MerchantRule_workspaceId_isActive_priority_idx" ON "MerchantRule"("workspaceId", "isActive", "priority");

-- CreateIndex
CREATE INDEX "RecurringSeries_workspaceId_status_idx" ON "RecurringSeries"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringSeries_workspaceId_normalizedKey_accountId_key" ON "RecurringSeries"("workspaceId", "normalizedKey", "accountId");

-- CreateIndex
CREATE INDEX "Bill_workspaceId_ledger_status_idx" ON "Bill"("workspaceId", "ledger", "status");

-- CreateIndex
CREATE INDEX "Bill_workspaceId_nextDueAt_idx" ON "Bill"("workspaceId", "nextDueAt");

-- CreateIndex
CREATE INDEX "BillOccurrence_dueAt_status_idx" ON "BillOccurrence"("dueAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BillOccurrence_billId_dueAt_key" ON "BillOccurrence"("billId", "dueAt");

-- CreateIndex
CREATE INDEX "Payment_workspaceId_status_idx" ON "Payment"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Payment_workspaceId_scheduledFor_idx" ON "Payment"("workspaceId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "CashReserveRule_workspaceId_scope_entityId_key" ON "CashReserveRule"("workspaceId", "scope", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Property_mortgageAccountId_key" ON "Property"("mortgageAccountId");

-- CreateIndex
CREATE INDEX "Property_workspaceId_ledger_idx" ON "Property"("workspaceId", "ledger");

-- CreateIndex
CREATE INDEX "PropertyValuation_propertyId_asOf_idx" ON "PropertyValuation"("propertyId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyValuation_propertyId_asOf_source_key" ON "PropertyValuation"("propertyId", "asOf", "source");

-- CreateIndex
CREATE INDEX "Holding_workspaceId_idx" ON "Holding"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_accountId_securityName_key" ON "Holding"("accountId", "securityName");

-- CreateIndex
CREATE INDEX "Insight_workspaceId_dismissedAt_severity_idx" ON "Insight"("workspaceId", "dismissedAt", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "Insight_workspaceId_dedupeKey_key" ON "Insight"("workspaceId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupCode" ADD CONSTRAINT "BackupCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderItem" ADD CONSTRAINT "ProviderItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderItem" ADD CONSTRAINT "ProviderItem_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_providerItemId_fkey" FOREIGN KEY ("providerItemId") REFERENCES "ProviderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountBalanceSnapshot" ADD CONSTRAINT "AccountBalanceSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recurringSeriesId_fkey" FOREIGN KEY ("recurringSeriesId") REFERENCES "RecurringSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_transferPairId_fkey" FOREIGN KEY ("transferPairId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_fundingAccountId_fkey" FOREIGN KEY ("fundingAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSeries" ADD CONSTRAINT "RecurringSeries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSeries" ADD CONSTRAINT "RecurringSeries_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSeries" ADD CONSTRAINT "RecurringSeries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSeries" ADD CONSTRAINT "RecurringSeries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_targetAccountId_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_fundingAccountId_fkey" FOREIGN KEY ("fundingAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_recurringSeriesId_fkey" FOREIGN KEY ("recurringSeriesId") REFERENCES "RecurringSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOccurrence" ADD CONSTRAINT "BillOccurrence_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOccurrence" ADD CONSTRAINT "BillOccurrence_matchedTransactionId_fkey" FOREIGN KEY ("matchedTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOccurrence" ADD CONSTRAINT "BillOccurrence_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_fundingAccountId_fkey" FOREIGN KEY ("fundingAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billOccurrenceId_fkey" FOREIGN KEY ("billOccurrenceId") REFERENCES "BillOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReserveRule" ADD CONSTRAINT "CashReserveRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReserveRule" ADD CONSTRAINT "CashReserveRule_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_mortgageAccountId_fkey" FOREIGN KEY ("mortgageAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyValuation" ADD CONSTRAINT "PropertyValuation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
