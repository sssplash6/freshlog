-- Staff who signed in with only a first name, or none, get the full name
-- from the team list of 2026-10-08. A name somebody already wrote out in full
-- is theirs and is left alone: only a blank or one-word name is replaced.

-- 1. By email: the address is the person.
WITH "Team"("email", "name") AS (VALUES
  ('amirbek@freshman.academy', 'Amirbek Bakhshilloev'),
  ('amir-hamza@freshman.academy', 'Amir-Hamza Bakhtiyorov'),
  ('amirxan.shelmuxanov@gmail.com', 'Amirkhan Shelmukhanov'),
  ('agundal@gmail.com', 'Andrew Gundal'),
  ('anyasim2009@gmail.com', 'Anna Sim'),
  ('marketing@freshman.academy', 'Artyom Kochnev'),
  ('shukurovabakhora@gmail.com', 'Bahora Shukurova'),
  ('banu@freshman.academy', 'Banu Mirzayeva'),
  ('behruz.edu@gmail.com', 'Behruz Olimov'),
  ('bositvaisov@gmail.com', 'Bosit Vaisov'),
  ('dostonbps@gmail.com', 'Doston Rajabov'),
  ('firdavs@freshman.academy', 'Firdavs Yakubov'),
  ('gulrukh@freshman.academy', 'Gulrukh Sodikova'),
  ('hasan@freshman.academy', 'Hasan Mavlonov'),
  ('imona@freshman.academy', 'Imona Bustonbayeva'),
  ('ibrohimovh751@gmail.com', 'Khumoyunbek Ibrohimov'),
  ('khurshiderg004@gmail.com', 'Khurshid Ergashev'),
  ('khusanboy@freshman.academy', 'Khusanboy Kotibjonov'),
  ('ilink7003@gmail.com', 'Kirill Ilin'),
  ('madina@freshman.academy', 'Madina Abdurashidova'),
  ('malika@freshman.academy', 'Malikahon Vahobova'),
  ('manzilbekkarlibaev@gmail.com', 'Manzilbek Karlibaev'),
  ('mashhuraqudratova08@gmail.com', 'Mashhura Qudratova'),
  ('milutin.milojkovic03@gmail.com', 'Milutin Milojković'),
  ('ns6240@nyu.edu', 'Nataliya Sakharova'),
  ('niallshah@gmail.com', 'Niall Shah'),
  ('nigel@freshman.academy', 'Nigel Li'),
  ('nigina.rashidowa@gmail.com', 'Nigina Rashidova'),
  ('liliyatoshi@gmail.com', 'Nilufar Ibroximova'),
  ('apclasses@freshman.academy', 'Niyozbek Komilov'),
  ('ntillayeva@gmail.com', 'Nodira Tillayeva'),
  ('rhmvzdbk999@gmail.com', 'Ozodbek Rakhmatov'),
  ('rustam.ganijonov@freshman.academy', 'Rustam Ganijonov'),
  ('tech@freshman.academy', 'Samandar Norboev'),
  ('sanjar@freshman.academy', 'Sanjar Umar'),
  ('sega@freshman.academy', 'Sega Arakelyan'),
  ('shabnam@freshman.academy', 'Shabnam Qunishova'),
  ('shahrizoda@freshman.academy', 'Shahrizoda Yusupova'),
  ('xolboyevaniso@gmail.com', 'Shakhriniso Kholboeva'),
  ('research@freshman.academy', 'Shakhrizoda Karimova'),
  ('shkarimovaa06@gmail.com', 'Shakhrizoda Karimova'),
  ('sharofiddin@freshman.academy', 'Sharofiddin Abdukodirov'),
  ('shodiyona@freshman.academy', 'Shodiyona Erkaboeva'),
  ('erkashody@gmail.com', 'Shodiyona Erkaboeva'),
  ('shohruhalijanov.off@gmail.com', 'Shohruh Alijanov'),
  ('shokhjakhonboy@freshman.academy', 'Shokhjakhonboy Urazbaev'),
  ('shokhrukh@freshman.academy', 'Shokhrukh Shukhratov'),
  ('sofina@freshman.academy', 'Sofina Karimova'),
  ('abdukaxxorovsuhrob@gmail.com', 'Suhrob Abdukaxxorov'),
  ('sales@freshman.academy', 'Suhrob Abduqaxxorov'),
  ('sunnatillo@freshman.academy', 'Sunnatillo Khujaev'),
  ('timnosov@gmail.com', 'Tim Nosov'),
  ('ulugbek@freshman.academy', 'Ulugbek Alimukhamedov'),
  ('umidbek@freshman.academy', 'Umid Nazarov'),
  ('umid@freshman.academy', 'Umid Usmanov'),
  ('valentina@freshman.academy', 'Valentina Kim'),
  ('valera@freshman.academy', 'Valera Arakelyan'),
  ('yerdaulet.rakhmatulla@gmail.com', 'Yerdaulet Rakhmatulla'),
  ('zulfinakhudoyorova@gmail.com', 'Zulfina Khudoyorova')
)
UPDATE "User"
SET "name" = (SELECT "name" FROM "Team" WHERE "Team"."email" = lower(trim("User"."email")))
WHERE lower(trim("email")) IN (SELECT "email" FROM "Team")
  AND ("name" IS NULL OR instr(trim("name"), ' ') = 0);

