"""Register private, authenticated QuantTrade trading extensions."""
from pathlib import Path
import sys

ANCHOR = "app.include_router(trading.router, dependencies=[Depends(auth_user)])"
MARKER = "# QuantTrade private trading extensions"
EXTENSIONS = """
# QuantTrade private trading extensions
from quanttrade_hummingbot_market import install as install_quanttrade_market
from quanttrade_hummingbot_trading import install as install_quanttrade_trading
from quanttrade_hummingbot_connections import install as install_quanttrade_connections
install_quanttrade_market(app, auth_user)
install_quanttrade_trading(app, auth_user)
install_quanttrade_connections(app, auth_user)
"""


def patch(source):
    if MARKER in source:
        if EXTENSIONS.strip() not in source:
            raise ValueError("QuantTrade extension registration differs from expected source")
        return source
    if source.count(ANCHOR) != 1:
        raise ValueError("Hummingbot authenticated router registration changed")
    return source + "\n" + EXTENSIONS


if __name__ == "__main__":
    Path(sys.argv[2]).write_text(patch(Path(sys.argv[1]).read_text()))
