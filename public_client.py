"""
Public.com API Client — Global Shared Library
==============================================
Currently lives in the OptionsScreenerV2 project folder.

TO MAKE IT GLOBAL (usable by all projects):
  1. cp ~/Documents/Claude/Cowork/Projects/OptionsScreenerV2/public_client.py \
        ~/Documents/Claude/lib/public_client.py
  2. Add to ~/.zshrc:
       export PYTHONPATH="$HOME/Documents/Claude/lib:$PYTHONPATH"
       export PUBLIC_SECRET_KEY="your_secret_key_here"
       export PUBLIC_ACCOUNT_ID="your_account_id_here"   # optional — auto-fetched

Get your secret key at: https://public.com/settings/security/api
"""

import os
import time
import requests
from pathlib import Path

# Load .env from this file's directory and EVERY parent up to home, nearest first.
#
# It used to stop at the first .env it found, which contradicted the sentence above and
# broke the moment this repo gained a .env of its own: the Public.com key lives one level
# up, in the directory shared with the wheel app, and creating a local .env for the VAPID
# push keys silently cut it off. The symptom was "Public.com: no key" with the key still
# sitting exactly where it always had been.
#
# Merging is the behaviour that was always intended. `key not in os.environ` gives the
# precedence for free: a real environment variable wins, then the nearest .env, then each
# parent in turn -- so a local file can override a shared one without hiding the rest of it.
def _load_dotenv():
    search = Path(__file__).resolve().parent
    home   = Path.home()
    while True:
        env_file = search / ".env"
        if env_file.exists():
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:   # don't override real env vars
                        os.environ[key] = val
        if search == home or search.parent == search:
            break
        search = search.parent

_load_dotenv()

BASE_URL = "https://api.public.com"
DEFAULT_TOKEN_TTL = 480   # minutes (8 hours)


