import requests
import sys
import json
import uuid
from datetime import datetime

class CodeSyncAPITester:
    def __init__(self, base_url="https://secure-code-share-1.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.token = None
        self.user_id = None
        self.username = None
        self.tests_run = 0
        self.tests_passed = 0
        self.room_id = None

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

def main():
    print("🚀 Starting CodeSync API Testing...")
    print("=" * 50)
    
    tester = CodeSyncAPITester()
    
    # Test with existing user credentials first
    print("\n📋 Phase 1: Testing with existing user credentials")
    
    # Try login with demo user
    if not tester.test_login("demo@codesync.com", "demo1234"):
        print("❌ Demo user login failed, skipping demo user tests")
        return 1
    
    # Test get current user
    if not tester.test_get_me():
        print("❌ Get current user failed")
        return 1
    
    # Test room operations
    test_room_name = f"Test Room {datetime.now().strftime('%H%M%S')}"
    if not tester.test_create_room(test_room_name, "javascript"):
        print("❌ Room creation failed")
        return 1
    
    if not tester.test_list_rooms():
        print("❌ List rooms failed")
        return 1
    
    if not tester.test_get_room(tester.room_id):
        print("❌ Get room failed")
        return 1
    
    # Test AI suggestion
    if not tester.test_ai_suggest("function hello() {", "javascript"):
        print("❌ AI suggestion failed")
        return 1
    
    # Test invite user (should fail if test user doesn't exist)
    print("\n📋 Phase 2: Testing invite functionality")
    tester.test_invite_user(tester.room_id, "test@example.com", "editor")
    
    # Try to login as second user to test role operations
    tester2 = CodeSyncAPITester()
    if tester2.test_login("test@example.com", "password123"):
        print("✅ Second test user login successful")
        
        # Test role update from first user
        tester.test_update_role(tester.room_id, tester2.user_id, "viewer")
        
        # Test remove member
        tester.test_remove_member(tester.room_id, tester2.user_id)
    else:
        print("⚠️  Second test user not available or login failed")
    
    # Clean up - delete test room
    if tester.room_id:
        tester.test_delete_room(tester.room_id)
    
    # Test user registration with new user
    print("\n📋 Phase 3: Testing new user registration")
    new_tester = CodeSyncAPITester()
    test_email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    test_username = f"user_{uuid.uuid4().hex[:6]}"
    
    if new_tester.test_register(test_email, test_username, "testpass123"):
        print("✅ New user registration successful")
        new_tester.test_get_me()
        
        # Create a room with new user
        new_room_name = f"New User Room {datetime.now().strftime('%H%M%S')}"
        if new_tester.test_create_room(new_room_name):
            new_tester.test_delete_room(new_tester.room_id)
    
    # Print final results
    print("\n" + "=" * 50)
    print(f"📊 Test Results:")
    print(f"   Total Tests: {tester.tests_run}")
    print(f"   Passed: {tester.tests_passed}")
    print(f"   Failed: {tester.tests_run - tester.tests_passed}")
    print(f"   Success Rate: {(tester.tests_passed/tester.tests_run)*100:.1f}%")
    
    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    sys.exit(main())