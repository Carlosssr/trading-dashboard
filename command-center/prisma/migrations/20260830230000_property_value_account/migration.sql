-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "valueAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Property_valueAccountId_key" ON "Property"("valueAccountId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_valueAccountId_fkey" FOREIGN KEY ("valueAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

