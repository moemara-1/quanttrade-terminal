"""Verify background polling cannot trigger HTTP Basic login dialogs.

Run on the deployment host after reloading the public Nginx configuration.
No exchange credentials are read and no trading endpoints are called.
"""
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

ORIGIN = "https://quanttrade.azurestore.shop"


def request(path):
    try:
        response = urlopen(ORIGIN + path, timeout=90)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


status, headers, body = request("/api/news?topics=earnings&sort=LATEST")
assert status == 200, f"News route returned {status}"
assert headers.get("WWW-Authenticate") is None, "News polling prompts for login"
assert isinstance(json.loads(body)["articles"], list), "News must return the native feed contract"

status, headers, body = request("/version.json")
assert status == 200, f"Build metadata returned {status}"
assert headers.get("WWW-Authenticate") is None, "Updater prompts for login"
assert json.loads(body) == json.loads(
    Path("/opt/quanttrade/current/frontend/version.json").read_text()
), "Public metadata must be the actual build artifact"

status, headers, _ = request("/futures")
assert status == 401, f"Terminal navigation lost password protection: {status}"
assert headers.get("WWW-Authenticate", "").startswith("Basic "), "Missing login gate"

print("Login regression checks passed: no background challenges; terminal remains protected.")
