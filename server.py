import http.server
import socketserver
import os
import json
import urllib.parse
import scripts.pt4_service as pt4_service

PORT = 8000
DB_FILE = 'data/gto.db'

class PokerHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Serve the Villain Data
        parsed_path = urllib.parse.urlparse(self.path)
        if parsed_path.path == '/villains':
            try:
                data = pt4_service.get_villains()
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(data).encode('utf-8'))
            except Exception as e:
                self.send_error(500, str(e))
        elif parsed_path.path == '/villain':
            try:
                query_params = urllib.parse.parse_qs(parsed_path.query)
                name = query_params.get('name', [None])[0]
                
                if not name:
                    self.send_error(400, "Missing 'name' parameter")
                    return

                data = pt4_service.get_villain_stats(name)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(data).encode('utf-8'))
            except Exception as e:
                self.send_error(500, str(e))
        else:
            # Default behavior (serve static files)
            super().do_GET()

    def do_POST(self):
        if self.path == '/sync-pt4':
            try:
                result = pt4_service.sync_from_pt4()
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode('utf-8'))
            except Exception as e:
                print(f"Sync error: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        elif self.path == '/save-db':
            try:
                # Get the length of the data
                content_length = int(self.headers['Content-Type']) if 'Content-Type' in self.headers and self.headers['Content-Type'].isdigit() else int(self.headers.get('Content-Length', 0))
                
                # Read the file data
                file_data = self.rfile.read(content_length)
                
                # Write to disk
                with open(DB_FILE, 'wb') as f:
                    f.write(file_data)
                
                # Send response
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"status": "success"}')
                print(f"Database saved successfully to {DB_FILE}")
                
            except Exception as e:
                print(f"Error saving DB: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(b'{"status": "error"}')
        else:
            self.send_error(404)

print(f"Serving at http://localhost:{PORT}")
with socketserver.TCPServer(("", PORT), PokerHandler) as httpd:
    httpd.serve_forever()
