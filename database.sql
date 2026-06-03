-- MySQL Database Setup Script for Royal Tiles ERP
-- You can import this file using phpMyAdmin, MySQL Workbench, or the command line.

-- Create the database if it doesn't exist
CREATE DATABASE IF NOT EXISTS `royaltiles` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Use the database
USE `royaltiles`;

-- Create the persistence table
-- The application stores all its state (products, sales, etc.) as a JSON document in this table
CREATE TABLE IF NOT EXISTS `system_persistence` (
  `id` VARCHAR(50) NOT NULL,
  `payload` LONGTEXT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert initial empty state (optional)
-- The application will automatically initialize this if it's empty, 
-- but you can uncomment the lines below to insert it manually.

-- INSERT IGNORE INTO `system_persistence` (`id`, `payload`, `updated_at`) VALUES 
-- ('global_master', '{"products":[],"sales":[],"purchases":[],"quotations":[],"payments":[],"expenses":[],"offers":[],"commissionRules":[],"users":[{"id":"1","name":"Administrator","role":"Admin","email":"admin@royal.com","password":"admin","status":"Active","baseSalary":50000,"permissions":{"canViewDashboard":true,"canManageInventory":true,"canManageSales":true,"canViewReports":true,"canManageUsers":true,"canViewCredits":true,"canManageCustomers":true,"canManageReturns":true}}],"customers":[],"activityLogs":[],"advances":[],"payrollRecords":[],"settings":{"showroomName":"ROYAL TILES & GRANITES","systemBranding":"ROYAL ERP","showroomAddress":"Royal Plaza, Main Tile Market","showroomCity":"City Center, Hubli - Dharwad","showroomPhone":"+91 98765 43210","showroomGst":"29RTX1029384Z5","showroomDescription":"Luxury architectural surfaces.","galleryTitle":"Royal Gallery","gallerySubTitle":"Live Inventory","customInvoiceFieldLabels":["Vehicle Number","Site Engineer"],"backendUrl":"","lastUpdated":0}}', UNIX_TIMESTAMP() * 1000);
