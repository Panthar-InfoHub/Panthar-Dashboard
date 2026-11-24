-- AlterTable
ALTER TABLE "TaskChecklistItem" ADD COLUMN "createdById" TEXT;

-- CreateIndex
CREATE INDEX "TaskChecklistItem_createdById_idx" ON "TaskChecklistItem"("createdById");

-- AddForeignKey
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

