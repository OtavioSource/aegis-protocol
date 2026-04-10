-- CreateEnum
CREATE TYPE "TreasuryStatus" AS ENUM ('ACTIVE', 'FROZEN');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SpendRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REQUIRES_APPROVAL', 'REJECTED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasuries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'devnet',
    "baseCurrency" TEXT NOT NULL DEFAULT 'USDC',
    "walletAddress" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "status" "TreasuryStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasuries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "treasuryId" TEXT,
    "name" TEXT NOT NULL,
    "externalAgentId" TEXT,
    "type" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "killSwitchActive" BOOLEAN NOT NULL DEFAULT false,
    "ownerName" TEXT,
    "ownerEmail" TEXT,
    "apiKeyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "dailyLimit" DECIMAL(18,6) NOT NULL,
    "monthlyLimit" DECIMAL(18,6) NOT NULL,
    "perTransactionLimit" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spend_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "status" "SpendRequestStatus" NOT NULL DEFAULT 'PENDING',
    "policyDecision" TEXT,
    "decisionReason" TEXT,
    "matchedRule" TEXT,
    "txSignature" TEXT,
    "explorerUrl" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spend_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "spendRequestId" TEXT NOT NULL,
    "approverEmail" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT,
    "spendRequestId" TEXT,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "treasuries_walletAddress_key" ON "treasuries"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "agents_apiKeyHash_key" ON "agents"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_agentId_key" ON "budgets"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_spendRequestId_key" ON "approval_requests"("spendRequestId");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_createdAt_idx" ON "audit_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_agentId_createdAt_idx" ON "audit_logs"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_spendRequestId_idx" ON "audit_logs"("spendRequestId");

-- AddForeignKey
ALTER TABLE "treasuries" ADD CONSTRAINT "treasuries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "treasuries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_requests" ADD CONSTRAINT "spend_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_requests" ADD CONSTRAINT "spend_requests_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_spendRequestId_fkey" FOREIGN KEY ("spendRequestId") REFERENCES "spend_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_spendRequestId_fkey" FOREIGN KEY ("spendRequestId") REFERENCES "spend_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
