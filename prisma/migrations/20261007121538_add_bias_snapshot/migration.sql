-- CreateTable
CREATE TABLE "BiasSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "bias" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "drivers" JSONB NOT NULL,
    "nextEvent" JSONB,
    "invalidation" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "usedLlm" BOOLEAN NOT NULL,
    "asOf" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "BiasSnapshot_pair_createdAt_idx" ON "BiasSnapshot"("pair", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BiasSnapshot_pair_asOf_key" ON "BiasSnapshot"("pair", "asOf");
