-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "pair" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "entryPrice" TEXT NOT NULL,
    "stopPrice" TEXT NOT NULL,
    "targetPrice" TEXT NOT NULL,
    "target2Price" TEXT,
    "plannedR" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "biasSnapshot" JSONB,
    "biasNote" TEXT,
    "playbookSnapshot" JSONB,
    "smcSnapshot" JSONB,
    "exitPrice" TEXT,
    "exitReason" TEXT,
    "result" TEXT,
    "realizedR" TEXT,
    "closedAt" DATETIME,
    "reviewNote" TEXT,
    "source" TEXT NOT NULL,
    "overrideReason" TEXT,
    "tags" JSONB NOT NULL
);

-- CreateIndex
CREATE INDEX "JournalEntry_pair_status_idx" ON "JournalEntry"("pair", "status");

-- CreateIndex
CREATE INDEX "JournalEntry_status_createdAt_idx" ON "JournalEntry"("status", "createdAt");

-- CreateIndex
CREATE INDEX "JournalEntry_closedAt_idx" ON "JournalEntry"("closedAt");
