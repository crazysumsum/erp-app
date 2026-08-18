CREATE DATABASE IF NOT EXISTS erp_dev
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'erp_user'@'localhost' IDENTIFIED BY 'erp_password';
CREATE USER IF NOT EXISTS 'erp_user'@'%' IDENTIFIED BY 'erp_password';

GRANT ALL PRIVILEGES ON erp_dev.* TO 'erp_user'@'localhost';
GRANT ALL PRIVILEGES ON erp_dev.* TO 'erp_user'@'%';

USE erp_dev;

-- 框架自己的表都在 database/framework/ 底下，並以 fr_ 前綴命名。這個檔案只
-- 負責建庫與建帳號；所有資料表——框架的與業務的——都由 `npm run migrate`
-- 建立，這樣「這張表誰擁有、升級框架時什麼會變」一眼看得出來。
--
-- 這裡曾經有一張示範用的 users 表（name / email / role）與一行假資料，是
-- starter 專案留下的。它已經移除：認證功能需要用 users 這個名字建自己的表，
-- 而兩者同名會讓 migration 的 `CREATE TABLE IF NOT EXISTS` 靜默跳過。既有的
-- 資料庫由 migrations/0003_add_auth_tables.js 負責換掉那張示範表。
