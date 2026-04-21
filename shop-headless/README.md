# Alta Heights Headless Shop

This folder is a standalone Vercel deploy target for `shop.altaheightswine.com`.

## Deploy setup

1. Create a new Vercel project.
2. Point the project root directory to:
   `/Users/modelfarm/Desktop/Cali_Alpine/altaheights-main/shop-headless`
3. Assign the domain `shop.altaheightswine.com` to that Vercel project.

## Notes

- `index.html` is the storefront entry.
- `styles.css`, `fonts/`, and `images/MtTam1.jpeg` are copied here so the shop can deploy independently from the main site.
- Main-site nav and footer links point to `https://altaheightswine.com`.
- Product data and cart behavior still come from Shopify's Storefront API.
- Checkout still happens on Shopify checkout.
