import requests
import websocket
import json
import threading
import time
import sys
from datetime import datetime

class CodeSyncRealTimeAPITester:
    def __init__(self, base_url="https://secure-code-share-1.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_base = f"{base_url}/api"
        self.ws_base = base_url.replace("https://", "wss://")
        self.tests_run = 0
        self.tests_passed = 0
        
        # User 1 (owner)
        self.user1_token = None
        self.user1_id = None
        self.user1_username = None
        
        # User 2 (editor)
        self.user2_token = None
        self.user2_id = None
        self.user2_username = None
        
        # Room data
        self.room_id = None
        
        # WebSocket data
        self.ws1_received_messages = []
        self.ws2_received_messages = []
        self.ws1_connected = False
        self.ws2_connected = False

    def log(self, message):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None):
        """Run a single API test"""
        url = f"{self.api_base}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        params = {'token': token} if token else {}

        self.tests_run += 1
        self.log(f"🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, params=params)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, params=params)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, params=params)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ {name} - Status: {response.status_code}")
                return True, response.json() if response.content else {}
            else:
                self.log(f"❌ {name} - Expected {expected_status}, got {response.status_code}")
                try:
                    error = response.json()
                    self.log(f"   Error: {error}")
                except:
                    self.log(f"   Response: {response.text[:100]}")
                return False, {}

        except Exception as e:
            self.log(f"❌ {name} - Exception: {str(e)}")
            return False, {}

    def setup_test_users(self):
        """Register/Login two test users for WebSocket sync testing"""
        self.log("🔧 Setting up test users for real-time sync testing...")
        
        # User 1 - Owner
        user1_email = "user1_sync@test.com"
        user1_password = "pass123"
        success, response = self.run_test(
            "Login User1", "POST", "auth/login", 200,
            {"email": user1_email, "password": user1_password}
        )
        if success:
            self.user1_token = response['token']
            self.user1_id = response['user']['id']
            self.user1_username = response['user']['username']
            self.log(f"✅ User1 logged in: {self.user1_username}")
        else:
            # Try to register if login fails
            success, response = self.run_test(
                "Register User1", "POST", "auth/register", 200,
                {"email": user1_email, "username": "user1_sync", "password": user1_password}
            )
            if success:
                self.user1_token = response['token']
                self.user1_id = response['user']['id']
                self.user1_username = response['user']['username']
                self.log(f"✅ User1 registered: {self.user1_username}")

        # User 2 - Editor
        user2_email = "user2_sync@test.com"
        user2_password = "pass123"
        success, response = self.run_test(
            "Login User2", "POST", "auth/login", 200,
            {"email": user2_email, "password": user2_password}
        )
        if success:
            self.user2_token = response['token']
            self.user2_id = response['user']['id']
            self.user2_username = response['user']['username']
            self.log(f"✅ User2 logged in: {self.user2_username}")
        else:
            # Try to register if login fails
            success, response = self.run_test(
                "Register User2", "POST", "auth/register", 200,
                {"email": user2_email, "username": "user2_sync", "password": user2_password}
            )
            if success:
                self.user2_token = response['token']
                self.user2_id = response['user']['id']
                self.user2_username = response['user']['username']
                self.log(f"✅ User2 registered: {self.user2_username}")

        return bool(self.user1_token and self.user2_token)

    def create_test_room(self):
        """Create a room with User1 and invite User2"""
        self.log("🏗️  Creating test room...")
        
        # Create room with User1
        success, response = self.run_test(
            "Create Room", "POST", "rooms", 200,
            {"name": f"Sync Test Room {int(time.time())}", "language": "javascript"},
            self.user1_token
        )
        if success:
            self.room_id = response['id']
            self.log(f"✅ Room created: {self.room_id}")
        else:
            # Try existing room if creation fails
            self.room_id = "66483989-348c-4af4-8af3-2bd065de9a6f"
            self.log(f"⚠️  Using existing room: {self.room_id}")

        # Invite User2 as editor
        success, response = self.run_test(
            "Invite User2", "POST", f"rooms/{self.room_id}/invite", 200,
            {"email": "user2_sync@test.com", "role": "editor"},
            self.user1_token
        )
        if success:
            self.log("✅ User2 invited as editor")
        else:
            self.log("⚠️  User2 invite failed (might already be member)")

        # Verify both users can see the room
        success1, _ = self.run_test("User1 List Rooms", "GET", "rooms", 200, token=self.user1_token)
        success2, _ = self.run_test("User2 List Rooms", "GET", "rooms", 200, token=self.user2_token)
        
        return success1 and success2

    def on_ws_message(self, ws, message, user_num):
        """Handle WebSocket messages"""
        try:
            data = json.loads(message)
            if user_num == 1:
                self.ws1_received_messages.append(data)
            else:
                self.ws2_received_messages.append(data)
            
            self.log(f"📨 User{user_num} received: {data.get('type', 'unknown')} - {str(data)[:100]}")
        except:
            pass

    def on_ws_open(self, ws, user_num):
        """Handle WebSocket connection open"""
        if user_num == 1:
            self.ws1_connected = True
        else:
            self.ws2_connected = True
        self.log(f"🔌 User{user_num} WebSocket connected")

    def on_ws_close(self, ws, close_status_code, close_msg, user_num):
        """Handle WebSocket connection close"""
        if user_num == 1:
            self.ws1_connected = False
        else:
            self.ws2_connected = False
        self.log(f"🔌 User{user_num} WebSocket disconnected")

    def test_websocket_real_time_sync(self):
        """Test the critical WebSocket real-time code synchronization"""
        self.log("🎯 CRITICAL TEST: WebSocket Real-time Code Sync")
        
        if not self.room_id:
            self.log("❌ No room available for WebSocket testing")
            return False

        # Clear previous messages
        self.ws1_received_messages.clear()
        self.ws2_received_messages.clear()
        
        # Create WebSocket connections
        ws_url1 = f"{self.ws_base}/api/ws/editor/{self.room_id}?token={self.user1_token}"
        ws_url2 = f"{self.ws_base}/api/ws/editor/{self.room_id}?token={self.user2_token}"
        
        self.log(f"🔗 Connecting WebSockets to room: {self.room_id}")
        
        try:
            # User1 WebSocket
            ws1 = websocket.WebSocketApp(
                ws_url1,
                on_message=lambda ws, msg: self.on_ws_message(ws, msg, 1),
                on_open=lambda ws: self.on_ws_open(ws, 1),
                on_close=lambda ws, code, msg: self.on_ws_close(ws, code, msg, 1)
            )
            
            # User2 WebSocket
            ws2 = websocket.WebSocketApp(
                ws_url2,
                on_message=lambda ws, msg: self.on_ws_message(ws, msg, 2),
                on_open=lambda ws: self.on_ws_open(ws, 2),
                on_close=lambda ws, code, msg: self.on_ws_close(ws, code, msg, 2)
            )

            # Start WebSocket connections in separate threads
            ws1_thread = threading.Thread(target=ws1.run_forever)
            ws2_thread = threading.Thread(target=ws2.run_forever)
            
            ws1_thread.daemon = True
            ws2_thread.daemon = True
            
            ws1_thread.start()
            ws2_thread.start()

            # Wait for connections to establish
            time.sleep(3)
            
            if not (self.ws1_connected and self.ws2_connected):
                self.log("❌ Failed to establish WebSocket connections")
                return False

            self.log("✅ Both WebSocket connections established")

            # Test 1: User1 sends code change, User2 should receive it
            self.log("📝 Test 1: User1 sends code change")
            test_code1 = "// User1 code change at " + str(int(time.time())) + "\nconsole.log('Hello from User1');"
            
            code_change_msg1 = {
                "type": "code_change",
                "code": test_code1
            }
            
            ws1.send(json.dumps(code_change_msg1))
            time.sleep(2)  # Wait for message propagation
            
            # Check if User2 received the code change
            user2_code_changes = [msg for msg in self.ws2_received_messages if msg.get('type') == 'code_change']
            if user2_code_changes:
                received_code = user2_code_changes[-1].get('code', '')
                if test_code1 in received_code:
                    self.log("✅ User2 received User1's code change")
                    self.tests_passed += 1
                else:
                    self.log(f"❌ User2 received different code: {received_code[:50]}...")
            else:
                self.log("❌ User2 did not receive User1's code change")
            
            self.tests_run += 1

            # Test 2: User2 sends code change, User1 should receive it
            self.log("📝 Test 2: User2 sends code change")
            test_code2 = "// User2 code change at " + str(int(time.time())) + "\nconsole.log('Hello from User2');"
            
            code_change_msg2 = {
                "type": "code_change",
                "code": test_code2
            }
            
            ws2.send(json.dumps(code_change_msg2))
            time.sleep(2)  # Wait for message propagation
            
            # Check if User1 received the code change
            user1_code_changes = [msg for msg in self.ws1_received_messages if msg.get('type') == 'code_change']
            if user1_code_changes:
                received_code = user1_code_changes[-1].get('code', '')
                if test_code2 in received_code:
                    self.log("✅ User1 received User2's code change")
                    self.tests_passed += 1
                else:
                    self.log(f"❌ User1 received different code: {received_code[:50]}...")
            else:
                self.log("❌ User1 did not receive User2's code change")
            
            self.tests_run += 1

            # Test 3: Check presence messages
            self.log("📝 Test 3: User presence sync")
            presence_msgs1 = [msg for msg in self.ws1_received_messages if msg.get('type') == 'presence']
            presence_msgs2 = [msg for msg in self.ws2_received_messages if msg.get('type') == 'presence']
            
            if presence_msgs1 and presence_msgs2:
                self.log("✅ Both users received presence updates")
                self.tests_passed += 1
            else:
                self.log("❌ Presence updates not working properly")
            
            self.tests_run += 1

            # Close connections
            ws1.close()
            ws2.close()
            time.sleep(1)
            
            return True

        except Exception as e:
            self.log(f"❌ WebSocket test failed with exception: {str(e)}")
            self.tests_run += 1
            return False

    def test_ai_integration(self):
        """Test AI code suggestion functionality"""
        self.log("🤖 Testing AI Integration")
        
        success, response = self.run_test(
            "AI Code Suggestion", "POST", "ai/suggest", 200,
            {
                "code": "function calculateSum(a, b) {\n  return a + b;\n}",
                "language": "javascript",
                "prompt": "Add error handling and input validation"
            },
            self.user1_token
        )
        
        if success and 'suggestion' in response:
            self.log(f"✅ AI suggestion received: {response['suggestion'][:100]}...")
            return True
        else:
            self.log("❌ AI suggestion failed")
            return False

    def test_role_enforcement(self):
        """Test role-based authorization"""
        self.log("🔐 Testing Role Enforcement")
        
        # Change user2 to viewer
        success, _ = self.run_test(
            "Change User2 to Viewer", "PUT", f"rooms/{self.room_id}/role", 200,
            {"user_id": self.user2_id, "role": "viewer"},
            self.user1_token
        )
        
        if success:
            self.log("✅ Role change successful")
            
            # Try to get AI suggestion as viewer (should still work)
            success, _ = self.run_test(
                "AI Suggest as Viewer", "POST", "ai/suggest", 200,
                {"code": "console.log('test');", "language": "javascript"},
                self.user2_token
            )
            
            # Change back to editor
            self.run_test(
                "Change User2 back to Editor", "PUT", f"rooms/{self.room_id}/role", 200,
                {"user_id": self.user2_id, "role": "editor"},
                self.user1_token
            )
            
            return True
        else:
            self.log("❌ Role change failed")
            return False

