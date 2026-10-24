# Native conditional order argument repair

The assistant input schema previously marked triggerPrice optional for every native Lighter leg. Runtime validation required it on conditional legs, producing late rejection after the model generated schema-valid incomplete protection. No evidence was found of trigger fields being stripped by NanoGPT or the relay. The assistant narrative claiming transport loss is not established.

The leg schema now branches on type: conditional legs require an exact positive triggerPrice; regular legs prohibit it. Positive execution bounds remain mandatory, including market legs. Tool guidance explains the separate execution bound and includes a complete protective-child example. Nothing infers a missing trigger, changes an approved trade value or bypasses exchange/risk checks.

Tests reproduce the old schema accepting a missing trigger, verify the provider JSON schema requirement, and preserve the user's BNB resting OTOCO trigger values through read-only synthetic preflight. Existing Lighter/Hyperliquid account, advanced preparation and NanoGPT fixtures pass (65 tests); server native/execution fixtures pass (44 tests). All exchange responses in these tests are synthetic; no live trade was submitted and paid model behavior is not independently established.
Frontend TypeScript, focused lint, production build and SPA shell pass. Deployed /opt/quanttrade/releases/20261024-6; public session, origin, operator/agent authorization, resumable transport and news checks pass. Services unchanged.