class PublicClient:

    def __init__(self):
        self.secret_key = os.environ.get("PUBLIC_SECRET_KEY")
        self._account_id = os.environ.get("PUBLIC_ACCOUNT_ID")
        self._token = None
        self._token_expires_at = 0.0
        self._ttl = int(os.environ.get("PUBLIC_TOKEN_TTL_MINUTES", str(DEFAULT_TOKEN_TTL)))

    # ── Configuration check ───────────────────────────────────────────────────

    @property
    def configured(self):
        """True if a secret key is present in the environment."""
        return bool(self.secret_key)

    # ── Auth ──────────────────────────────────────────────────────────────────

    def _get_token(self):
        """Exchange secret key for a bearer token; cache until 60s before expiry."""
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token
        if not self.secret_key:
            raise EnvironmentError(
                "PUBLIC_SECRET_KEY env var not set.\n"
                "Get your key at https://public.com/settings/security/api\n"
                "Then add to ~/.zshrc:  export PUBLIC_SECRET_KEY='your_key'"
            )
        resp = requests.post(
            f"{BASE_URL}/userapiauthservice/personal/access-tokens",
            json={"validityInMinutes": self._ttl, "secret": self.secret_key},
            timeout=10,
        )
        resp.raise_for_status()
        self._token = resp.json()["accessToken"]
        self._token_expires_at = time.time() + self._ttl * 60
        return self._token

    def _headers(self):
        return {
            "Authorization": f"Bearer {self._get_token()}",
            "Content-Type": "application/json",
        }

    # ── Account ───────────────────────────────────────────────────────────────

    def get_account_id(self):
        """Return brokerage account ID; auto-fetches and caches if not set."""
        if self._account_id:
            return self._account_id
        resp = requests.get(
            f"{BASE_URL}/userapigateway/trading/account",
            headers=self._headers(),
            timeout=10,
        )
        resp.raise_for_status()
        accounts = resp.json().get("accounts", [])
        if not accounts:
            raise RuntimeError("No accounts found on Public.com")
        # Prefer BROKERAGE account type; fall back to first
        for acc in accounts:
            if acc.get("accountType") == "BROKERAGE":
                self._account_id = acc["accountId"]
                return self._account_id
        self._account_id = accounts[0]["accountId"]
        return self._account_id

    # ── Market data ───────────────────────────────────────────────────────────

    def get_quotes(self, instruments):
        """
        Fetch real-time quotes for a list of instruments.

        Parameters
        ----------
        instruments : list of dicts, e.g.:
            [{"symbol": "QQQ",  "type": "EQUITY"},
             {"symbol": "AAPL 261218P00200000", "type": "OPTION"}]

        Returns
        -------
        List of quote dicts. Each has:
            outcome, last, bid, ask, volume, openInterest,
            optionDetails.{strikePrice, midPrice, greeks.{delta, impliedVolatility, ...}}
        All numeric fields come back as strings from the API.
        """
        account_id = self.get_account_id()
        resp = requests.post(
            f"{BASE_URL}/userapigateway/marketdata/{account_id}/quotes",
            headers=self._headers(),
            json={"instruments": instruments},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("quotes", [])

    def get_stock_price(self, symbol):
        """Return current mid-price (or last) for a stock/ETF.  None on failure."""
        try:
            quotes = self.get_quotes([{"symbol": symbol, "type": "EQUITY"}])
        except Exception:
            return None
        if not quotes:
            return None
        q = quotes[0]
        if q.get("outcome") != "SUCCESS":
            return None
        try:
            bid = float(q["bid"]) if q.get("bid") else 0
            ask = float(q["ask"]) if q.get("ask") else 0
            last = float(q["last"]) if q.get("last") else 0
            # LAST is the price; the mid is only a stand-in for when there isn't one.
            # Public's own feed is fine -- it reported SLV last 52.19, matching the site
            # and yfinance -- but the ask on that same quote was a stale 120.00, and
            # averaging it in produced $86.06. Only trust a mid from a tight book.
            if last > 0:
                return last
            if bid > 0 and ask > 0 and ask <= bid * 1.05:
                return (bid + ask) / 2
            return bid or None
        except (ValueError, TypeError):
            return None

    def get_option_expirations(self, symbol):
        """
        Return available option expiration dates for a symbol.

        Returns
        -------
        List of "YYYY-MM-DD" strings, sorted ascending.
        """
        account_id = self.get_account_id()
        resp = requests.post(
            f"{BASE_URL}/userapigateway/marketdata/{account_id}/option-expirations",
            headers=self._headers(),
            json={"instrument": {"symbol": symbol, "type": "EQUITY"}},
            timeout=10,
        )
        resp.raise_for_status()
        return sorted(resp.json().get("expirations", []))

    def get_option_chain(self, symbol, expiration_date):
        """
        Return the full option chain for a symbol on a given expiry.

        Parameters
        ----------
        symbol          : e.g. "QQQ"
        expiration_date : "YYYY-MM-DD"

        Returns
        -------
        dict with keys "calls" and "puts", each a list of quote dicts.
        Each put/call dict includes:
            bid, ask, volume, openInterest  (all strings or ints from API)
            optionDetails.strikePrice       (string)
            optionDetails.midPrice          (string)
            optionDetails.greeks.delta      (string)
            optionDetails.greeks.impliedVolatility (string)
        """
        account_id = self.get_account_id()
        resp = requests.post(
            f"{BASE_URL}/userapigateway/marketdata/{account_id}/option-chain",
            headers=self._headers(),
            json={
                "instrument": {"symbol": symbol, "type": "EQUITY"},
                "expirationDate": expiration_date,
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "calls": data.get("calls", []),
            "puts":  data.get("puts",  []),
        }


# ── Module-level singleton ────────────────────────────────────────────────────
# Usage:
#   from public_client import client
#   if client.configured:
#       chain = client.get_option_chain("QQQ", "2026-07-18")
#
client = PublicClient()
