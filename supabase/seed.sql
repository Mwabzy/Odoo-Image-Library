insert into public.sessions (
  id,
  status,
  sheet_filename,
  upload_mode,
  path_mode,
  total_rows,
  total_images,
  matched_count,
  needs_review_count,
  unmatched_count,
  headers,
  column_mapping
) values (
  '11111111-1111-1111-1111-111111111111',
  'completed',
  'sample-products.csv',
  'folder',
  'folder-product-variation',
  3,
  3,
  2,
  1,
  0,
  '["Product Name","SKU","Variation","Color","Image URL"]'::jsonb,
  '{"product_name":"Product Name","sku":"SKU","variation":"Variation","color":"Color","image_url":"Image URL","size":null,"parent_sku":null}'::jsonb
) on conflict (id) do nothing;

insert into public.sheet_rows (
  id,
  session_id,
  row_index,
  product_name,
  sku,
  variation,
  color,
  raw_json,
  final_image_url,
  status
) values
  (
    '22222222-2222-2222-2222-222222222221',
    '11111111-1111-1111-1111-111111111111',
    2,
    'Linen Shirt',
    'LS-001-NAVY',
    'Navy',
    'Navy',
    '{"Product Name":"Linen Shirt","SKU":"LS-001-NAVY","Variation":"Navy","Color":"Navy","Image URL":""}'::jsonb,
    'https://res.cloudinary.com/demo/image/upload/e_background_removal/sample',
    'matched'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    3,
    'Linen Shirt',
    'LS-001-SAND',
    'Sand',
    'Sand',
    '{"Product Name":"Linen Shirt","SKU":"LS-001-SAND","Variation":"Sand","Color":"Sand","Image URL":""}'::jsonb,
    'https://res.cloudinary.com/demo/image/upload/e_background_removal/sample',
    'matched'
  ),
  (
    '22222222-2222-2222-2222-222222222223',
    '11111111-1111-1111-1111-111111111111',
    4,
    'Canvas Tote',
    'CT-010',
    null,
    null,
    '{"Product Name":"Canvas Tote","SKU":"CT-010","Variation":"","Color":"","Image URL":""}'::jsonb,
    null,
    'needs_review'
  )
on conflict (id) do nothing;

insert into public.extracted_images (
  id,
  session_id,
  original_name,
  relative_path,
  normalized_path,
  extension,
  mime_type,
  bytes,
  inferred_product,
  inferred_variation,
  inferred_sku,
  cloudinary_public_id,
  cloudinary_url,
  processed_url,
  status
) values
  (
    '33333333-3333-3333-3333-333333333331',
    '11111111-1111-1111-1111-111111111111',
    'front.svg',
    'Linen-Shirt/Navy/front.svg',
    'linen-shirt/navy/front.svg',
    '.svg',
    'image/svg+xml',
    1024,
    'Linen Shirt',
    'Navy',
    null,
    'demo/sample',
    'https://res.cloudinary.com/demo/image/upload/sample',
    'https://res.cloudinary.com/demo/image/upload/e_background_removal/sample',
    'matched'
  ),
  (
    '33333333-3333-3333-3333-333333333332',
    '11111111-1111-1111-1111-111111111111',
    'front.svg',
    'Linen-Shirt/Sand/front.svg',
    'linen-shirt/sand/front.svg',
    '.svg',
    'image/svg+xml',
    1024,
    'Linen Shirt',
    'Sand',
    null,
    'demo/sample',
    'https://res.cloudinary.com/demo/image/upload/sample',
    'https://res.cloudinary.com/demo/image/upload/e_background_removal/sample',
    'matched'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'main.svg',
    'Canvas-Tote/Standard/main.svg',
    'canvas-tote/standard/main.svg',
    '.svg',
    'image/svg+xml',
    1024,
    'Canvas Tote',
    'Standard',
    null,
    'demo/sample',
    'https://res.cloudinary.com/demo/image/upload/sample',
    null,
    'needs_review'
  )
on conflict (id) do nothing;

insert into public.matches (
  id,
  session_id,
  sheet_row_id,
  image_id,
  confidence_score,
  match_reason,
  matched_by,
  status,
  is_manual
) values
  (
    '44444444-4444-4444-4444-444444444441',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222221',
    '33333333-3333-3333-3333-333333333331',
    0.96,
    'product_variation_exact',
    'engine.product_variation_exact',
    'matched',
    false
  ),
  (
    '44444444-4444-4444-4444-444444444442',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333332',
    0.96,
    'product_variation_exact',
    'engine.product_variation_exact',
    'matched',
    false
  ),
  (
    '44444444-4444-4444-4444-444444444443',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222223',
    '33333333-3333-3333-3333-333333333333',
    0.82,
    'product_fuzzy',
    'engine.fuzzy_review',
    'needs_review',
    false
  )
on conflict (id) do nothing;
