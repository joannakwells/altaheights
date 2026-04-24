# Alta Heights Headless Shop

This folder is a standalone headless storefront for `shop.altaheightswine.com`.

## What It Does

- Loads products from Shopify Storefront API.
- Supports filtering by product type and tags.
- Creates and updates a Shopify cart client-side.
- Sends checkout back through Shopify checkout.

## Deploy

Point your static host or Vercel project root at:

`/Users/modelfarm/Desktop/Cali_Alpine/shop-headless`

## Included Assets

- `index.html` for the storefront UI
- `styles.css` for the shared Alta Heights visual system
- `fonts/` for the site typography
- `images/MtTam1.jpeg` for the hero image

## Notes

- The Storefront domain and token are currently embedded in `index.html`, matching the rest of the site.
- Query params work here too:
  `?product=<handle>` highlights one product
  `?filter=red` prefilters the grid
