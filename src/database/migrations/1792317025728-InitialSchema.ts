import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1792317025728 implements MigrationInterface {
  name = 'InitialSchema1792317025728';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "app_state" ("key" character varying(128) NOT NULL, "value" text NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f6be62945719bc9b8c6c6df260c" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "news" ("id" SERIAL NOT NULL, "title" text NOT NULL, "original_title" text, "summary" text, "source" text NOT NULL, "url" text NOT NULL, "category" text, "published_at" TIMESTAMP WITH TIME ZONE, "hype_score" smallint, "is_posted" boolean NOT NULL DEFAULT false, "posted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_news_url" UNIQUE ("url"), CONSTRAINT "chk_news_hype_score" CHECK ("hype_score" IS NULL OR ("hype_score" >= 0 AND "hype_score" <= 10)), CONSTRAINT "PK_39a43dfcb6007180f04aff2357e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_news_created_at" ON "news"  ("created_at") `);
    await queryRunner.query(`CREATE INDEX "idx_news_posted_hype" ON "news"  ("is_posted", "hype_score") `);
    await queryRunner.query(
      `CREATE TABLE "feedback" ("id" SERIAL NOT NULL, "news_id" integer NOT NULL, "user_id" bigint NOT NULL, "feedback_type" character varying(16) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_feedback_news_user" UNIQUE ("news_id", "user_id"), CONSTRAINT "chk_feedback_type" CHECK ("feedback_type" IN ('like', 'dislike')), CONSTRAINT "PK_8389f9e087a57689cd5be8b2b13" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "feedback" ADD CONSTRAINT "fk_feedback_news" FOREIGN KEY ("news_id") REFERENCES "news"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "feedback" DROP CONSTRAINT "fk_feedback_news"`);
    await queryRunner.query(`DROP TABLE "feedback"`);
    await queryRunner.query(`DROP INDEX "public"."idx_news_posted_hype"`);
    await queryRunner.query(`DROP INDEX "public"."idx_news_created_at"`);
    await queryRunner.query(`DROP TABLE "news"`);
    await queryRunner.query(`DROP TABLE "app_state"`);
  }
}
