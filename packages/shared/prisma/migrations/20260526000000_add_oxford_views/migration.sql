-- CreateTable
CREATE TABLE "oxford_views" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "project_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "prompt" JSONB NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "config" JSON NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commit_message" TEXT,

    CONSTRAINT "oxford_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oxford_views_project_id_name_version_key" ON "oxford_views"("project_id", "name", "version");

-- CreateIndex
CREATE INDEX "oxford_views_project_id_id_idx" ON "oxford_views"("project_id", "id");

-- CreateIndex
CREATE INDEX "oxford_views_created_at_idx" ON "oxford_views"("created_at");

-- CreateIndex
CREATE INDEX "oxford_views_updated_at_idx" ON "oxford_views"("updated_at");

-- CreateIndex
CREATE INDEX "oxford_views_tags_idx" ON "oxford_views" USING GIN ("tags");

-- AddForeignKey
ALTER TABLE "oxford_views" ADD CONSTRAINT "oxford_views_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
