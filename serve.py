"""Serve the project page locally, including seekable MP4 and WASM assets."""

import argparse
import functools
import http.server
from pathlib import Path
import re
import webbrowser


class SiteHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".svg": "image/svg+xml", ".vtt": "text/vtt",
                      ".wasm": "application/wasm", ".mjs": "text/javascript",
                      ".onnx": "application/octet-stream"}

    def log_message(self, *args):
        pass

    def send_head(self):
        self.byte_range = None
        path = Path(self.translate_path(self.path))
        if not path.is_file():
            return super().send_head()
        size = path.stat().st_size
        header = self.headers.get("Range")
        if header:
            match = re.fullmatch(r"bytes=(\d+)-(\d*)", header)
            if match is None:
                self.send_error(416)
                return None
            first = int(match[1])
            last = min(size - 1, int(match[2]) if match[2] else size - 1)
            if first > last:
                self.send_error(416)
                return None
            self.byte_range = first, last
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {first}-{last}/{size}")
            length = last - first + 1
        else:
            self.send_response(200)
            length = size
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Length", str(length))
        self.end_headers()
        return path.open("rb")

    def copyfile(self, source, outputfile):
        try:
            if self.byte_range is None:
                super().copyfile(source, outputfile)
                return
            first, last = self.byte_range
            source.seek(first)
            remaining = last - first + 1
            while remaining:
                block = source.read(min(65536, remaining))
                if not block:
                    break
                outputfile.write(block)
                remaining -= len(block)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--open", action="store_true", help="Open the project page in the default browser")
    args = parser.parse_args()
    handler = functools.partial(SiteHandler, directory=str(Path(__file__).resolve().parent))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    address = f"http://127.0.0.1:{args.port}/"
    print(f"LANTERN: {address}", flush=True)
    if args.open:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
