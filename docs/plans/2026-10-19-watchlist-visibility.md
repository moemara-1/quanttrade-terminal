# Home watchlist visibility repair

Reproduced Favorites (1) showing “Watchlist empty” on Home while the mobile watchlist renders the saved XMR-USDT entry. Desktop built rows only from successful discovery matches and silently filtered unresolved symbols. The saved list itself remained intact.

Saved instrument references are authoritative for row existence and identity. Discovery enriches metadata but cannot erase a saved row. Label-only fallback rows preserve saved class/venue and show unavailable market data without subscribing to an unverified quote or displaying cached prices. Reorder/removal remain tied to the saved reference. No persistence migration or changes to saved ticker content.

Regression tests cover unresolved XMR and empty discovery, class/venue identity, order and removal identity. Verify hosted Favorites renders its one saved entry, default lists still populate, and no trade/account mutations occur. Frontend-only deployment, no service restart.

Hosted QA also exposed that global discovery can select the current native connector and return USDC perpetuals instead of saved USDT spot metadata. Known saved symbols are therefore supplemented from the existing bundled catalog as label metadata, without inventing an exchange listing. Regression uses real Top Crypto/catalog data with a native-only discovery response. Unknown XMR remains unavailable.
