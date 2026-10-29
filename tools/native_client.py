"""Local test client using the daemon's supported one-use nonce exchange.

Credentials remain in this process's CookieJar. Requests use the original
Origin and CSRF checks; the client does not alter authentication policy.
"""
from __future__ import annotations

import http.cookiejar
import json
import os
import re
import subprocess
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path


class NativeClient:
    def __init__(self, executable: str, entry: str, profile: str, port: int):
        self.base = f"http://localhost:{port}"
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        env = os.environ.copy()
        env["BUN_BE_BUN"] = "1"
        command = [executable, entry, "url", "--data-dir", profile]
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=20)
        nonce = None
        for link in re.findall(r"https?://[^\s\x1b]+", result.stdout):
            url = urllib.parse.urlsplit(link)
            if url.hostname in {"localhost", "127.0.0.1"} and url.port == port:
                nonce = urllib.parse.parse_qs(url.query).get("nonce", [None])[0]
        if not nonce:
            raise RuntimeError("the selected local daemon did not issue a bootstrap nonce")
        data = urllib.parse.urlencode({"nonce": nonce, "dest": "/"}).encode()
        request = urllib.request.Request(
            self.base + "/api/auth/nonce", data,
            {"content-type": "application/x-www-form-urlencoded", "origin": self.base},
        )
        with self.opener.open(request, timeout=20) as response:
            response.read()
        if not any(cookie.name == "operon_auth" for cookie in self.jar):
            raise RuntimeError("the local daemon did not establish its session cookie")
        request = urllib.request.Request(self.base + "/api/csrf", headers={"origin": self.base})
        with self.opener.open(request, timeout=20) as response:
            response.read()

    def request(self, path: str, body=None, method: str | None = None):
        headers = {"origin": self.base}
        for cookie in self.jar:
            if cookie.name == "operon_csrf":
                headers["x-operon-csrf"] = cookie.value
        data = None if body is None else json.dumps(body).encode()
        if data is not None:
            headers["content-type"] = "application/json"
        request = urllib.request.Request(self.base + path, data, headers, method=method)
        try:
            with self.opener.open(request, timeout=60) as response:
                data = response.read()
                return json.loads(data) if data else None
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"native API HTTP {error.code}: {error.read().decode()[:1600]}") from None
