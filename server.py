import http.server
import socketserver
import os
import json
import urllib.parse
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))

# Optional imports (may not be available in all environments)
try:
    import scripts.pt4_service as pt4_service
    PT4_AVAILABLE = True
except ImportError:
    PT4_AVAILABLE = False
    print("Warning: pt4_service not available (psycopg2 not installed)")

from scripts.postflop_solver_api import solve_postflop_board

PORT = 8000
DB_FILE = 'data/gto.db'

class PokerHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Serve the Villain Data
        parsed_path = urllib.parse.urlparse(self.path)
        if parsed_path.path == '/villains':
            if not PT4_AVAILABLE:
                self.send_error(503, "PT4 service not available")
                return
            try:
                data = pt4_service.get_villains()
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(data).encode('utf-8'))
            except Exception as e:
                self.send_error(500, str(e))
        elif parsed_path.path == '/villain':
            if not PT4_AVAILABLE:
                self.send_error(503, "PT4 service not available")
                return
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
            if not PT4_AVAILABLE:
                self.send_error(503, "PT4 service not available")
                return
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

        elif self.path == '/solve-postflop':
            try:
                # Read request body
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode('utf-8'))

                # Extract parameters
                board_cards = data.get('board_cards', [])
                hero_pos = data.get('hero_pos', 'BB')
                villain_pos = data.get('villain_pos', 'BTN')
                pot_bb = float(data.get('pot_bb', 10.0))
                stack_bb = float(data.get('stack_bb', 90.0))
                iterations = int(data.get('iterations', 5000))

                print(f"\n=== Postflop Solve Request ===")
                print(f"Board: {board_cards}")
                print(f"Hero: {hero_pos}, Villain: {villain_pos}")
                print(f"Pot: {pot_bb}bb, Stack: {stack_bb}bb")
                print(f"Iterations: {iterations}")

                # Solve the board
                result = solve_postflop_board(
                    board_cards=board_cards,
                    hero_pos=hero_pos,
                    villain_pos=villain_pos,
                    pot_bb=pot_bb,
                    stack_bb=stack_bb,
                    iterations=iterations,
                    db_path=DB_FILE
                )

                # Send response
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode('utf-8'))

                print(f"✓ Solved in {result['compute_time_seconds']:.2f}s (exploitability: {result['exploitability']:.6f}%)")

            except Exception as e:
                print(f"Postflop solve error: {e}")
                import traceback
                traceback.print_exc()
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

print(f"Serving at http://localhost:{PORT}")
with socketserver.TCPServer(("", PORT), PokerHandler) as httpd:
    httpd.serve_forever()
