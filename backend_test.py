import requests
import sys
import json
import uuid
import asyncio
import websockets
import threading
import time
from datetime import datetime

class CodeSyncAPITester:
    def __init__(self, base_url="https://secure-code-share-1.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.ws_base = base_url.replace("https://", "wss://").replace("/api", "")
        self.token = None
        self.user_id = None
        self.username = None
        self.tests_run = 0
        self.tests_passed = 0
        self.room_id = None
        self.ws_messages = []
        self.voice_ws_messages = []

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        # Add token to query params if available
        if self.token and params is None:
            params = {}
        if self.token and params is not None:
            params['token'] = self.token

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {method} {url}")
        if params:
            print(f"   Params: {params}")
        
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
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json() if response.content else {}
                    if response_data:
                        print(f"   Response: {json.dumps(response_data, indent=2)[:200]}...")
                except:
                    pass
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json() if response.content else {}
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Raw response: {response.text[:200]}")

            return success, response.json() if response.content and response.status_code < 500 else {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_register(self, email, username, password):
        """Test user registration"""
        success, response = self.run_test(
            "User Registration",
            "POST",
            "auth/register",
            200,
            data={"email": email, "username": username, "password": password}
        )
        if success and 'token' in response:
            self.token = response['token']
            self.user_id = response['user']['id']
            self.username = response['user']['username']
            return True
        return False

    def test_login(self, email, password):
        """Test user login"""
        success, response = self.run_test(
            "User Login",
            "POST",
            "auth/login",
            200,
            data={"email": email, "password": password}
        )
        if success and 'token' in response:
            self.token = response['token']
            self.user_id = response['user']['id']
            self.username = response['user']['username']
            return True
        return False

    def test_get_me(self):
        """Test get current user"""
        success, response = self.run_test(
            "Get Current User",
            "GET",
            "auth/me",
            200,
            params={'token': self.token}
        )
        return success and response.get('id') == self.user_id

    def test_create_room(self, name, language="javascript"):
        """Test room creation"""
        success, response = self.run_test(
            "Create Room",
            "POST",
            "rooms",
            200,
            data={"name": name, "language": language},
            params={'token': self.token}
        )
        if success and 'id' in response:
            self.room_id = response['id']
            return True
        return False

    def test_list_rooms(self):
        """Test list rooms"""
        success, response = self.run_test(
            "List Rooms",
            "GET",
            "rooms",
            200,
            params={'token': self.token}
        )
        return success and isinstance(response, list)

    def test_get_room(self, room_id):
        """Test get room by ID"""
        success, response = self.run_test(
            "Get Room",
            "GET",
            f"rooms/{room_id}",
            200,
            params={'token': self.token}
        )
        return success and response.get('id') == room_id

    def test_invite_user(self, room_id, email, role="viewer"):
        """Test invite user to room"""
        success, response = self.run_test(
            "Invite User to Room",
            "POST",
            f"rooms/{room_id}/invite",
            200,
            data={"email": email, "role": role},
            params={'token': self.token}
        )
        return success

    def test_update_role(self, room_id, user_id, role):
        """Test update user role"""
        success, response = self.run_test(
            "Update User Role",
            "PUT",
            f"rooms/{room_id}/role",
            200,
            data={"user_id": user_id, "role": role},
            params={'token': self.token}
        )
        return success

    def test_remove_member(self, room_id, user_id):
        """Test remove member"""
        success, response = self.run_test(
            "Remove Member",
            "DELETE",
            f"rooms/{room_id}/members/{user_id}",
            200,
            params={'token': self.token}
        )
        return success

    def test_ai_suggest(self, code="console.log('Hello');", language="javascript"):
        """Test AI suggestion"""
        success, response = self.run_test(
            "AI Code Suggestion",
            "POST",
            "ai/suggest",
            200,
            data={"code": code, "language": language, "prompt": "Improve this code"},
            params={'token': self.token}
        )
        return success and 'suggestion' in response

    def test_delete_room(self, room_id):
        """Test delete room"""
        success, response = self.run_test(
            "Delete Room",
            "DELETE",
            f"rooms/{room_id}",
            200,
            params={'token': self.token}
        )
        return success

    async def test_voice_websocket_connection(self, room_id):
        """Test voice WebSocket connection"""
        print(f"\n🔍 Testing Voice WebSocket Connection...")
        print(f"   WS URL: {self.ws_base}/api/ws/voice/{room_id}?token={self.token}")
        
        try:
            uri = f"{self.ws_base}/api/ws/voice/{room_id}?token={self.token}"
            async with websockets.connect(uri) as websocket:
                print("✅ Voice WebSocket connected successfully")
                
                # Send a test message and wait for response
                test_message = json.dumps({"type": "speaking", "speaking": False})
                await websocket.send(test_message)
                print("✅ Sent speaking message")
                
                # Wait for any messages
                try:
                    response = await asyncio.wait_for(websocket.recv(), timeout=5)
                    data = json.loads(response)
                    print(f"✅ Received: {data.get('type', 'unknown')}")
                    self.voice_ws_messages.append(data)
                except asyncio.TimeoutError:
                    print("⚠️  No immediate response (this is normal)")
                
                return True
        except Exception as e:
            print(f"❌ Voice WebSocket connection failed: {e}")
            return False

    async def test_editor_websocket_connection(self, room_id):
        """Test editor WebSocket connection"""
        print(f"\n🔍 Testing Editor WebSocket Connection...")
        print(f"   WS URL: {self.ws_base}/api/ws/editor/{room_id}?token={self.token}")
        
        try:
            uri = f"{self.ws_base}/api/ws/editor/{room_id}?token={self.token}"
            async with websockets.connect(uri) as websocket:
                print("✅ Editor WebSocket connected successfully")
                
                # Wait for init message
                try:
                    response = await asyncio.wait_for(websocket.recv(), timeout=5)
                    data = json.loads(response)
                    print(f"✅ Received init: {data.get('type', 'unknown')}")
                    self.ws_messages.append(data)
                    
                    # Send a code change
                    code_message = json.dumps({
                        "type": "code_change", 
                        "code": "// Test code from API test\nconsole.log('Hello from WebSocket test');"
                    })
                    await websocket.send(code_message)
                    print("✅ Sent code change message")
                    
                except asyncio.TimeoutError:
                    print("⚠️  No init message received in time")
                
                return True
        except Exception as e:
            print(f"❌ Editor WebSocket connection failed: {e}")
            return False

    def run_websocket_tests(self, room_id):
        """Run WebSocket tests using asyncio"""
        async def run_tests():
            editor_result = await self.test_editor_websocket_connection(room_id)
            voice_result = await self.test_voice_websocket_connection(room_id)
            return editor_result and voice_result
        
        try:
            return asyncio.run(run_tests())
        except Exception as e:
            print(f"❌ WebSocket tests failed: {e}")
            return False

def main():
    print("🚀 Starting CodeSync API Testing (Voice Focus)...")
    print("=" * 50)
    
    tester = CodeSyncAPITester()
    
    # Test with provided user credentials
    print("\n📋 Phase 1: Testing with provided test credentials")
    
    # Try login with test user 1
    if not tester.test_login("user1_sync@test.com", "pass123"):
        print("❌ Test user 1 login failed")
        return 1
    
    print(f"✅ Logged in as user: {tester.username} (ID: {tester.user_id})")
    
    # Test get current user
    if not tester.test_get_me():
        print("❌ Get current user failed")
        return 1
    
    # Test accessing the existing room
    existing_room_id = "66483989-348c-4af4-8af3-2bd065de9a6f"
    print(f"\n📋 Phase 2: Testing existing room access - {existing_room_id}")
    
    if not tester.test_get_room(existing_room_id):
        print("❌ Failed to access existing room")
        return 1
    
    print("✅ Successfully accessed existing room")
    
    # Test WebSocket connections (CRITICAL for voice functionality)
    print("\n📋 Phase 3: Testing WebSocket Connections (CRITICAL)")
    
    if not tester.run_websocket_tests(existing_room_id):
        print("❌ WebSocket tests failed - this is critical for voice functionality")
        return 1
    
    print("✅ WebSocket connections working")
    
    # Test with second user for multi-user scenarios
    print("\n📋 Phase 4: Testing multi-user scenarios")
    tester2 = CodeSyncAPITester()
    
    if tester2.test_login("user2_sync@test.com", "pass123"):
        print(f"✅ Second user logged in: {tester2.username} (ID: {tester2.user_id})")
        
        if tester2.test_get_room(existing_room_id):
            print("✅ Second user can access the room")
            
            # Test WebSocket for second user
            if tester2.run_websocket_tests(existing_room_id):
                print("✅ Second user WebSocket connections working")
            else:
                print("❌ Second user WebSocket connections failed")
        else:
            print("❌ Second user cannot access room")
    else:
        print("❌ Second user login failed")
        return 1
    
    # Test AI functionality
    print("\n📋 Phase 5: Testing AI functionality")
    if not tester.test_ai_suggest("function hello() {\n  // Add voice chat feature\n}", "javascript"):
        print("❌ AI suggestion failed")
    else:
        print("✅ AI suggestion working")
    
    # Print final results
    print("\n" + "=" * 50)
    print(f"📊 Test Results:")
    print(f"   Total Tests: {tester.tests_run + tester2.tests_run}")
    print(f"   Passed: {tester.tests_passed + tester2.tests_passed}")
    total_tests = tester.tests_run + tester2.tests_run
    total_passed = tester.tests_passed + tester2.tests_passed
    print(f"   Failed: {total_tests - total_passed}")
    if total_tests > 0:
        print(f"   Success Rate: {(total_passed/total_tests)*100:.1f}%")
    
    print(f"\n📊 WebSocket Messages Captured:")
    print(f"   Editor messages: {len(tester.ws_messages)}")
    print(f"   Voice messages: {len(tester.voice_ws_messages)}")
    
    return 0 if (total_passed == total_tests and total_tests > 0) else 1

if __name__ == "__main__":
    sys.exit(main())