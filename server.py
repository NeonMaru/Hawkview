#!/usr/bin/env python3
"""
Hawkview High-Performance Range-Supporting HTTP Server
Supports HTTP 206 Partial Content for instant 1:1 video scrubbing and seeking in HTML5 video players.
"""

import os
import re
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class RangeHTTPRequestHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with robust HTTP 206 Partial Content Range support."""

    def do_HEAD(self):
        f = self.send_head()
        if f:
            f.close()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path.endswith("/corrections.json"):
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length > 0 else b"{}"
            target_path = self.translate_path(self.path)
            os.makedirs(os.path.dirname(os.path.abspath(target_path)), exist_ok=True)
            with open(target_path, "wb") as f:
                f.write(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"status":"saved"}')
        else:
            self.send_error(404, "Unsupported POST endpoint")


    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        ctype = self.guess_type(path)
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, "File not found")
            return None

        fs = os.fstat(f.fileno())
        total_length = fs.st_size
        range_header = self.headers.get('Range')

        if not range_header or not range_header.startswith('bytes='):
            self.send_response(200)
            self.send_header("Content-type", ctype)
            self.send_header("Content-Length", str(total_length))
            self.send_header("Last-Modified", self.date_time_string(int(fs.st_mtime)))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return f

        # Parse Range header
        range_match = re.match(r'bytes=(\d*)-(\d*)', range_header)
        if not range_match:
            self.send_error(416, "Requested Range Not Satisfiable")
            f.close()
            return None

        first, last = range_match.groups()
        first = int(first) if first else 0
        last = int(last) if last else total_length - 1

        if first >= total_length or last >= total_length or first > last:
            self.send_error(416, "Requested Range Not Satisfiable")
            self.send_header("Content-Range", f"bytes */{total_length}")
            self.end_headers()
            f.close()
            return None

        length = last - first + 1
        self.send_response(206)
        self.send_header("Content-type", ctype)
        self.send_header("Content-Range", f"bytes {first}-{last}/{total_length}")
        self.send_header("Content-Length", str(length))
        self.send_header("Last-Modified", self.date_time_string(int(fs.st_mtime)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        f.seek(first)
        self.range_length = length
        return f

    def copyfile(self, source, outputfile):
        if hasattr(self, 'range_length') and self.range_length is not None:
            remaining = self.range_length
            bufsize = 64 * 1024
            try:
                while remaining > 0:
                    chunk = source.read(min(remaining, bufsize))
                    if not chunk:
                        break
                    outputfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            try:
                super().copyfile(source, outputfile)
            except (BrokenPipeError, ConnectionResetError):
                pass

def run(port=8123):
    server_address = ('', port)
    httpd = ThreadingHTTPServer(server_address, RangeHTTPRequestHandler)
    print(f"[Hawkview Server] Serving with HTTP 206 Byte-Range support on http://localhost:{port} ...")
    httpd.serve_forever()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    run(port)
