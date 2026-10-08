# QuantTrade provider logos

Retrieved 2026-10-07 from official provider websites. Assets are bundled locally in `upstream/pairlens/apps/terminal/public/posters`; no browser request to a third-party logo host is needed.

| Provider | Local asset | Official source | Processing |
| --- | --- | --- | --- |
| Hyperliquid | `hyperliquid-market-connector.png` | [Official homepage icon](https://hyperliquid.xyz/apple-touch-icon.png), linked by the [Hyperliquid homepage](https://hyperliquid.xyz/) | Original PNG, unchanged. The [brand kit](https://hyperliquid.gitbook.io/hyperliquid-docs/brand-kit) SVG file endpoint returned 403, so the official homepage asset is used. |
| Lighter | `lighter-market-connector.svg` | `light_iconmark.svg` from the [official SVG kit](https://framerusercontent.com/assets/GAVoK5oFCdm1rRX2eWsVYGBk.zip), linked by the [Lighter brand kit](https://lighter.xyz/brand-kit) | White official mark, framed on a transparent 224×224 canvas with clear space. Original paths and colors are unchanged; translation `(59, 16)` centers the 106×192 mark. Square framing preserves its proportions in existing square icon containers. |
| NanoGPT | `nanogpt-inference.svg` | [Official square mark](https://nano-gpt.com/logo/Nano-gptFilled.svg), linked by the [NanoGPT brand page](https://nano-gpt.com/brand) | Original SVG, unchanged. |

The same exchange marks cover both spot and perpetual connector IDs. The bundled poster registry, connector manifest icon and connector `metadata.logoUrl` route the assets through existing exchange/account badges, market pickers and plugin/provider icons. Existing image labels, sizes and layouts are retained.

SVGs were parsed and checked for scripts, event handlers, foreign objects, entities, external image references and external CSS URLs. Local gradient references remain intact. The files identify integrations; the marks remain their providers' trademarks.
