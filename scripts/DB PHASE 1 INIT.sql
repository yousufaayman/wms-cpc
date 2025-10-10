CREATE DATABASE wms_cpc;

use wms_cpc;

CREATE TABLE users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  type ENUM('admin', 'warehouse', 'inspector', 'operator') NOT NULL
);

CREATE TABLE warehouses (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  type ENUM('Fabric', 'RMG', 'Accessory') NOT NULL
);

CREATE TABLE warehouse_racks (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  warehouse_id INT UNSIGNED NOT NULL,      -- which warehouse this rack belongs to
  rack_code VARCHAR(50) NOT NULL,          -- e.g. "R1-A2", "Shelf-03"
  UNIQUE KEY unique_rack (warehouse_id, rack_code),
  INDEX (warehouse_id),
  CONSTRAINT fk_racks_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE boxes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rack_id INT UNSIGNED DEFAULT NULL,            -- optional physical location
  barcode VARCHAR(100) NOT NULL UNIQUE,         -- box barcode (packaging)
  brand_id VARCHAR(100) DEFAULT NULL,           -- external client reference (box-level)
  weight DECIMAL(10,2) DEFAULT NULL,            -- total gross weight of the box (kg)
  shipment_no VARCHAR(100) DEFAULT NULL,
  INDEX (rack_id),
  CONSTRAINT fk_boxes_rack FOREIGN KEY (rack_id) REFERENCES warehouse_racks(id)
);

CREATE TABLE box_contents (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  box_id INT UNSIGNED NOT NULL,
  model_id VARCHAR(100) NOT NULL,               -- external model reference
  size VARCHAR(50) NOT NULL,                    -- e.g. S, M, L
  color_id VARCHAR(50) NOT NULL,                -- external color reference
  piece_count INT UNSIGNED NOT NULL,            -- number of pieces for this combo
  weight DECIMAL(10,2) DEFAULT NULL,            -- optional weight of these pieces (kg)
  INDEX (box_id),
  INDEX (model_id),
  INDEX (size),
  INDEX (color_id),
  CONSTRAINT fk_box_contents_box FOREIGN KEY (box_id) REFERENCES boxes(id)
);

CREATE TABLE receipts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receipt_type ENUM('inbound', 'dyehouse', 'cutting', 'shipping') NOT NULL,
  source_location_id INT UNSIGNED NULL,         -- warehouse or logical location
  target_location_id INT UNSIGNED NULL,         -- warehouse or logical location
  status ENUM('issued', 'confirmed', 'cancelled') NOT NULL DEFAULT 'issued',
  issued_by INT UNSIGNED NOT NULL,              -- user who created
  confirmed_by INT UNSIGNED NULL,               -- user who confirmed
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP NULL,
  INDEX (receipt_type),
  INDEX (status),
  CONSTRAINT fk_receipts_issued_by FOREIGN KEY (issued_by) REFERENCES users(id),
  CONSTRAINT fk_receipts_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users(id)
);

CREATE TABLE receipt_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT UNSIGNED NOT NULL,
  roll_id INT UNSIGNED NULL,        
  box_id INT UNSIGNED NULL,
  INDEX (receipt_id),
  CONSTRAINT fk_receipt_items_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);

CREATE TABLE logical_locations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  contact_name VARCHAR(100) DEFAULT NULL,
  contact_number VARCHAR(20) DEFAULT NULL
);