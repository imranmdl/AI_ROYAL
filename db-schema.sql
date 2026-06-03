
-- Database: royal_tiles_db

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('Admin', 'Manager', 'Sales Executive', 'Supervisor') NOT NULL,
    last_login DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50),
    brand VARCHAR(100),
    size VARCHAR(50),
    thickness VARCHAR(20),
    finish VARCHAR(50),
    tiles_per_box INT,
    sqft_per_box DECIMAL(10, 2),
    purchase_price DECIMAL(10, 2), -- per box
    selling_price DECIMAL(10, 2),  -- per box
    reorder_level INT DEFAULT 10
);

CREATE TABLE inventory (
    product_id INT PRIMARY KEY,
    stock_boxes INT DEFAULT 0,
    stock_loose INT DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE commission_master (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('SV', 'GP', 'FIXED') NOT NULL, -- SV=Sales Value, GP=Gross Profit
    value DECIMAL(10, 2) NOT NULL,
    target_category VARCHAR(50),
    min_margin DECIMAL(10, 2),
    max_discount DECIMAL(10, 2),
    is_active TINYINT DEFAULT 1
);

CREATE TABLE sales_invoice (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_no VARCHAR(50) UNIQUE,
    customer_name VARCHAR(255),
    sales_person_id INT,
    date DATE,
    sub_total DECIMAL(10, 2),
    gst_amount DECIMAL(10, 2),
    total_amount DECIMAL(10, 2),
    payment_type VARCHAR(50),
    FOREIGN KEY (sales_person_id) REFERENCES users(id)
);

CREATE TABLE sales_invoice_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT,
    product_id INT,
    qty_boxes INT,
    qty_loose INT,
    rate DECIMAL(10, 2),
    amount DECIMAL(10, 2),
    commission_earned DECIMAL(10, 2),
    FOREIGN KEY (invoice_id) REFERENCES sales_invoice(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255),
    amount DECIMAL(10, 2),
    date DATE,
    category VARCHAR(50)
);

-- Indexes for performance
CREATE INDEX idx_sales_date ON sales_invoice(date);
CREATE INDEX idx_product_category ON products(category);
