-- 0018_deal_prices.sql
-- Real money on deals.
--
-- Until now the only price the tracker held was the most recent *offer*, so
-- every dollar figure on the home screen, in the brief, and in the export was
-- last-offer money -- including the "closed" subtotals, which is exactly where
-- a wrong number is most visible. Two columns fix that:
--
--   contract_price -- the price agreed in the PSA. Captured when a deal is
--                     confirmed Moving to PSA or enters Due Diligence.
--   closed_price   -- what the deal actually closed at. Captured when the deal
--                     is marked Closed.
--
-- Both nullable: they only exist for deals that get that far, and historical
-- rows will never have them. Reporting falls back
-- closed_price -> contract_price -> last offer, and every roll-up reports which
-- basis it used so an estimated subtotal can't be mistaken for a real one (see
-- dealValue() in lib/summary.ts).
--
-- Naming pairs with the existing date columns: closed_on / closed_price are
-- actuals, closing_on is the target date.

alter table deals
  add column if not exists contract_price numeric
    constraint deals_contract_price_positive check (contract_price is null or contract_price > 0),
  add column if not exists closed_price numeric
    constraint deals_closed_price_positive check (closed_price is null or closed_price > 0);
