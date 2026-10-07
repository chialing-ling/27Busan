from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen
import json
import os
import re

BASE_DIR = Path(__file__).resolve().parent
HOTELS_FILE = BASE_DIR / "hotels.json"

HOST = "127.0.0.1"
PORT = 8080

_COORD_PAIR_RE = re.compile(r"(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)")
_GOOGLE_DATA_RE = re.compile(r"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)")
_AT_RE = re.compile(r"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)")


def _valid_point(lat, lng):
    return -90 <= lat <= 90 and -180 <= lng <= 180


def extract_coordinates(text):
    """Extract a useful lat/lng pair from a Google Maps URL or page body."""
    if not text:
        return None

    decoded = unquote(str(text))

    # Google place URLs often contain the actual place coordinate as !3dLAT!4dLNG.
    match = _GOOGLE_DATA_RE.search(decoded)
    if match:
        lat, lng = map(float, match.groups())
        if _valid_point(lat, lng):
            return lat, lng, "place"

    # Standard Maps URLs can carry coordinates in query/q/ll/center.
    try:
        parsed = urlparse(decoded)
        query = parse_qs(parsed.query)
        for key in ("query", "q", "ll", "center"):
            for value in query.get(key, []):
                pair = _COORD_PAIR_RE.search(value)
                if pair:
                    lat, lng = map(float, pair.groups())
                    if _valid_point(lat, lng):
                        return lat, lng, "query"
    except Exception:
        pass

    # @LAT,LNG is normally the viewport center. For a nearby reference marker,
    # it is still a useful fallback if the URL does not expose place coordinates.
    match = _AT_RE.search(decoded)
    if match:
        lat, lng = map(float, match.groups())
        if _valid_point(lat, lng):
            return lat, lng, "viewport"

    return None


def resolve_google_maps_url(map_url):
    parsed = urlparse(map_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("地圖網址必須是 http/https 網址")

    host = parsed.netloc.lower().split(":", 1)[0]
    allowed = (
        host == "maps.app.goo.gl"
        or host == "goo.gl"
        or host == "google.com"
        or host == "maps.google.com"
        or host.endswith(".google.com")
        or host.endswith(".google.co.kr")
        or host.endswith(".google.com.tw")
    )
    if not allowed:
        raise ValueError("目前只支援 Google Maps 網址")

    direct = extract_coordinates(map_url)
    if direct:
        lat, lng, source = direct
        return {
            "lat": lat,
            "lng": lng,
            "source": source,
            "finalUrl": map_url,
        }

    request = Request(
        map_url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/124 Safari/537.36"
            )
        },
    )

    with urlopen(request, timeout=12) as response:
        final_url = response.geturl()
        body = response.read(768 * 1024).decode("utf-8", errors="ignore")

    # Prefer the final URL, then fall back to coordinates embedded in the page.
    point = extract_coordinates(final_url) or extract_coordinates(body)
    if not point:
        raise ValueError(
            "Google Maps 網址已開啟，但沒有找到可用座標。"
            "可改用完整 Google Maps 網址，或手動填 lat/lng。"
        )

    lat, lng, source = point
    return {
        "lat": lat,
        "lng": lng,
        "source": source,
        "finalUrl": final_url,
    }


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # The requested operation may already have completed. Do not turn a
            # client disconnect into a second, misleading HTTP error response.
            pass

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/resolve-map":
            try:
                map_url = parse_qs(parsed.query).get("url", [""])[0].strip()
                if not map_url:
                    raise ValueError("缺少 Google Maps 網址")

                result = resolve_google_maps_url(map_url)
                self._send_json(200, {"ok": True, **result})
            except Exception as e:
                self._send_json(400, {"ok": False, "message": str(e)})
            return

        super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        if path != "/save-hotels":
            self._send_json(404, {"ok": False, "message": "Not Found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8")
            data = json.loads(raw)

            if not isinstance(data, list):
                raise ValueError("hotels.json 最外層必須是陣列")

            # Atomic replace: a partial write will not corrupt the real JSON file.
            tmp_file = HOTELS_FILE.with_suffix(".json.tmp")
            with tmp_file.open("w", encoding="utf-8", newline="\n") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_file, HOTELS_FILE)

        except Exception as e:
            self._send_json(500, {"ok": False, "message": str(e)})
            return

        # File write succeeded. Response errors are intentionally not handled as
        # save failures because the browser can verify the persisted JSON itself.
        self._send_json(
            200,
            {
                "ok": True,
                "count": len(data),
                "message": "hotels.json 已更新",
            },
        )


if __name__ == "__main__":
    os.chdir(BASE_DIR)

    print(f"27Busan server running: http://{HOST}:{PORT}/")
    print(f"前台: http://{HOST}:{PORT}/index.html")
    print(f"管理頁: http://{HOST}:{PORT}/admin.html")
    print("按 Ctrl+C 停止")

    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
