-- CreateTable
CREATE TABLE "DailyBias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "bias" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "strength" INTEGER NOT NULL,
    "previousDayOpen" TEXT NOT NULL,
    "previousDayHigh" TEXT NOT NULL,
    "previousDayLow" TEXT NOT NULL,
    "previousDayClose" TEXT NOT NULL,
    "bodyDirection" TEXT NOT NULL,
    "bodyStrength" TEXT NOT NULL,
    "closePosition" TEXT NOT NULL,
    "liquidityTaken" TEXT NOT NULL,
    "liquidityLeft" TEXT NOT NULL,
    "pdh" TEXT NOT NULL,
    "pdl" TEXT NOT NULL,
    "eqh" TEXT,
    "eql" TEXT,
    "invalidation" TEXT NOT NULL,
    "asOf" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DailyBias_pair_createdAt_idx" ON "DailyBias"("pair", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBias_pair_asOf_key" ON "DailyBias"("pair", "asOf");
