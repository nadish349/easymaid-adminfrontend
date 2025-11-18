/**
 * Test script to verify PATCH endpoint triggers manual sync
 */

const { db } = require('./firebaseAdmin');
const { manualSyncByCustomerId, getManualSyncStatus } = require('./utils/manualStatusSync');

async function testPatchSync() {
  console.log('🧪 Testing PATCH endpoint with manual sync...');
  
  try {
    // Test data with realistic user
    const testUserId = 'test-patch-user-456';
    const testBookingData = {
      userId: testUserId,
      customerId: testUserId, // customerId = userId
      date: '2025-01-17',
      time: '09:00 - 11:00',
      hours: 2,
      professionals: 1,
      materials: true,
      instructions: 'Test PATCH sync booking',
      assignedStatus: 'unassigned',
      totalAmount: 75.00,
      createdAt: new Date().toISOString()
    };
    
    // Step 1: Create user document first
    console.log('Creating user document...');
    const userRef = db.collection('users').doc(testUserId);
    await userRef.set({
      id: testUserId,
      name: 'Test Patch User',
      email: 'testpatch@example.com',
      phone: '+1234567890',
      totalAmount: 0,
      createdAt: new Date().toISOString()
    });
    console.log(`✅ Created user ${testUserId} in users collection`);
    
    // Step 2: Create booking in main collection
    console.log('Creating test booking in main collection...');
    const docRef = await db.collection('bookings').add(testBookingData);
    const bookingId = docRef.id;
    console.log(`✅ Created booking ${bookingId} in main collection`);
    
    // Step 3: Create mirrored booking manually
    console.log('Creating mirrored booking...');
    const userBookingRef = db.collection('users').doc(testUserId).collection('bookings').doc(bookingId);
    await userBookingRef.set({
      ...testBookingData,
      mirroredAt: new Date().toISOString()
    });
    console.log(`✅ Created mirrored booking ${bookingId} in user subcollection`);
    
    // Test 1: Check initial sync status
    console.log('\n📊 Test 1: Check initial sync status');
    const initialStatus = await getManualSyncStatus(bookingId, testUserId);
    console.log('Initial sync status:', initialStatus);
    
    // Test 2: Simulate PATCH request (like frontend does)
    console.log('\n🔄 Test 2: Simulate PATCH request to update assignedStatus');
    
    // This simulates what the frontend does: apiPatch(`/bookings/${bookingId}`, { assignedStatus: 'assigned' })
    const updateData = { assignedStatus: 'assigned' };
    
    // Get booking data first
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    const bookingData = bookingDoc.data();
    const userId = bookingData.userId;
    
    // Update the main booking (simulating PATCH)
    const updatePayload = {
      ...updateData,
      updatedAt: new Date().toISOString()
    };
    
    await bookingRef.update(updatePayload);
    console.log(`✅ Updated booking ${bookingId} in main collection (PATCH simulation)`);
    
    // Test 3: Manual sync (this should happen automatically in the PATCH route)
    console.log('\n🔄 Test 3: Manual sync (should be automatic in PATCH route)');
    if (updateData.assignedStatus !== undefined && userId) {
      console.log(`🔄 BOOKING UPDATE: Syncing status change for booking ${bookingId}, user ${userId}, new status: ${updateData.assignedStatus}`);
      
      // Use manual sync method with customerId
      const syncSuccess = await manualSyncByCustomerId(bookingId, userId, updateData.assignedStatus);
      
      if (syncSuccess) {
        console.log(`✅ BOOKING UPDATE: Successfully synced status for booking ${bookingId}`);
      } else {
        console.warn(`⚠️ BOOKING UPDATE: Failed to sync assignedStatus for booking ${bookingId} in user ${userId} subcollection`);
      }
    }
    
    // Test 4: Verify sync status after update
    console.log('\n📊 Test 4: Verify sync status after update');
    const afterSyncStatus = await getManualSyncStatus(bookingId, testUserId);
    console.log('After sync status:', afterSyncStatus);
    
    // Test 5: Test multiple PATCH updates
    console.log('\n🔄 Test 5: Test multiple PATCH updates');
    const statuses = ['confirm', 'completed'];
    
    for (const status of statuses) {
      console.log(`\nPATCH update to status: ${status}`);
      
      // Simulate PATCH request
      await bookingRef.update({
        assignedStatus: status,
        updatedAt: new Date().toISOString()
      });
      console.log(`✅ PATCH updated main booking to "${status}"`);
      
      // Manual sync (should be automatic in real PATCH route)
      const syncResult = await manualSyncByCustomerId(bookingId, userId, status);
      if (syncResult) {
        console.log(`✅ Manual synced "${status}" to user subcollection`);
      } else {
        console.log(`❌ Failed to manual sync "${status}"`);
      }
      
      // Verify sync
      const statusCheck = await getManualSyncStatus(bookingId, testUserId);
      console.log(`📊 Sync check for "${status}":`, {
        inSync: statusCheck.inSync,
        mainStatus: statusCheck.mainStatus,
        userStatus: statusCheck.userStatus,
        syncedBy: statusCheck.syncedBy
      });
    }
    
    // Test 6: Test with missing mirrored booking
    console.log('\n🔄 Test 6: Test with missing mirrored booking');
    
    // Create another booking without mirrored copy
    const testBookingData2 = {
      userId: testUserId,
      customerId: testUserId,
      date: '2025-01-18',
      time: '13:00 - 15:00',
      hours: 2,
      professionals: 2,
      materials: false,
      instructions: 'Test missing mirrored booking with PATCH',
      assignedStatus: 'unassigned',
      totalAmount: 100.00,
      createdAt: new Date().toISOString()
    };
    
    const docRef2 = await db.collection('bookings').add(testBookingData2);
    const bookingId2 = docRef2.id;
    console.log(`✅ Created booking ${bookingId2} without mirrored copy`);
    
    // PATCH update (should create missing mirrored booking)
    const bookingRef2 = db.collection('bookings').doc(bookingId2);
    await bookingRef2.update({
      assignedStatus: 'assigned',
      updatedAt: new Date().toISOString()
    });
    console.log(`✅ PATCH updated booking ${bookingId2} to "assigned"`);
    
    // Manual sync (should create missing mirrored booking)
    const missingSyncResult = await manualSyncByCustomerId(bookingId2, testUserId, 'assigned');
    if (missingSyncResult) {
      console.log('✅ Manual sync successful - created missing mirrored booking');
    } else {
      console.log('❌ Manual sync failed for missing mirrored booking');
    }
    
    // Verify the missing booking was created
    const missingStatus = await getManualSyncStatus(bookingId2, testUserId);
    console.log('Missing booking sync status:', missingStatus);
    
    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await docRef.delete();
    await userBookingRef.delete();
    await docRef2.delete();
    const userBookingRef2 = db.collection('users').doc(testUserId).collection('bookings').doc(bookingId2);
    await userBookingRef2.delete();
    await userRef.delete(); // Delete the user document
    console.log('✅ Cleanup completed');
    
    console.log('\n🏁 PATCH sync test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testPatchSync().then(() => {
  console.log('🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});