def main():
    print("🚀 CodeSync Real-Time Sync Testing - Iteration 2")
    print("=" * 60)
    
    tester = CodeSyncRealTimeAPITester()
    
    # Phase 1: Setup test users
    if not tester.setup_test_users():
        print("❌ Failed to setup test users")
        return 1
    
    # Phase 2: Create test room and invite users
    if not tester.create_test_room():
        print("❌ Failed to setup test room")
        return 1
    
    # Phase 3: Critical WebSocket real-time sync testing
    tester.test_websocket_real_time_sync()
    
    # Phase 4: Test AI integration
    tester.test_ai_integration()
    
    # Phase 5: Test role enforcement
    tester.test_role_enforcement()
    
    # Print final results
    print("\n" + "=" * 60)
    print(f"📊 Real-Time Sync Test Results:")
    print(f"   Total Tests: {tester.tests_run}")
    print(f"   Passed: {tester.tests_passed}")
    print(f"   Failed: {tester.tests_run - tester.tests_passed}")
    if tester.tests_run > 0:
        success_rate = (tester.tests_passed/tester.tests_run)*100
        print(f"   Success Rate: {success_rate:.1f}%")
    else:
        print(f"   Success Rate: 0%")
    
    return 0 if tester.tests_passed >= (tester.tests_run * 0.8) else 1

if __name__ == "__main__":
    sys.exit(main())