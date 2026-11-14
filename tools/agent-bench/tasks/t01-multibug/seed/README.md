# Checkout
- Prices are stored in USD (item.usd) and shown in the customer currency (rates in src/rates.js), rounded to cents.
- lineTotal = unitPrice * qty, then a volume discount: 10 or more units 10% off, 50 or more units 20% off. Result rounded to cents.
- paginate(list, page, size): pages are 1-based; page 1 is the first size items. Out of range pages return [].
