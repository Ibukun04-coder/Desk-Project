/*
  Warnings:

  - Added the required column `method` to the `DailyBias` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DailyBias" (
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
    "method" TEXT NOT NULL,
    "asOf" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_DailyBias" ("asOf", "bias", "bodyDirection", "bodyStrength", "closePosition", "confidence", "createdAt", "eqh", "eql", "id", "invalidation", "liquidityLeft", "liquidityTaken", "pair", "pdh", "pdl", "previousDayClose", "previousDayHigh", "previousDayLow", "previousDayOpen", "strength") SELECT "asOf", "bias", "bodyDirection", "bodyStrength", "closePosition", "confidence", "createdAt", "eqh", "eql", "id", "invalidation", "liquidityLeft", "liquidityTaken", "pair", "pdh", "pdl", "previousDayClose", "previousDayHigh", "previousDayLow", "previousDayOpen", "strength" FROM "DailyBias";
DROP TABLE "DailyBias";
ALTER TABLE "new_DailyBias" RENAME TO "DailyBias";
CREATE INDEX "DailyBias_pair_createdAt_idx" ON "DailyBias"("pair", "createdAt");
CREATE UNIQUE INDEX "DailyBias_pair_asOf_key" ON "DailyBias"("pair", "asOf");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
