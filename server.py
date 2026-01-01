import http.server
import socketserver
import os
import cgi

PORT = 8000
DB_FILE = 'data/gto.db'

class PokerHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/save-db':
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

