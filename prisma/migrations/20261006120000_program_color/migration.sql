-- A program's colour is a stored slot (0–7), not a hash of its id: four hues
-- and a hash put two of five programs on one colour. Existing programs are
-- dealt slots in the order they were created (rowid), so the first eight are
-- all different; a new program takes the first free slot (lib/program-tone.ts).
ALTER TABLE "Program" ADD COLUMN "colorIndex" INTEGER NOT NULL DEFAULT 0;

UPDATE "Program"
SET "colorIndex" = (
  SELECT (r."n" - 1) % 8
  FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY rowid) AS "n" FROM "Program") AS r
  WHERE r."id" = "Program"."id"
);
