ALTER TABLE products ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1));
CREATE INDEX IF NOT EXISTS products_demo_idx ON products(is_demo, is_active);