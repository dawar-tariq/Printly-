alter table order_items add column if not exists file_id uuid references order_files(id) on delete set null;
create index if not exists order_items_file on order_items (file_id);