-- 2. By first name, for staff who signed in with an address not on the list.
-- Only a first name that belongs to one person on the list, and only when
-- exactly one staff account carries it, so no guess lands on the wrong person.
-- Left out because two people on the team share the name, or nearly do:
-- Ulugbek, Shahrizoda / Shakhrizoda, Shohruh / Shokhrukh. Students who also
-- mentor are left out too: they are not on the team list.
WITH "First"("first", "name") AS (VALUES
  ('amir-hamza', 'Amir-Hamza Bakhtiyorov'),
  ('amirbek', 'Amirbek Bakhshilloev'),
  ('amirkhan', 'Amirkhan Shelmukhanov'),
  ('andrew', 'Andrew Gundal'),
  ('anna', 'Anna Sim'),
  ('artyom', 'Artyom Kochnev'),
  ('bahora', 'Bahora Shukurova'),
  ('banu', 'Banu Mirzayeva'),
  ('behruz', 'Behruz Olimov'),
  ('bosit', 'Bosit Vaisov'),
  ('doston', 'Doston Rajabov'),
  ('firdavs', 'Firdavs Yakubov'),
  ('gulrukh', 'Gulrukh Sodikova'),
  ('hasan', 'Hasan Mavlonov'),
  ('imona', 'Imona Bustonbayeva'),
  ('khumoyunbek', 'Khumoyunbek Ibrohimov'),
  ('khurshid', 'Khurshid Ergashev'),
  ('khusanboy', 'Khusanboy Kotibjonov'),
  ('kirill', 'Kirill Ilin'),
  ('madina', 'Madina Abdurashidova'),
  ('malikahon', 'Malikahon Vahobova'),
  ('manzilbek', 'Manzilbek Karlibaev'),
  ('mashhura', 'Mashhura Qudratova'),
  ('milutin', 'Milutin Milojković'),
  ('nataliya', 'Nataliya Sakharova'),
  ('niall', 'Niall Shah'),
  ('nigel', 'Nigel Li'),
  ('nigina', 'Nigina Rashidova'),
  ('nilufar', 'Nilufar Ibroximova'),
  ('niyozbek', 'Niyozbek Komilov'),
  ('nodira', 'Nodira Tillayeva'),
  ('ozodbek', 'Ozodbek Rakhmatov'),
  ('rustam', 'Rustam Ganijonov'),
  ('samandar', 'Samandar Norboev'),
  ('sanjar', 'Sanjar Umar'),
  ('sega', 'Sega Arakelyan'),
  ('shabnam', 'Shabnam Qunishova'),
  ('shakhriniso', 'Shakhriniso Kholboeva'),
  ('sharofiddin', 'Sharofiddin Abdukodirov'),
  ('shodiyona', 'Shodiyona Erkaboeva'),
  ('shokhjakhonboy', 'Shokhjakhonboy Urazbaev'),
  ('sofina', 'Sofina Karimova'),
  ('sunnatillo', 'Sunnatillo Khujaev'),
  ('tim', 'Tim Nosov'),
  ('valentina', 'Valentina Kim'),
  ('valera', 'Valera Arakelyan'),
  ('yerdaulet', 'Yerdaulet Rakhmatulla'),
  ('zulfina', 'Zulfina Khudoyorova')
)
UPDATE "User"
SET "name" = (SELECT "name" FROM "First" WHERE "First"."first" = lower(trim("User"."name")))
WHERE "role" <> 'STUDENT'
  AND lower(trim("name")) IN (SELECT "first" FROM "First")
  AND (SELECT count(*) FROM "User" AS "u"
       WHERE "u"."role" <> 'STUDENT'
         AND lower(trim("u"."name")) = lower(trim("User"."name"))) = 1;
