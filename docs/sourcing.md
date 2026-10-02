# Off-market IOS sourcing

**Sourcing** in the nav. Businesses that run outdoor yards are sitting on IOS sites whether or not anyone has listed them; the tool finds them, names the owner, and moves the good ones into the pipeline.

1. **Sweep.** Pick a submarket preset (Houston, DFW, Austin, San Antonio) or an address, and a 1–10 mile radius. Hopper runs the IOS demand map's 22 Google Places searches (trucking, equipment rental, contractor yards, container storage, building materials, stone, pipe and steel...) with the same yard-use screening, then:
   - groups businesses into sites (within ~400 ft, the same street address, or the same parcel);
   - looks up each site's **owner of record** in the Texas statewide parcel layer (TxGIO StratMap Land Parcels, the county appraisal roll): owner, mailing address, acres, year built, value;
   - flags **owner-users** (owner name matches an operator: a sale-leaseback lead), **public** owners (hidden by default) and **institutional** owners;
   - marks sites already in Hopper (any deal including archived targets, owned assets, comps).
   About 2 seconds. Google returns at most 20 businesses per search term, so a sweep samples an area; use tighter radii around clusters.
2. **Qualify.** Select up to 10 sites. The *Off-market sourcing* agent (connected helper, web search) researches what the roll can't say: whether the operators occupy the parcel, who is behind the owning entity, hold period from deed records, zoning or deed restrictions on outdoor storage, building size and coverage; judges buy-box fit; and drafts a first-touch letter. Every owner/parcel fact needs a source; unconfirmed points are listed separately. Roughly a minute per site.
3. **Add as prospect.** Creates an IOS Prospect deal marked off-market (sale-leaseback when owner-user), owner of record as the seller contact, address verified with Google when possible. The research, appraisal-roll record and outreach draft are attached to the deal's history. Hopper's duplicate check refuses an address it already has. Nothing is ever sent.

Sweep results and their run link are kept in the browser that ran them (localStorage); re-open recent runs from the same browser.

## Notes on the parcel layer

- `DATE_ACQ` is TxGIO's data refresh date, not the owner's purchase date. It is ignored; hold period comes from deed research.
- Shapes are Web Mercator; acres are corrected by cos²(latitude). The appraisal district's legal area is kept alongside.
- A Google pin can fall on a neighbouring parcel. The agent is asked to confirm occupancy; check the parcel on the map before outreach.

Install: apply `20261002120000_sourcing_agent.sql`, deploy, restart the helper.

Validation: `node scripts/test-sourcing.mjs`, agent tests, typecheck/build, a live Houston North sweep (57 sites, owners on 56) and a live agent run.
